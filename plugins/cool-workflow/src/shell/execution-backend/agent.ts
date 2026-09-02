// shell/execution-backend/agent.ts — agent-delegation pure helpers +
// concurrent batch fulfillment.
//
// MILESTONE 5 (project/docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// the old build's execution-backend agent module. This module holds
// the PURE data-transform helpers (invocation resolution, arg substitution,
// secret redaction, report parsing) plus the batch delegate-child spawn — both
// the CLI-binary batch (runAgentBatchOutcomes) and, added later, its
// HTTP-endpoint sibling (runEndpointBatchOutcomes) so `--concurrency N` gives
// endpoint-mode agents real concurrency instead of a serial per-task spawn.
//
// THE RED LINE: CW spawns the agent and records its attested output. It
// NEVER imports a model SDK, holds an API key, or constructs a model API
// request. Any API key flows from the agent's OWN inherited env; CW never
// reads or records it. The operator-chosen CW_AGENT_MODEL is interpolated
// into `{{model}}` as policy and recorded ONLY in secret-stripped args — it
// is NEVER the attested model id.
//
// Evidence: SPEC/execution-backend.md "agent driver", "Concurrent batch".

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import {
  AgentChildOutcome,
  BackendDescriptor,
  BackendExecutionHandle,
  ExecutionRequest,
  ExecutionResultEnvelope,
  ResolvedSandboxPolicy,
  SandboxAttestation,
} from "./types";
import { buildChildEnv, CW_NEVER_FORWARD_ENV } from "./local";
import { delegatedEnvelope, refusedEnvelope } from "./envelopes";
import { withPerfTraceGroup } from "../perf-trace";

function messageOf(error: unknown): string {
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
function vendorPidFilePath(): string {
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
export function reapRecordedVendor(pidFile: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(pidFile, "utf8");
  } catch {
    return false; // no sidecar => the wrapper cleaned up (or never recorded one)
  }
  try { fs.unlinkSync(pidFile); } catch { /* already gone */ }
  const pid = Number(raw.trim());
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false; // already exited, or a pid we may not signal
  }
}

