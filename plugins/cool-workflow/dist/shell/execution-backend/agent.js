"use strict";
// shell/execution-backend/agent.ts — agent-delegation pure helpers +
// concurrent batch fulfillment.
//
// MILESTONE 5 (docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend/agent.ts. This module holds
// the PURE data-transform helpers (invocation resolution, arg substitution,
// secret redaction, report parsing) plus the batch delegate-child spawn.
//
// THE RED LINE: CW spawns the agent and records its attested output. It
// NEVER imports a model SDK, holds an API key, or constructs a model API
// request. Any API key flows from the agent's OWN inherited env; CW never
// reads or records it. The operator-chosen CW_AGENT_MODEL is interpolated
// into `{{model}}` as policy and recorded ONLY in secret-stripped args — it
// is NEVER the attested model id.
//
// Evidence: SPEC/execution-backend.md "agent driver", "Concurrent batch".
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.reapRecordedVendor = reapRecordedVendor;
exports.buildAgentChildEnv = buildAgentChildEnv;
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
exports.shouldStreamAgentStderr = shouldStreamAgentStderr;
exports.runAgentProcess = runAgentProcess;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const node_child_process_1 = require("node:child_process");
const local_1 = require("./local");
const envelopes_1 = require("./envelopes");
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
const AGENT_PROVIDER_KEY_ENV_RE = /^(CW_|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|CODEX_|GOOGLE_|COHERE_|MISTRAL_|OLLAMA_|AZURE_|AWS_)/i;
/** Build the env for a REAL spawned agent child under a sandbox policy: the
 *  policy's own PATH+HOME+expose/deny base (buildChildEnv), plus provider-key
 *  vars (the CW_, ANTHROPIC_, etc. prefixes), plus USER. USER is not a provider key, but a
 *  real vendor CLI (claude, at least) reads it to resolve its own OS-level
 *  login/keychain credential in headless mode -- buildChildEnv alone keeps
 *  only PATH+HOME under the readonly policy, so a spawned agent that IS
 *  logged in interactively reported "Not logged in" here. Found live: PATH+
 *  HOME alone reproduces it, adding USER back fixes it, LOGNAME alone does
 *  not. This is the ONE place that builds this env -- the single-request
 *  (runAgentProcess) and concurrent-batch (shell/drive.ts) spawn paths both
 *  call it, so the allowlist cannot drift into a second silent copy again.
 *  Returns the forwarded var NAMES too (never values) for the
 *  worker.agent-env trust-audit event. */
/** A unique sidecar path a shipped wrapper writes its vendor child's PID to
 *  (via the env CW_AGENT_VENDOR_PIDFILE we set below), so cw can reap the
 *  vendor if it has to SIGKILL the wrapper on a timeout. */
function vendorPidFilePath() {
    return path.join(os.tmpdir(), `cw-agent-vendor-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`);
}
/** Reap the vendor process a shipped wrapper recorded, then remove the sidecar.
 *  A wrapper that exited cleanly already removed the file, so this is a no-op
 *  then; only a wrapper cw SIGKILLed on a timeout leaves a live vendor PID
 *  here. Best-effort and race-tolerant: a missing file, an unparseable/too-low
 *  PID, or an already-gone process are all silently fine. Scope: kills the
 *  vendor process itself (the token spender), not a deeper grandchild tree,
 *  and only for the shipped vendor wrappers (claude, codex, gemini, and
 *  opencode/deepseek) -- an arbitrary CW_AGENT_COMMAND records no PID and is
 *  not covered. Returns true only if it
 *  actually signalled a process. Exported for tests; agent.ts is not part of
 *  the package public surface (index.ts). */
