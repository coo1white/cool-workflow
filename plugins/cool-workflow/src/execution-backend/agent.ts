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
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AgentChildOutcome, BackendExecutionHandle, ExecutionRequest } from "../types";
import { messageOf } from "./util";

export interface AgentInvocation {
  binary?: string;
  rawArgs: string[];
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

/** Resolve the agent invocation from the request delegation > env. Vendor-neutral;
 *  the durable file config is folded in by the drive layer before this point. */
export function resolveAgentInvocation(request: ExecutionRequest): AgentInvocation {
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
    if (!delegation.args) rawArgs = parts.slice(1);
  } else if (binary && !delegation.args && /\s/.test(binary)) {
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
export function parseAgentReport(stdout: string): { model?: string; usage?: Record<string, unknown>; usageSignature?: string } {
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
  // Some agents (e.g. `claude -p --output-format json`) report no top-level model;
  // the model id(s) appear as KEYS of a `modelUsage` object. Pick the primary model
  // (the one with the most input tokens). Still SOLELY the agent's own report.
  if (!model && obj.modelUsage && typeof obj.modelUsage === "object" && !Array.isArray(obj.modelUsage)) {
    const entries = Object.entries(obj.modelUsage as Record<string, unknown>);
    if (entries.length) {
      const tokensOf = (value: unknown): number => {
        const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const input = Number(record.inputTokens ?? record.input_tokens ?? 0);
        return Number.isFinite(input) ? input : 0;
      };
      entries.sort((left, right) => tokensOf(right[1]) - tokensOf(left[1]));
      model = entries[0][0];
    }
  }
  // Track 1: the executor's detached signature over its usage report, if it signs.
  // SOLELY the agent's own field — CW verifies it later against the trust key.
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
    prompt: manifest?.prompt || ""
  };
}

export function substituteAgentArg(arg: string, subst: Record<string, string>): string {
  return arg.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key in subst ? subst[key] : `{{${key}}}`));
}

/** Build the recorded process handle for the envelope — secret-stripped + the
 *  agent-reported model. Same SHAPE that lands in provenance, never in evidence. */
export function recordedAgentHandle(
  binary: string | undefined,
  endpoint: string | undefined,
  recordedArgs: string[],
  model: string | undefined,
  reportedModel: string,
  reportedUsage?: Record<string, unknown>,
  usageSignature?: string
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

export function extractEndpointResult(stdout: string): string | undefined {
  const text = String(stdout || "").trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      if (typeof (parsed as Record<string, unknown>).result === "string") return (parsed as Record<string, unknown>).result as string;
      if (typeof (parsed as Record<string, unknown>).resultMarkdown === "string") return (parsed as Record<string, unknown>).resultMarkdown as string;
    }
  } catch {
    /* not JSON — treat the raw text as the result body */
    return text;
  }
  return undefined;
}

export function agentHandle(request: ExecutionRequest): BackendExecutionHandle | undefined {
  // The agent invocation is POLICY-as-DATA, resolved flags(delegation) > env. The
  // handle records ONLY secret-stripped provenance; the raw template is re-resolved
  // inside runAgentProcess for substitution + spawning so no secret ever lands in
  // a recorded handle/evidence entry.
  const resolved = resolveAgentInvocation(request);
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
      model: resolved.model
    }
  };
}

// ---------------------------------------------------------------------------
// Concurrent batch fulfillment (Track 2). The drive's concurrent round collects
// agent child outcomes for a whole batch in ONE wall-clock window, then settles
// each through runBackend with `preparedAgentOutcome` — so envelopes, refusals
// and accept-time gates are the exact serial code path. The parallelism lives in
// a single spawnSync'd Node delegate child (same pattern as the http delegate child):
// the parent stays fully synchronous (no public-API async contagion), the child
// spawns all agents concurrently and enforces the per-job timeout itself
// (SIGTERM at the deadline, SIGKILL after a 5s grace) — a hung agent is KILLED
// and counted as one failure (no exit code → the existing fail-closed refusal),
// never a deadlock. Collect-all: a failing job NEVER aborts its siblings; every
// job settles and is recorded.
// ---------------------------------------------------------------------------

/** One prepared agent spawn: the resolved argv for a batch job. Secrets stay in
 *  the in-memory job (the child needs the real argv); recorded provenance is
 *  secret-stripped by the settle path exactly as the serial path does. */
export interface AgentSpawnJob {
  binary: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

/** Resolve a request to a spawn-style batch job, or undefined when the agent is
 *  endpoint-configured/unconfigured (those settle through the serial path). */
export function prepareAgentSpawn(request: ExecutionRequest): AgentSpawnJob | undefined {
  const resolved = resolveAgentInvocation(request);
  if (!resolved.binary) return undefined;
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
const BATCH_DELEGATE_CHILD_SCRIPT = path.resolve(__dirname, "..", "..", "scripts", "children", "batch-delegate-child.js");

/** One NDJSON line from the delegate child, before the wire-only `i` index tag
 *  is stripped back out. Private to this module — never part of the public
 *  `AgentChildOutcome` shape. */
interface BatchDelegateLine {
  i?: unknown;
  spawnError?: string;
  exitCode?: number | null;
  stdout?: string;
}

/** Parse the delegate child's NDJSON stdout and reconcile it against `jobs` by
 *  index. Runs even when `child.error` is set (ENOBUFS from the combined
 *  output exceeding maxBuffer, ETIMEDOUT from the parent backstop, or a
 *  nonzero/null exit) — a batch-level failure must fail-close ONLY the jobs
 *  whose line never fully arrived, never every job in the batch: a job whose
 *  line already streamed through keeps its REAL outcome. The last split
 *  segment is always dropped before parsing (it is either the empty string
 *  from a clean trailing newline, or a line truncated mid-write by a hard
 *  kill — either way, never a complete line, so never worth parsing), and one
 *  corrupt line can never crash the reconciliation of its siblings. */
export function reconcileBatchOutcomes(
  jobs: AgentSpawnJob[],
  child: { error?: Error | null; status: number | null; stdout?: string | null }
): AgentChildOutcome[] {
  const lines = String(child.stdout || "").split("\n");
  lines.pop();
  const byIndex = new Map<number, AgentChildOutcome>();
  for (const line of lines) {
    if (!line) continue;
    let parsed: BatchDelegateLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed.i !== "number" || parsed.i < 0 || parsed.i >= jobs.length) continue;
    byIndex.set(parsed.i, {
      ...(parsed.spawnError ? { spawnError: parsed.spawnError } : {}),
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
      stdout: String(parsed.stdout || "")
    });
  }
  const reason = child.error
    ? messageOf(child.error)
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
export function runAgentBatchOutcomes(jobs: AgentSpawnJob[]): AgentChildOutcome[] {
  if (!jobs.length) return [];
  const maxTimeout = Math.max(...jobs.map((job) => job.timeoutMs));
  const child = spawnSync(process.execPath, [BATCH_DELEGATE_CHILD_SCRIPT], {
    input: JSON.stringify(jobs),
    encoding: "utf8",
    maxBuffer: 34 * 1024 * 1024 * jobs.length,
    timeout: maxTimeout + 30000
  });
  return reconcileBatchOutcomes(jobs, child);
}
