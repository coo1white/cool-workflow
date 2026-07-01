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
exports.reconcileBatchOutcomes = reconcileBatchOutcomes;
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
// The batch delegate child is a real, packaged Node script (not an embedded
// `node -e` string — F11). It reads jobs JSON on stdin, spawns ALL concurrently
// (shell:false, inherited env — the agent's own credentials resolve; CW never
// reads them), per-job SIGTERM at timeoutMs + SIGKILL at +5s, caps each captured
// stdout at 32MB, and streams ONE NDJSON line per job the instant it settles.
// stderr is drained (a full pipe must never wedge a child). A kill yields
// exitCode null — the no-exit-code refusal. We spawn it BY PATH (shell:false);
// the path is resolved from this compiled module (dist/execution-backend/agent.js)
// up to the package's `scripts/children/` dir, which package.json ships in "files".
const BATCH_DELEGATE_CHILD_SCRIPT = node_path_1.default.resolve(__dirname, "..", "..", "scripts", "children", "batch-delegate-child.js");
/** Parse the delegate child's NDJSON stdout and reconcile it against `jobs` by
 *  index. Runs even when `child.error` is set (ENOBUFS from the combined
 *  output exceeding maxBuffer, ETIMEDOUT from the parent backstop, or a
 *  nonzero/null exit) — a batch-level failure must fail-close ONLY the jobs
 *  whose line never fully arrived, never every job in the batch: a job whose
 *  line already streamed through keeps its REAL outcome.
 *
 *  `stdout` is split on the raw newline BYTE, on a Buffer, before any UTF-8
 *  decoding — never on a decoded string. 0x0A never appears inside a UTF-8
 *  continuation byte, so this is a safe boundary; decoding is deferred to
 *  ONE LINE at a time (bounded by the delegate's own 32MB-per-job cap), so
 *  no single decode ever approaches V8's hard per-string character ceiling
 *  regardless of how large the COMBINED batch output is. Decoding the whole
 *  combined buffer as one string up front (the prior approach) could itself
 *  throw past that ceiling for a large-enough batch — an uncaught crash, not
 *  a graceful `child.error` — which this line-at-a-time approach avoids by
 *  construction. The trailing split segment is always dropped before
 *  parsing (empty from a clean trailing newline, or a line truncated
 *  mid-write by a hard kill — either way, never a complete line), and one
 *  corrupt line can never crash the reconciliation of its siblings. */
function reconcileBatchOutcomes(jobs, child) {
    const buf = Buffer.isBuffer(child.stdout) ? child.stdout : Buffer.from(String(child.stdout || ""), "utf8");
    const byIndex = new Map();
    let lineStart = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0x0a)
            continue;
        const lineBuf = buf.subarray(lineStart, i);
        lineStart = i + 1;
        if (lineBuf.length === 0)
            continue;
        let parsed;
        try {
            parsed = JSON.parse(lineBuf.toString("utf8"));
        }
        catch {
            continue;
        }
        if (typeof parsed.i !== "number" || parsed.i < 0 || parsed.i >= jobs.length)
            continue;
        byIndex.set(parsed.i, {
            ...(parsed.spawnError ? { spawnError: parsed.spawnError } : {}),
            exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
            stdout: String(parsed.stdout || "")
        });
    }
    const reason = child.error
        ? (0, util_1.messageOf)(child.error)
        : typeof child.status === "number" && child.status !== 0
            ? `batch delegate exited with ${child.status}`
            : "batch delegate produced no outcome for this job";
    return jobs.map((_, index) => byIndex.get(index) || { spawnError: `batch delegate failed: ${reason}`, exitCode: null, stdout: "" });
}
/** Run a batch of agent spawns concurrently; outcomes index-align with jobs. The
 *  parent backstop timeout (max job timeout + 30s) means even a wedged delegate
 *  child cannot deadlock the drive. `maxBuffer` scales with batch size (the
 *  delegate's own per-job 32MB cap is the real safety bound — no separate outer
 *  ceiling here, since a flat ceiling that stops scaling with job count is
 *  exactly what let one verbose batch strand its siblings before this fix).
 *  Collect-all is a real guarantee even under buffer/timeout pressure: a job
 *  whose NDJSON line fully streamed through keeps its real outcome regardless
 *  of what happens to the rest of the batch. */
function runAgentBatchOutcomes(jobs) {
    if (!jobs.length)
        return [];
    const maxTimeout = Math.max(...jobs.map((job) => job.timeoutMs));
    // No `encoding` option: keep stdout as a raw Buffer so reconcileBatchOutcomes
    // can split on the newline byte and decode one line at a time — decoding the
    // WHOLE combined buffer as one string up front could itself throw past V8's
    // per-string character ceiling for a large-enough batch (an uncaught crash,
    // not a graceful child.error). The try/catch below is a second backstop for
    // any other unexpected native failure at this boundary — a wedged or
    // over-limit delegate must fail every job closed, never crash the drive.
    let child;
    try {
        child = (0, node_child_process_1.spawnSync)(process.execPath, [BATCH_DELEGATE_CHILD_SCRIPT], {
            input: JSON.stringify(jobs),
            maxBuffer: 34 * 1024 * 1024 * jobs.length,
            timeout: maxTimeout + 30000
        });
    }
    catch (error) {
        child = { error: error instanceof Error ? error : new Error(String(error)), status: null, stdout: null };
    }
    return reconcileBatchOutcomes(jobs, child);
}