function reapRecordedVendor(pidFile) {
    let raw;
    try {
        raw = fs.readFileSync(pidFile, "utf8");
    }
    catch {
        return false; // no sidecar => the wrapper cleaned up (or never recorded one)
    }
    try {
        fs.unlinkSync(pidFile);
    }
    catch { /* already gone */ }
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 1)
        return false;
    try {
        process.kill(pid, "SIGKILL");
        return true;
    }
    catch {
        return false; // already exited, or a pid we may not signal
    }
}
function buildAgentChildEnv(policy, baseEnv = process.env) {
    const env = (0, local_1.buildChildEnv)(policy, baseEnv);
    // deny must win here too: buildChildEnv already applied it above, but the
    // provider-key/USER re-add below exists specifically to put vars BACK
    // that buildChildEnv's readonly/locked-down defaults strip — without this
    // check that re-add silently overrode an operator's explicit deny (e.g.
    // deny:["AWS_SECRET_ACCESS_KEY"] still forwarded it, since AWS_ matches
    // AGENT_PROVIDER_KEY_ENV_RE).
    const denied = new Set(policy.env.deny || []);
    const forwarded = [];
    for (const key of Object.keys(baseEnv)) {
        if (denied.has(key))
            continue;
        // Parent-only CW secrets are never re-added, even though they match the
        // CW_ arm of AGENT_PROVIDER_KEY_ENV_RE and even if the operator forgot to
        // deny them. buildChildEnv already stripped them above; this keeps the
        // re-add loop from putting them back (and out of the trust-audit
        // `forwarded` list). CW_AGENT_ATTEST_PRIVKEY is intentionally NOT in that
        // set, so the attest wrapper still gets its signing key.
        if (local_1.CW_NEVER_FORWARD_ENV.has(key))
            continue;
        if (AGENT_PROVIDER_KEY_ENV_RE.test(key)) {
            env[key] = baseEnv[key];
            forwarded.push(key);
        }
    }
    if (!denied.has("USER") && baseEnv.USER !== undefined && env.USER === undefined) {
        env.USER = baseEnv.USER;
        forwarded.push("USER");
    }
    return { env, forwarded };
}
/** Resolve the agent invocation from the request delegation > env.
 *  Vendor-neutral; the durable file config is folded in by the drive layer
 *  before this point (see shell/agent-config.ts's resolveAgentConfig). */
function resolveAgentInvocation(request, env = process.env) {
    const delegation = request.delegation || {};
    const envCommand = (env.CW_AGENT_COMMAND || "").trim();
    const endpoint = delegation.endpoint || (env.CW_AGENT_ENDPOINT || "").trim() || undefined;
    const model = delegation.model || (env.CW_AGENT_MODEL || "").trim() || undefined;
    let binary = delegation.command || request.command || undefined;
    let rawArgs = delegation.args ? [...delegation.args] : request.args ? [...request.args] : [];
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
const AGENT_SECRET_FLAGS = new Set([
    "--api-key",
    "--apikey",
    "--token",
    "--key",
    "--secret",
    "--password",
    "--auth",
    "--bearer",
]);
/** Redact secrets from recorded agent args: a value FOLLOWING a known secret
 *  flag, an `--x-key=...` inline value, or a token that LOOKS like a
 *  credential. Never record a raw secret in provenance/evidence. */
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
        if (/^(sk-|ghp_|gho_|github_pat_|xox[abpr]-|Bearer\s)/.test(arg) ||
            (arg.length >= 32 && /^[A-Za-z0-9_-]{32,}$/.test(arg))) {
            out.push("<redacted>");
            continue;
        }
        out.push(arg);
    }
    return out;
}
/** Best-effort parse of the AGENT-reported model id from its stdout. SOLELY
 *  the agent's own report — `unreported` when absent. Never CW_AGENT_MODEL. */
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
        manifest: manifest?.manifestPath || (workerDir ? path.join(workerDir, "manifest.json") : ""),
        input: manifest?.inputPath || "",
        result: manifest?.resultPath || "",
        workerDir,
        model: model || "",
        prompt: manifest?.prompt || "",
    };
}
function substituteAgentArg(arg, subst) {
    return arg.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in subst ? subst[key] : `{{${key}}}`));
}
/** Build the recorded process handle for the envelope — secret-stripped +
 *  the agent-reported model. Same SHAPE that lands in provenance, never in
 *  evidence. */
