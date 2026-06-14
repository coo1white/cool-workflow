"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAgentInvocation = resolveAgentInvocation;
exports.stripSecretArgs = stripSecretArgs;
exports.parseAgentReport = parseAgentReport;
exports.agentSubstitutions = agentSubstitutions;
exports.substituteAgentArg = substituteAgentArg;
exports.recordedAgentHandle = recordedAgentHandle;
exports.extractEndpointResult = extractEndpointResult;
exports.agentHandle = agentHandle;
exports.prepareAgentSpawn = prepareAgentSpawn;
exports.runAgentBatchOutcomes = runAgentBatchOutcomes;
// Agent-delegation pure helpers + concurrent batch fulfillment for the
// execution-backend driver layer. Carved out of execution-backend.ts
// (FreeBSD-audit god-module carve) so the driver layer no longer bundles the
// agent sub-domain's data-transform helpers; the stateful runners
// (runAgentProcess / runAgentEndpoint) that build refusal/delegated envelopes
// stay in the parent and import these. The parent re-exports the public surface
// (stripSecretArgs, AgentSpawnJob, prepareAgentSpawn, runAgentBatchOutcomes) so
// every importer is byte-unchanged.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Every function
// here is a pure function of its inputs (request/env/argv → resolved data); none
// reaches back into the parent's envelope builders, so there is no runtime cycle.
// Matches the existing router pattern (orchestrator/*-operations.ts,
// run-registry/derive.ts).
//
// agent — the v0.1.38 delegating driver. Spawns an EXTERNAL agent process per
// worker (claude -p / codex exec / …) argv-style (shell:false), or POSTs the
// manifest to a configured HTTP agent endpoint. The agent reads the worker
// input/manifest and writes the worker's result.md out-of-process; CW captures
// the agent CHILD's command + exit + stdout digest as the canonical evidence
// triple (NEVER the result.md — that is the separate recordWorkerOutput layer)
// and records the kind:process handle + agent-reported model in provenance.
//
// THE RED LINE: CW spawns the agent and records its attested output. It NEVER
// imports a model SDK, holds an API key, or constructs a model API request. Any
// API key flows from the agent's OWN inherited env; CW never reads or records it.
// The operator-chosen CW_AGENT_MODEL is interpolated into `{{model}}` as policy
// and recorded ONLY in secret-stripped args — it is NEVER the attested model id.
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const util_1 = require("./util");
/** Resolve the agent invocation from the request delegation > env. Vendor-neutral;
 *  the durable file config is folded in by the drive layer before this point. */
function resolveAgentInvocation(request) {
    const delegation = request.delegation || {};
    const envCommand = (process.env.CW_AGENT_COMMAND || "").trim();
    const endpoint = delegation.endpoint || (process.env.CW_AGENT_ENDPOINT || "").trim() || undefined;
    const model = delegation.model || (process.env.CW_AGENT_MODEL || "").trim() || undefined;
    // Accept the invocation via delegation (preferred) OR the top-level command/args.
    let binary = delegation.command || request.command || undefined;
    let rawArgs = delegation.args ? [...delegation.args] : request.args ? [...request.args] : [];
    // An env-string command ("claude -p --output-format json {{manifest}}") is split
    // into a binary + discrete argv template — NEVER shell-interpreted.
    if (!binary && envCommand) {
        const parts = envCommand.split(/\s+/).filter(Boolean);
        binary = parts[0];
        if (!delegation.args)
            rawArgs = parts.slice(1);
    }
    else if (binary && !delegation.args && /\s/.test(binary)) {
        const parts = binary.split(/\s+/).filter(Boolean);
        binary = parts[0];
        rawArgs = parts.slice(1);
    }
    return { binary, rawArgs, endpoint, model, timeoutMs: request.timeoutMs };
}
const AGENT_SECRET_FLAGS = new Set(["--api-key", "--apikey", "--token", "--key", "--secret", "--password", "--auth", "--bearer"]);
/** Redact secrets from recorded agent args: a value FOLLOWING a known secret flag,
 *  an `--x-key=...` inline value, or a token that LOOKS like a credential. Never
 *  record a raw secret in provenance/evidence. Exported so the durable config
 *  surface strips the SAME way before persisting/showing a command template. */
function stripSecretArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = String(args[i]);
        if (AGENT_SECRET_FLAGS.has(arg.toLowerCase())) {
            out.push(arg);
            if (i + 1 < args.length) {
                out.push("<redacted>");
                i++;
            }
            continue;
        }
        const inline = arg.match(/^(--?[A-Za-z][\w-]*(?:key|token|secret|password|auth|bearer)[\w-]*)=.*/i);
        if (inline) {
            out.push(`${inline[1]}=<redacted>`);
            continue;
        }
        // Bare credential-looking token: a known provider prefix, or a long high-entropy
        // run with NO path separators (so file paths / {{...}} substitutions survive as
        // useful provenance). Over-redaction is safe; leaking a key is not.
        if (/^(sk-|ghp_|gho_|github_pat_|xox[abpr]-|Bearer\s)/.test(arg) || (arg.length >= 32 && /^[A-Za-z0-9_\-]{32,}$/.test(arg))) {
            out.push("<redacted>");
            continue;
        }
        out.push(arg);
    }
    return out;
}
/** Best-effort parse of the AGENT-reported model id from its stdout. SOLELY the
 *  agent's own report — `unreported` when absent. Never CW_AGENT_MODEL. */
function parseAgentReport(stdout) {
    const text = String(stdout || "").trim();
    if (!text)
        return {};
    const tryObj = (value) => {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    };
    let obj = tryObj(text);
    if (!obj) {
        const line = text
            .split(/\r?\n/)
            .reverse()
            .find((entry) => entry.trim().startsWith("{") && entry.trim().endsWith("}"));
        if (line)
            obj = tryObj(line.trim());
    }
    if (!obj)
        return {};
    const usage = obj.usage && typeof obj.usage === "object" ? obj.usage : undefined;
    let model = typeof obj.model === "string"
        ? obj.model
        : usage && typeof usage.model === "string"
            ? usage.model
            : typeof obj.modelId === "string"
                ? obj.modelId
                : undefined;
    // Some agents (e.g. `claude -p --output-format json`) report no top-level model;
    // the model id(s) appear as KEYS of a `modelUsage` object. Pick the primary model
    // (the one with the most input tokens). Still SOLELY the agent's own report.
    if (!model && obj.modelUsage && typeof obj.modelUsage === "object" && !Array.isArray(obj.modelUsage)) {
        const entries = Object.entries(obj.modelUsage);
        if (entries.length) {
            const tokensOf = (value) => {
                const record = value && typeof value === "object" ? value : {};
                const input = Number(record.inputTokens ?? record.input_tokens ?? 0);
                return Number.isFinite(input) ? input : 0;
            };
            entries.sort((left, right) => tokensOf(right[1]) - tokensOf(left[1]));
            model = entries[0][0];
        }
    }
    // Track 1: the executor's detached signature over its usage report, if it signs.
    // SOLELY the agent's own field — CW verifies it later against the trust key.
    const usageSignature = typeof obj.usageSignature === "string"
        ? obj.usageSignature
        : typeof obj.usage_signature === "string"
            ? obj.usage_signature
            : undefined;
    return { model, usage, usageSignature };
}
function agentSubstitutions(request, model) {
    const manifest = request.manifest;
    const workerDir = manifest?.workerDir || request.cwd || "";
    return {
        manifest: manifest?.manifestPath || (workerDir ? node_path_1.default.join(workerDir, "manifest.json") : ""),
        input: manifest?.inputPath || "",
        result: manifest?.resultPath || "",
        workerDir,
        model: model || "",
        prompt: manifest?.prompt || ""
    };
}
function substituteAgentArg(arg, subst) {
    return arg.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in subst ? subst[key] : `{{${key}}}`));
}
/** Build the recorded process handle for the envelope — secret-stripped + the
 *  agent-reported model. Same SHAPE that lands in provenance, never in evidence. */
function recordedAgentHandle(binary, endpoint, recordedArgs, model, reportedModel, reportedUsage, usageSignature) {
    const ref = binary ? [binary, ...recordedArgs].join(" ") : endpoint || "";
    return {
        kind: "process",
        ref,
        endpoint,
        metadata: {
            mode: binary ? "command" : "endpoint",
            command: binary,
            args: recordedArgs,
            model,
            reportedModel,
            // Telemetry thread-back: the agent's OWN self-reported token usage (parsed
            // from its stdout by parseAgentReport). ATTESTED, never measured by CW —
            // same red-line posture as reportedModel. Lands in provenance, never in the
            // byte-stable evidence triple. Absent when the agent reported no usage.
            ...(reportedUsage ? { reportedUsage } : {}),
            // Track 1: the executor's detached signature over its usage report. CW
            // verifies it against the operator trust key at output intake.
            ...(usageSignature ? { usageSignature } : {})
        }
    };
}
function extractEndpointResult(stdout) {
    const text = String(stdout || "").trim();
    if (!text)
        return undefined;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
            if (typeof parsed.result === "string")
                return parsed.result;
            if (typeof parsed.resultMarkdown === "string")
                return parsed.resultMarkdown;
        }
    }
    catch {
        /* not JSON — treat the raw text as the result body */
        return text;
    }
    return undefined;
}
function agentHandle(request) {
    // The agent invocation is POLICY-as-DATA, resolved flags(delegation) > env. The
    // handle records ONLY secret-stripped provenance; the raw template is re-resolved
    // inside runAgentProcess for substitution + spawning so no secret ever lands in
    // a recorded handle/evidence entry.
    const resolved = resolveAgentInvocation(request);
    if (!resolved.binary && !resolved.endpoint)
        return undefined;
    const strippedArgs = stripSecretArgs(resolved.rawArgs);
    const ref = resolved.binary ? [resolved.binary, ...strippedArgs].join(" ") : resolved.endpoint || "";
    return {
        kind: "process",
        ref,
        endpoint: resolved.endpoint,
        metadata: {
            mode: resolved.binary ? "command" : "endpoint",
            command: resolved.binary,
            args: strippedArgs,
            model: resolved.model
        }
    };
}
/** Resolve a request to a spawn-style batch job, or undefined when the agent is
 *  endpoint-configured/unconfigured (those settle through the serial path). */