export function buildAgentChildEnv(
  policy: ResolvedSandboxPolicy,
  baseEnv: NodeJS.ProcessEnv = process.env
): { env: NodeJS.ProcessEnv; forwarded: string[] } {
  const env = buildChildEnv(policy, baseEnv);
  // deny must win here too: buildChildEnv already applied it above, but the
  // provider-key/USER re-add below exists specifically to put vars BACK
  // that buildChildEnv's readonly/locked-down defaults strip — without this
  // check that re-add silently overrode an operator's explicit deny (e.g.
  // deny:["AWS_SECRET_ACCESS_KEY"] still forwarded it, since AWS_ matches
  // AGENT_PROVIDER_KEY_ENV_RE).
  const denied = new Set(policy.env.deny || []);
  const forwarded: string[] = [];
  for (const key of Object.keys(baseEnv)) {
    if (denied.has(key)) continue;
    // Parent-only CW secrets are never re-added, even though they match the
    // CW_ arm of AGENT_PROVIDER_KEY_ENV_RE and even if the operator forgot to
    // deny them. buildChildEnv already stripped them above; this keeps the
    // re-add loop from putting them back (and out of the trust-audit
    // `forwarded` list). CW_AGENT_ATTEST_PRIVKEY is intentionally NOT in that
    // set, so the attest wrapper still gets its signing key.
    if (CW_NEVER_FORWARD_ENV.has(key)) continue;
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

export interface AgentInvocation {
  binary?: string;
  rawArgs: string[];
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

/** Resolve the agent invocation from the request delegation > env.
 *  Vendor-neutral; the durable file config is folded in by the drive layer
 *  before this point (see shell/agent-config.ts's resolveAgentConfig). */
export function resolveAgentInvocation(
  request: ExecutionRequest,
  env: NodeJS.ProcessEnv = process.env
): AgentInvocation {
  const delegation = request.delegation || {};
  const envCommand = (env.CW_AGENT_COMMAND || "").trim();
  const endpoint = delegation.endpoint || (env.CW_AGENT_ENDPOINT || "").trim() || undefined;
  const model = delegation.model || (env.CW_AGENT_MODEL || "").trim() || undefined;
  let binary = delegation.command || request.command || undefined;
  let rawArgs = delegation.args ? [...delegation.args] : request.args ? [...request.args] : [];
  if (!binary && envCommand) {
    const parts = envCommand.split(/\s+/).filter(Boolean);
    binary = parts[0];
    if (!delegation.args) rawArgs = parts.slice(1);
  } else if (binary && !delegation.args && /\s/.test(binary)) {
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
export function stripSecretArgs(args: string[]): string[] {
  const out: string[] = [];
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
    if (
      /^(sk-|ghp_|gho_|github_pat_|xox[abpr]-|Bearer\s)/.test(arg) ||
      (arg.length >= 32 && /^[A-Za-z0-9_-]{32,}$/.test(arg))
    ) {
      out.push("<redacted>");
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** Best-effort parse of the AGENT-reported model id from its stdout. SOLELY
 *  the agent's own report — `unreported` when absent. Never CW_AGENT_MODEL. */
export function parseAgentReport(
  stdout: string
): { model?: string; usage?: Record<string, unknown>; usageSignature?: string } {
  const text = String(stdout || "").trim();
  if (!text) return {};
  const tryObj = (value: string): Record<string, unknown> | undefined => {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  let obj = tryObj(text);
  if (!obj) {
    const line = text
      .split(/\r?\n/)
      .reverse()
      .find((entry) => entry.trim().startsWith("{") && entry.trim().endsWith("}"));
    if (line) obj = tryObj(line.trim());
  }
  if (!obj) return {};
  const usage = obj.usage && typeof obj.usage === "object" ? (obj.usage as Record<string, unknown>) : undefined;
  let model =
    typeof obj.model === "string"
      ? obj.model
      : usage && typeof usage.model === "string"
        ? (usage.model as string)
        : typeof obj.modelId === "string"
          ? obj.modelId
          : undefined;
  if (!model && obj.modelUsage && typeof obj.modelUsage === "object" && !Array.isArray(obj.modelUsage)) {
    const entries = Object.entries(obj.modelUsage as Record<string, unknown>);
    if (entries.length) {
      const tokensOf = (value: unknown): number => {
        const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const input = Number((record as Record<string, unknown>).inputTokens ?? (record as Record<string, unknown>).input_tokens ?? 0);
        return Number.isFinite(input) ? input : 0;
      };
      entries.sort((left, right) => tokensOf(right[1]) - tokensOf(left[1]));
      model = entries[0][0];
    }
  }
  const usageSignature =
    typeof obj.usageSignature === "string"
      ? obj.usageSignature
      : typeof obj.usage_signature === "string"
        ? (obj.usage_signature as string)
        : undefined;
  return { model, usage, usageSignature };
}

export function agentSubstitutions(request: ExecutionRequest, model?: string): Record<string, string> {
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

export function substituteAgentArg(arg: string, subst: Record<string, string>): string {
  return arg.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key in subst ? subst[key] : `{{${key}}}`));
}

/** Build the recorded process handle for the envelope — secret-stripped +
 *  the agent-reported model. Same SHAPE that lands in provenance, never in
 *  evidence. */
export function recordedAgentHandle(
  binary: string | undefined,
  endpoint: string | undefined,
  recordedArgs: string[],
  model: string | undefined,
  reportedModel: string,
  reportedUsage?: Record<string, unknown>,
  usageSignature?: string,
  forwardedEnvVars?: string[]
): BackendExecutionHandle {
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

export function extractEndpointResult(stdout: string): string | undefined {
  const text = String(stdout || "").trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      if (typeof (parsed as Record<string, unknown>).result === "string") return (parsed as Record<string, unknown>).result as string;
      if (typeof (parsed as Record<string, unknown>).resultMarkdown === "string") {
        return (parsed as Record<string, unknown>).resultMarkdown as string;
      }
    }
  } catch {
    return text;
  }
  return undefined;
}

export function agentHandle(
  request: ExecutionRequest,
  env: NodeJS.ProcessEnv = process.env
): BackendExecutionHandle | undefined {
  const resolved = resolveAgentInvocation(request, env);
  if (!resolved.binary && !resolved.endpoint) return undefined;
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

// ---------------------------------------------------------------------------
// Concurrent batch fulfillment (Track 2). See SPEC/execution-backend.md
// "Concurrent batch (Track 2)".
// ---------------------------------------------------------------------------

export interface AgentSpawnJob {
  binary: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

/** Resolve a request to a spawn-style (CLI-binary) batch job, or undefined when
 *  the agent is endpoint-configured (see prepareEndpointJob) or unconfigured
 *  (those settle through the serial path). */
export function prepareAgentSpawn(request: ExecutionRequest): AgentSpawnJob | undefined {
  const resolved = resolveAgentInvocation(request);
  if (!resolved.binary) return undefined;
  const subst = agentSubstitutions(request, resolved.model);
  return {
    binary: resolved.binary,
    args: resolved.rawArgs.map((arg) => substituteAgentArg(arg, subst)),
    cwd: request.cwd,
    timeoutMs: resolved.timeoutMs || 600000,
  };
}

export interface AgentEndpointJob {
  endpoint: string;
  /** The ALREADY-serialized POST body — byte-identical to the string the serial
   *  runAgentEndpoint builds, so the concurrent path posts the same bytes. */
  job: string;
  timeoutMs: number;
}

/** Resolve a request to an endpoint (HTTP-delegate) batch job, or undefined when
 *  the agent has a CLI binary (see prepareAgentSpawn) or is unconfigured. The
 *  POST body mirrors runAgentEndpoint's exactly: {manifest, prompt, model,
 *  resultPath, sandboxProfileId} — sandboxProfileId comes from
 *  request.sandboxPolicy.id, which runBackend sets to the same policy the serial
 *  path passes (registry.ts: `const policy = request.sandboxPolicy`), so the two
 *  paths post identical bytes. */
export function prepareEndpointJob(request: ExecutionRequest): AgentEndpointJob | undefined {
  const resolved = resolveAgentInvocation(request);
  if (resolved.binary || !resolved.endpoint) return undefined;
  const manifest = request.manifest;
  const job = JSON.stringify({
    manifest,
    prompt: manifest?.prompt,
    model: resolved.model,
    resultPath: manifest?.resultPath,
    sandboxProfileId: request.sandboxPolicy.id,
  });
  return { endpoint: resolved.endpoint, job, timeoutMs: resolved.timeoutMs || 600000 };
}

// __dirname is dist/shell/execution-backend at runtime — THREE levels up
// (execution-backend -> shell -> dist -> package root) reaches scripts/,
// a sibling of dist/, not two (that was a bug: it resolved to a
// dist/scripts/... path that is never compiled/copied there — batch
// concurrent dispatch failed closed with "batch delegate exited with 1"
// until this was traced to the wrong relative depth).
const BATCH_DELEGATE_CHILD_SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "children", "batch-delegate-child.js");

interface BatchDelegateLine {
  i?: unknown;
  spawnError?: string;
  exitCode?: number | null;
  stdout?: string;
}

/** Parse the delegate child's NDJSON stdout and reconcile it against `jobs`
 *  by index. See SPEC/execution-backend.md "Concurrent batch" for the
 *  byte-boundary rationale (split on the raw newline byte, one line at a
 *  time, never decode the whole combined buffer as one string). */
export function reconcileBatchOutcomes(
  jobs: readonly unknown[],
  child: { error?: Error | null; status: number | null; stdout?: string | Buffer | null }
): AgentChildOutcome[] {
  const buf = Buffer.isBuffer(child.stdout) ? child.stdout : Buffer.from(String(child.stdout || ""), "utf8");
  const byIndex = new Map<number, AgentChildOutcome>();
  let lineStart = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue;
    const lineBuf = buf.subarray(lineStart, i);
    lineStart = i + 1;
    if (lineBuf.length === 0) continue;
    let parsed: BatchDelegateLine;
    try {
      parsed = JSON.parse(lineBuf.toString("utf8"));
    } catch {
      continue;
    }
    if (typeof parsed.i !== "number" || parsed.i < 0 || parsed.i >= jobs.length) continue;
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
export function runAgentBatchOutcomes(jobs: AgentSpawnJob[]): AgentChildOutcome[] {
  if (!jobs.length) return [];
  return withPerfTraceGroup("agent-wait", () => {
    const maxTimeout = Math.max(...jobs.map((job) => job.timeoutMs));
    let child: { error?: Error | null; status: number | null; stdout?: Buffer | null };
    try {
      child = spawnSync(process.execPath, [BATCH_DELEGATE_CHILD_SCRIPT], {
        input: JSON.stringify(jobs),
        maxBuffer: 34 * 1024 * 1024 * jobs.length,
        timeout: maxTimeout + 30000,
      });
    } catch (error) {
      child = { error: error instanceof Error ? error : new Error(String(error)), status: null, stdout: null };
    }
    return reconcileBatchOutcomes(jobs, child);
  });
}

// Same package-root depth fix as BATCH_DELEGATE_CHILD_SCRIPT above.
const HTTP_BATCH_DELEGATE_CHILD_SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "children", "http-batch-delegate-child.js");

/** Run a batch of ENDPOINT (HTTP-delegate) jobs concurrently; outcomes
 *  index-align with jobs. The endpoint sibling of runAgentBatchOutcomes: one
 *  spawnSync of http-batch-delegate-child.js POSTs all N at once from a single
 *  process, so `--concurrency N` with an endpoint agent runs N delegations in
 *  parallel instead of serially. The child streams the SAME NDJSON line shape as
 *  batch-delegate-child.js — `{i, spawnError?, exitCode, stdout}` — so the same
 *  reconcileBatchOutcomes reads it (byte-boundary split on a Buffer, index-aligned,
 *  every job that produced no full line failed closed). Env is inherited (the
 *  serial runAgentEndpoint likewise runs the child with the full process env for
 *  any endpoint auth); no sandbox child-env is built here, matching the serial
 *  endpoint path. */
export function runEndpointBatchOutcomes(jobs: AgentEndpointJob[]): AgentChildOutcome[] {
  if (!jobs.length) return [];
  const maxTimeout = Math.max(...jobs.map((job) => job.timeoutMs));
  let child: { error?: Error | null; status: number | null; stdout?: Buffer | null };
  try {
    child = spawnSync(process.execPath, [HTTP_BATCH_DELEGATE_CHILD_SCRIPT], {
      input: JSON.stringify(jobs),
      maxBuffer: 34 * 1024 * 1024 * jobs.length,
      timeout: maxTimeout + 30000,
    });
  } catch (error) {
    child = { error: error instanceof Error ? error : new Error(String(error)), status: null, stdout: null };
  }
  return reconcileBatchOutcomes(jobs, child);
}

// ---------------------------------------------------------------------------
// The stateful agent runners (spawn + settle). Byte-exact port of the old
// build's execution-backend module's runAgentProcess, runAgentEndpoint,
// and shouldStreamAgentStderr.
// ---------------------------------------------------------------------------

/** Decide whether cw FORWARDS the agent wrapper's live stderr view (stdio
 *  "inherit") or captures it ("pipe"). CW_NO_STREAM=1 wins over everything;
 *  CW_AGENT_STREAM=0/1 are explicit off/on; else follow isTTY. */
export function shouldStreamAgentStderr(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (env.CW_NO_STREAM === "1") return false;
  if (env.CW_AGENT_STREAM === "0") return false;
  if (env.CW_AGENT_STREAM === "1") return true;
  return isTTY;
}

// Same package-root depth fix as BATCH_DELEGATE_CHILD_SCRIPT above.
const HTTP_DELEGATE_CHILD_SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "children", "http-delegate-child.js");

/** agent — spawns an EXTERNAL agent process per worker argv-style
 *  (shell:false), or POSTs the manifest to a configured HTTP agent
 *  endpoint. Byte-exact port of the old build's execution-backend module. */
export function runAgentProcess(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const resolved = resolveAgentInvocation(request);
  const subst = agentSubstitutions(request, resolved.model);

  if (resolved.binary) {
    const realArgs = resolved.rawArgs.map((arg) => substituteAgentArg(arg, subst));
    const recordedArgs = stripSecretArgs(realArgs);
    let outcome: AgentChildOutcome;
    // Names only, never values — for the worker.agent-env trust-audit event
    // below. Stays empty for a preparedAgentOutcome (a batch-delegated child
    // that already ran elsewhere; this code path forwards nothing itself).
    let forwardedEnvVars: string[] = [];
    if (request.preparedAgentOutcome) {
      outcome = request.preparedAgentOutcome;
    } else {
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
      const child = withPerfTraceGroup("agent-wait", () =>
        spawnSync(resolved.binary!, realArgs, {
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
        })
      );
      // A timeout surfaces as child.error with code ETIMEDOUT (status null,
      // signal set). Classify it FIRST: without this, the generic spawnError
      // branch below reported "agent process failed to spawn: ...ETIMEDOUT"
      // and the null-exit-code "timed out or killed" branch was dead code
      // for real timeouts.
      if (child.error && (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
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
        return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent process timed out after ${timeoutMs}ms and was killed (SIGKILL)`, {
          ...attestation,
          handle: handleOut,
        });
      }
      // Non-timeout paths: a wrapper that ran to any normal end removed its own
      // sidecar on exit; clear any stray file best-effort so tmp cannot grow.
      try { fs.unlinkSync(vendorPidFile); } catch { /* usually already gone */ }
      outcome = {
        ...(child.error ? { spawnError: messageOf(child.error) } : {}),
        exitCode: typeof child.status === "number" ? child.status : null,
        stdout: String(child.stdout || ""),
      };
    }
    if (outcome.spawnError) {
      const handleOut = recordedAgentHandle(resolved.binary, undefined, recordedArgs, resolved.model, "unreported", undefined, undefined, forwardedEnvVars);
      return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent process failed to spawn: ${outcome.spawnError}`, {
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
      return refusedEnvelope(
        descriptor,
        policy,
        label,
        "delegation-failed",
        `agent process returned no exit code (timed out or killed)`,
        { ...attestation, handle: handleOut }
      );
    }
    return delegatedEnvelope(descriptor, label, handleOut, { ...attestation, handle: handleOut }, resolved.binary, recordedArgs, exitCode, stdout);
  }

  if (resolved.endpoint) {
    return runAgentEndpoint(descriptor, policy, request, label, resolved, attestation);
  }

  return refusedEnvelope(
    descriptor,
    policy,
    label,
    "delegation-target-missing",
    `Backend ${descriptor.id} has no command-template or endpoint configured`,
    attestation
  );
}

/** Settle a completed endpoint delegation (a numeric exitCode + stdout) into
 *  its envelope: parse the agent report, write result.md as transport when the
 *  runner returned a body and none exists yet, record the handle. Shared by the
 *  serial spawn path and the concurrent prepared-outcome path so the two never
 *  drift. The result-write stays HERE (the cw shell process), never in the batch
 *  child, so the child does no filesystem writes into the run dir. */
function settleEndpointResult(
  descriptor: BackendDescriptor,
  label: string,
  endpoint: string,
  resolvedModel: string | undefined,
  manifest: ExecutionRequest["manifest"],
  attestation: SandboxAttestation,
  exitCode: number,
  stdout: string
): ExecutionResultEnvelope {
  const report = parseAgentReport(stdout);
  if (manifest?.resultPath && report.usage === undefined) {
    const body = extractEndpointResult(stdout);
    if (body && !fs.existsSync(manifest.resultPath)) {
      try {
        fs.writeFileSync(manifest.resultPath, body, "utf8");
      } catch {
        /* the accept layer will fail closed on a missing result.md */
      }
    }
  }
  const reportedModel = report.model && report.model.trim() ? report.model.trim() : "unreported";
  const handleOut = recordedAgentHandle(undefined, endpoint, [], resolvedModel, reportedModel, report.usage, report.usageSignature);
  return delegatedEnvelope(descriptor, label, handleOut, { ...attestation, handle: handleOut }, "agent-endpoint", [endpoint], exitCode, stdout);
}

/** Agent HTTP endpoint variant — POSTs the worker manifest/prompt to a
 *  configured agent endpoint via the shared Node delegate child. Byte-exact
 *  port of the old build's execution-backend module, plus a prepared-outcome branch:
 *  in a concurrent round the POST already ran in the batch child
 *  (runEndpointBatchOutcomes), so settle that pre-collected outcome instead of
 *  spawning again. The serial (no prepared outcome) path is unchanged. */
function runAgentEndpoint(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  resolved: AgentInvocation,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const endpoint = resolved.endpoint as string;
  const manifest = request.manifest;
  const baseHandle = recordedAgentHandle(undefined, endpoint, [], resolved.model, "unreported");

  // Concurrent round: the batch child already POSTed and settled this job. Any
  // failure (network, non-2xx, poll, unparseable, timeout, no exitCode) is a
  // spawnError; a success carries a numeric exitCode + stdout.
  if (request.preparedAgentOutcome) {
    const prep = request.preparedAgentOutcome;
    if (prep.spawnError) {
      // Match the SERIAL path's refusal wording so a concurrent round records the
      // same reason bytes as a serial one. A per-job HTTP failure (non-2xx, poll,
      // timeout, no exitCode) is the serial `{error}` branch — `agent endpoint
      // error:`. A whole-batch-child process failure surfaces as
      // reconcileBatchOutcomes' `batch delegate failed:` fallback — the serial
      // analog is `child.error` — `agent endpoint delegation failed:`.
      const summary = prep.spawnError.startsWith("batch delegate failed:")
        ? `agent endpoint delegation failed: ${prep.spawnError}`
        : `agent endpoint error: ${prep.spawnError}`;
      return refusedEnvelope(descriptor, policy, label, "delegation-failed", summary, {
        ...attestation,
        handle: baseHandle,
      });
    }
    // Defensive: the batch child always pairs a null exitCode with a spawnError,
    // so this is unreachable in practice — kept as a fail-closed backstop with
    // the same wording the serial no-exitCode refusal uses.
    if (typeof prep.exitCode !== "number") {
      return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent endpoint error: no exitCode reported`, {
        ...attestation,
        handle: baseHandle,
      });
    }
    return settleEndpointResult(descriptor, label, endpoint, resolved.model, manifest, attestation, prep.exitCode, prep.stdout);
  }

  const job = JSON.stringify({
    manifest,
    prompt: manifest?.prompt,
    model: resolved.model,
    resultPath: manifest?.resultPath,
    sandboxProfileId: policy.id,
  });
  const child = spawnSync(process.execPath, [HTTP_DELEGATE_CHILD_SCRIPT], {
    input: job,
    env: { ...process.env, CW_DELEGATE_ENDPOINT: endpoint },
    encoding: "utf8",
    timeout: resolved.timeoutMs || 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.error) {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent endpoint delegation failed: ${messageOf(child.error)}`, {
      ...attestation,
      handle: baseHandle,
    });
  }
  let parsed: { exitCode?: number; stdout?: string; error?: string };
  try {
    parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
  } catch {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent endpoint returned an unparseable response`, {
      ...attestation,
      handle: baseHandle,
    });
  }
  if (parsed.error || typeof parsed.exitCode !== "number") {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent endpoint error: ${parsed.error || "no exitCode reported"}`, {
      ...attestation,
      handle: baseHandle,
    });
  }
  return settleEndpointResult(descriptor, label, endpoint, resolved.model, manifest, attestation, parsed.exitCode, String(parsed.stdout || ""));
}