function recordedAgentHandle(binary, endpoint, recordedArgs, model, reportedModel, reportedUsage, usageSignature, forwardedEnvVars) {
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
            ...(reportedUsage ? { reportedUsage } : {}),
            ...(usageSignature ? { usageSignature } : {}),
            ...(forwardedEnvVars && forwardedEnvVars.length ? { forwardedEnvVars } : {}),
        },
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
            if (typeof parsed.resultMarkdown === "string") {
                return parsed.resultMarkdown;
            }
        }
    }
    catch {
        return text;
    }
    return undefined;
}
function agentHandle(request, env = process.env) {
    const resolved = resolveAgentInvocation(request, env);
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
            model: resolved.model,
        },
    };
}
/** Resolve a request to a spawn-style batch job, or undefined when the agent
 *  is endpoint-configured/unconfigured (those settle through the serial
 *  path). */
function prepareAgentSpawn(request) {
    const resolved = resolveAgentInvocation(request);
    if (!resolved.binary)
        return undefined;
    const subst = agentSubstitutions(request, resolved.model);
    return {
        binary: resolved.binary,
        args: resolved.rawArgs.map((arg) => substituteAgentArg(arg, subst)),
        cwd: request.cwd,
        timeoutMs: resolved.timeoutMs || 600000,
    };
}
// __dirname is dist/shell/execution-backend at runtime — THREE levels up
// (execution-backend -> shell -> dist -> package root) reaches scripts/,
// a sibling of dist/, not two (that was a bug: it resolved to a
// dist/scripts/... path that is never compiled/copied there — batch
// concurrent dispatch failed closed with "batch delegate exited with 1"
// until this was traced to the wrong relative depth).
const BATCH_DELEGATE_CHILD_SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "children", "batch-delegate-child.js");
/** Parse the delegate child's NDJSON stdout and reconcile it against `jobs`
 *  by index. See SPEC/execution-backend.md "Concurrent batch" for the
 *  byte-boundary rationale (split on the raw newline byte, one line at a
 *  time, never decode the whole combined buffer as one string). */
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
            stdout: String(parsed.stdout || ""),
        });
    }
    const reason = child.error
        ? messageOf(child.error)
        : typeof child.status === "number" && child.status !== 0
            ? `batch delegate exited with ${child.status}`
            : "batch delegate produced no outcome for this job";
    return jobs.map((_, index) => byIndex.get(index) || { spawnError: `batch delegate failed: ${reason}`, exitCode: null, stdout: "" });
}
/** Run a batch of agent spawns concurrently; outcomes index-align with
 *  jobs. See SPEC/execution-backend.md's rebuild-risk note on maxBuffer
 *  scaling with job count and the no-`encoding` (raw Buffer) requirement. */
function runAgentBatchOutcomes(jobs) {
    if (!jobs.length)
        return [];
    const maxTimeout = Math.max(...jobs.map((job) => job.timeoutMs));
    let child;
    try {
        child = (0, node_child_process_1.spawnSync)(process.execPath, [BATCH_DELEGATE_CHILD_SCRIPT], {
            input: JSON.stringify(jobs),
            maxBuffer: 34 * 1024 * 1024 * jobs.length,
            timeout: maxTimeout + 30000,
        });
    }
    catch (error) {
        child = { error: error instanceof Error ? error : new Error(String(error)), status: null, stdout: null };
    }
    return reconcileBatchOutcomes(jobs, child);
}
// ---------------------------------------------------------------------------
// The stateful agent runners (spawn + settle). Byte-exact port of
// src/execution-backend.ts's runAgentProcess (:915-995), runAgentEndpoint
// (:1002-1062), and shouldStreamAgentStderr (:908-913).
// ---------------------------------------------------------------------------
/** Decide whether cw FORWARDS the agent wrapper's live stderr view (stdio
 *  "inherit") or captures it ("pipe"). CW_NO_STREAM=1 wins over everything;
 *  CW_AGENT_STREAM=0/1 are explicit off/on; else follow isTTY. */
function shouldStreamAgentStderr(env, isTTY) {
    if (env.CW_NO_STREAM === "1")
        return false;
    if (env.CW_AGENT_STREAM === "0")
        return false;
    if (env.CW_AGENT_STREAM === "1")
        return true;
    return isTTY;
}
// Same package-root depth fix as BATCH_DELEGATE_CHILD_SCRIPT above.
const HTTP_DELEGATE_CHILD_SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "children", "http-delegate-child.js");
/** agent — spawns an EXTERNAL agent process per worker argv-style
 *  (shell:false), or POSTs the manifest to a configured HTTP agent
 *  endpoint. Byte-exact port of src/execution-backend.ts:915-995. */