function prepareAgentSpawn(request) {
    const resolved = resolveAgentInvocation(request);
    if (!resolved.binary)
        return undefined;
    const subst = agentSubstitutions(request, resolved.model);
    return {
        binary: resolved.binary,
        args: resolved.rawArgs.map((arg) => substituteAgentArg(arg, subst)),
        cwd: request.cwd,
        timeoutMs: resolved.timeoutMs || 600000
    };
}
// Reads jobs JSON on stdin, spawns ALL concurrently (shell:false, inherited env —
// the agent's own credentials resolve; CW never reads them), per-job SIGTERM at
// timeoutMs + SIGKILL at +5s, caps each captured stdout at 32MB, and prints the
// outcome array when every job has settled. stderr is drained (a full pipe must
// never wedge a child). A kill yields exitCode null — the no-exit-code refusal.
const BATCH_DELEGATE_CHILD = `
const { spawn } = require("node:child_process");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const jobs = JSON.parse(raw);
  if (!jobs.length) { process.stdout.write("[]"); return; }
  const out = new Array(jobs.length);
  let pending = jobs.length;
  const CAP = 32 * 1024 * 1024;
  jobs.forEach((job, i) => {
    let stdout = "";
    let settled = false;
    const settle = (o) => {
      if (settled) return;
      settled = true;
      out[i] = o;
      if (--pending === 0) process.stdout.write(JSON.stringify(out));
    };
    let child;
    try {
      child = spawn(job.binary, job.args, { cwd: job.cwd, env: process.env, shell: false });
    } catch (error) {
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout: "" });
      return;
    }
    const term = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, job.timeoutMs);
    const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, job.timeoutMs + 5000);
    child.stdout.on("data", (d) => { if (stdout.length < CAP) stdout += d; });
    child.stderr.on("data", () => {});
    child.on("error", (error) => {
      clearTimeout(term); clearTimeout(kill);
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout });
    });
    child.on("close", (code) => {
      clearTimeout(term); clearTimeout(kill);
      settle({ exitCode: typeof code === "number" ? code : null, stdout });
    });
  });
});
`;
/** Run a batch of agent spawns concurrently; outcomes index-align with jobs. The
 *  parent backstop timeout (max job timeout + 30s) means even a wedged delegate
 *  child cannot deadlock the drive: on any batch-level failure EVERY job settles
 *  as a fail-closed spawn refusal — never a fabricated completion, never a hang. */
function runAgentBatchOutcomes(jobs) {
    if (!jobs.length)
        return [];
    const maxTimeout = Math.max(...jobs.map((job) => job.timeoutMs));
    const child = (0, node_child_process_1.spawnSync)(process.execPath, ["-e", BATCH_DELEGATE_CHILD], {
        input: JSON.stringify(jobs),
        encoding: "utf8",
        maxBuffer: 33 * 1024 * 1024 * jobs.length,
        timeout: maxTimeout + 30000
    });
    if (!child.error && typeof child.status === "number" && child.status === 0) {
        try {
            const parsed = JSON.parse(String(child.stdout || ""));
            if (Array.isArray(parsed) && parsed.length === jobs.length)
                return parsed;
        }
        catch {
            // fall through to the fail-closed mapping below
        }
    }
    const reason = child.error ? (0, util_1.messageOf)(child.error) : `batch delegate exited ${child.status === null ? "without an exit code (timed out or killed)" : `with ${child.status}`}`;
    return jobs.map(() => ({ spawnError: `batch delegate failed: ${reason}`, exitCode: null, stdout: "" }));
}