function runAgentProcess(descriptor, policy, request, label, attestation) {
    const resolved = resolveAgentInvocation(request);
    const subst = agentSubstitutions(request, resolved.model);
    if (resolved.binary) {
        const realArgs = resolved.rawArgs.map((arg) => substituteAgentArg(arg, subst));
        const recordedArgs = stripSecretArgs(realArgs);
        let outcome;
        // Names only, never values — for the worker.agent-env trust-audit event
        // below. Stays empty for a preparedAgentOutcome (a batch-delegated child
        // that already ran elsewhere; this code path forwards nothing itself).
        let forwardedEnvVars = [];
        if (request.preparedAgentOutcome) {
            outcome = request.preparedAgentOutcome;
        }
        else {
            const streamStderr = shouldStreamAgentStderr(process.env, Boolean(process.stderr.isTTY));
            const built = buildAgentChildEnv(policy);
            forwardedEnvVars = built.forwarded;
            const timeoutMs = resolved.timeoutMs || 600000;
            // A shipped wrapper (claude/codex/gemini) records its vendor child's PID
            // here so we can reap the vendor if the timeout below SIGKILLs the
            // wrapper -- a SIGKILL is uncatchable, so the wrapper cannot forward the
            // stop itself. Not a forwarded secret; it is cw plumbing, so it stays out
            // of `built.forwarded` / the trust-audit forwarded list.
            const vendorPidFile = vendorPidFilePath();
            const childEnv = { ...built.env, CW_AGENT_VENDOR_PIDFILE: vendorPidFile };
            const child = (0, node_child_process_1.spawnSync)(resolved.binary, realArgs, {
                cwd: request.cwd,
                env: childEnv,
                encoding: "utf8",
                timeout: timeoutMs,
                maxBuffer: 32 * 1024 * 1024,
                shell: false,
                // SIGKILL, not the default SIGTERM: an agent wrapper that ignores
                // SIGTERM would leave this blocking spawnSync waiting forever (no
                // second-stage escalation is possible from inside a sync call), and
                // a timed-out agent's output is discarded by the refusal below
                // anyway — so a hard kill loses nothing and cannot wedge cw.
                killSignal: "SIGKILL",
                stdio: ["ignore", "pipe", streamStderr ? "inherit" : "pipe"],
            });
            // A timeout surfaces as child.error with code ETIMEDOUT (status null,
            // signal set). Classify it FIRST: without this, the generic spawnError
            // branch below reported "agent process failed to spawn: ...ETIMEDOUT"
            // and the null-exit-code "timed out or killed" branch was dead code
            // for real timeouts.
            if (child.error && child.error.code === "ETIMEDOUT") {
                // spawnSync SIGKILLed the wrapper (uncatchable, so the wrapper could
                // not forward the stop to its vendor child). Reap the vendor a shipped
                // wrapper recorded, so a timed-out agent's vendor process does not live
                // on as an orphan and keep spending. Scoped: reaps the vendor process
                // itself for the shipped wrappers (claude, codex, gemini, opencode/
                // deepseek), not a deeper grandchild tree nor an arbitrary
                // CW_AGENT_COMMAND (which records no PID). We do
                // NOT use `detached:true` -- that would make the wrapper its own group
                // leader, so an interactive Ctrl-C / a group SIGINT to cw would no
                // longer reach it (strictly worse); reaping from the recorded PID keeps
                // the wrapper in cw's group.
                reapRecordedVendor(vendorPidFile);
                const handleOut = recordedAgentHandle(resolved.binary, undefined, recordedArgs, resolved.model, "unreported", undefined, undefined, forwardedEnvVars);
                return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `agent process timed out after ${timeoutMs}ms and was killed (SIGKILL)`, {
                    ...attestation,
                    handle: handleOut,
                });
            }
            // Non-timeout paths: a wrapper that ran to any normal end removed its own
            // sidecar on exit; clear any stray file best-effort so tmp cannot grow.
            try {
                fs.unlinkSync(vendorPidFile);
            }
            catch { /* usually already gone */ }
            outcome = {
                ...(child.error ? { spawnError: messageOf(child.error) } : {}),
                exitCode: typeof child.status === "number" ? child.status : null,
                stdout: String(child.stdout || ""),
            };
        }
        if (outcome.spawnError) {
            const handleOut = recordedAgentHandle(resolved.binary, undefined, recordedArgs, resolved.model, "unreported", undefined, undefined, forwardedEnvVars);
            return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `agent process failed to spawn: ${outcome.spawnError}`, {
                ...attestation,
                handle: handleOut,
            });
        }
        const exitCode = outcome.exitCode;
        const stdout = outcome.stdout;
        const report = parseAgentReport(stdout);
        const reportedModel = report.model && report.model.trim() ? report.model.trim() : "unreported";
        const handleOut = recordedAgentHandle(resolved.binary, undefined, recordedArgs, resolved.model, reportedModel, report.usage, report.usageSignature, forwardedEnvVars);
        if (exitCode === null) {
            return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `agent process returned no exit code (timed out or killed)`, { ...attestation, handle: handleOut });
        }
        return (0, envelopes_1.delegatedEnvelope)(descriptor, label, handleOut, { ...attestation, handle: handleOut }, resolved.binary, recordedArgs, exitCode, stdout);
    }
    if (resolved.endpoint) {
        return runAgentEndpoint(descriptor, policy, request, label, resolved, attestation);
    }
    return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-target-missing", `Backend ${descriptor.id} has no command-template or endpoint configured`, attestation);
}
/** Agent HTTP endpoint variant — POSTs the worker manifest/prompt to a
 *  configured agent endpoint via the shared Node delegate child. Byte-exact
 *  port of src/execution-backend.ts:1002-1062. */
function runAgentEndpoint(descriptor, policy, request, label, resolved, attestation) {
    const endpoint = resolved.endpoint;
    const manifest = request.manifest;
    const job = JSON.stringify({
        manifest,
        prompt: manifest?.prompt,
        model: resolved.model,
        resultPath: manifest?.resultPath,
        sandboxProfileId: policy.id,
    });
    const child = (0, node_child_process_1.spawnSync)(process.execPath, [HTTP_DELEGATE_CHILD_SCRIPT], {
        input: job,
        env: { ...process.env, CW_DELEGATE_ENDPOINT: endpoint },
        encoding: "utf8",
        timeout: resolved.timeoutMs || 600000,
        maxBuffer: 32 * 1024 * 1024,
    });
    const baseHandle = recordedAgentHandle(undefined, endpoint, [], resolved.model, "unreported");
    if (child.error) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `agent endpoint delegation failed: ${messageOf(child.error)}`, {
            ...attestation,
            handle: baseHandle,
        });
    }
    let parsed;
    try {
        parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
    }
    catch {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `agent endpoint returned an unparseable response`, {
            ...attestation,
            handle: baseHandle,
        });
    }
    if (parsed.error || typeof parsed.exitCode !== "number") {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `agent endpoint error: ${parsed.error || "no exitCode reported"}`, {
            ...attestation,
            handle: baseHandle,
        });
    }
    const stdout = String(parsed.stdout || "");
    const report = parseAgentReport(stdout);
    if (manifest?.resultPath && report.usage === undefined) {
        const body = extractEndpointResult(stdout);
        if (body && !fs.existsSync(manifest.resultPath)) {
            try {
                fs.writeFileSync(manifest.resultPath, body, "utf8");
            }
            catch {
                /* the accept layer will fail closed on a missing result.md */
            }
        }
    }
    const reportedModel = report.model && report.model.trim() ? report.model.trim() : "unreported";
    const handleOut = recordedAgentHandle(undefined, endpoint, [], resolved.model, reportedModel, report.usage, report.usageSignature);
    return (0, envelopes_1.delegatedEnvelope)(descriptor, label, handleOut, { ...attestation, handle: handleOut }, "agent-endpoint", [endpoint], parsed.exitCode, stdout);
}
