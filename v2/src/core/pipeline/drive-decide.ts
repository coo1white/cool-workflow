// core/pipeline/drive-decide.ts — driveStep/driveConcurrentRound's PURE
// decision core: task selection, terminal/gate logic, token-budget check,
// retry/park math, cache-key formulas.
//
// MILESTONE 6+7 (combined; the big one — see v2/PLAN.md Open risk 9).
// Every branch here is a pure function of already-loaded run state; it
// does not itself spawn a process or touch disk. shell/drive.ts is the
// thin imperative loop that calls these functions once per step and
// performs the actual spawn/commit/cache-write IO the decision names.
//
// Evidence: SPEC/pipeline-run.md "Drive loop — src/drive.ts", "Drive
// internals a rebuild must copy", "`--incremental` and the result
// cache".

import { RunTask, WorkflowRun } from "../state/types";
import { firstRunnablePhase } from "./dispatch";
import { stableStringify, sha256 } from "../hash";

export const DRIVE_SCHEMA_VERSION = 1;
export const MAX_SUB_WORKFLOW_DEPTH = 4;

export type DriveStepAction = "dispatch" | "fulfill" | "accept" | "commit" | "park" | "blocked" | "complete";
export type DriveStepStatus = "ok" | "parked" | "blocked" | "failed" | "complete";

export interface DriveStep {
  schemaVersion: 1;
  runId: string;
  action: DriveStepAction;
  status: DriveStepStatus;
  taskId?: string;
  workerId?: string;
  phase?: string;
  backendId?: "agent";
  attempts?: number;
  handleKind?: string;
  reportedModel?: string;
  reason?: string;
}

export function makeStep(action: DriveStepAction, status: DriveStepStatus, fields: Partial<DriveStep> & { runId: string }): DriveStep {
  return { schemaVersion: 1, action, status, ...fields };
}

/** The task the next drive step would advance: a running task first,
 *  else the next pending task of the first runnable phase. */
export function selectDriveTask(run: WorkflowRun): RunTask | undefined {
  const phase = firstRunnablePhase(run);
  if (!phase) return undefined;
  const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
  return phaseTasks.find((task) => task.status === "running") || phaseTasks.find((task) => task.status === "pending");
}

export function countCompleted(run: WorkflowRun): number {
  return run.tasks.filter((task) => task.status === "completed").length;
}

export function countParked(run: WorkflowRun): number {
  return run.tasks.filter((task) => task.status === "failed").length;
}

/** The completed verdict/synthesis task's verifierNodeId, if any. */
export function verdictVerifierNodeId(run: WorkflowRun): string | undefined {
  const verdict = run.tasks.find((task) => /^verdict[:/]|^synthesis[:/]/i.test(task.id) && task.status === "completed");
  return verdict?.verifierNodeId as string | undefined;
}

export function exitCodeFromEvidence(evidence: string[]): number | null {
  const entry = evidence.find((line) => line.startsWith("exitCode:"));
  if (!entry) return null;
  const raw = entry.slice("exitCode:".length);
  return raw === "null" ? null : Number(raw);
}

/** Whether a commit already exists whose reason starts with
 *  "agent-delegation-drive" (the once-only terminal-commit check). */
export function hasTerminalCommit(run: WorkflowRun): boolean {
  return (run.commits || []).some((commit) => commit.reason && commit.reason.startsWith("agent-delegation-drive"));
}

export interface TerminalGateResult {
  /** "commit" -> the caller should perform the terminal commit now.
   *  "complete" -> already committed, nothing more to do.
   *  "blocked" -> either the phase gate or token budget or unconfigured
   *  agent blocked progress.
   *  undefined -> there IS a ready task; proceed to process it. */
  kind: "commit" | "complete" | "blocked" | undefined;
  step?: DriveStep;
  /** Only set when kind === "commit": whether the terminal commit should
   *  be verifier-gated (a verdict task's verifierNodeId exists) or an
   *  unverified checkpoint. */
  verifierNodeId?: string;
}

/** terminalOrConfigStep's pure decision half. Returns a DriveStep only
 *  for the non-advancing outcomes (terminal commit/complete, blocked
 *  phase, blocked token budget, blocked unconfigured agent); returns
 *  `{kind: undefined}` when there is a ready task to actually process. */
export function terminalOrConfigStep(
  run: WorkflowRun,
  selected: RunTask | undefined,
  agentConfigured: boolean,
  tokenBudget: { spent: number; budget: number } | undefined
): TerminalGateResult {
  if (!selected) {
    const allComplete = run.tasks.every((task) => task.status === "completed");
    if (allComplete) {
      if (!hasTerminalCommit(run)) {
        return { kind: "commit", verifierNodeId: verdictVerifierNodeId(run) };
      }
      return { kind: "complete", step: makeStep("complete", "complete", { runId: run.id }) };
    }
    return {
      kind: "blocked",
      step: makeStep("blocked", "blocked", { runId: run.id, reason: "no eligible worker (a parked/failed worker blocks the phase gate)" }),
    };
  }

  if (tokenBudget && tokenBudget.budget > 0 && tokenBudget.spent >= tokenBudget.budget) {
    return {
      kind: "blocked",
      step: makeStep("blocked", "blocked", {
        runId: run.id,
        taskId: selected.id,
        phase: selected.phase,
        reason: `token budget exhausted: ${tokenBudget.spent} recorded tokens >= budget ${tokenBudget.budget} — refusing to spawn further agents`,
      }),
    };
  }

  if (!agentConfigured) {
    return {
      kind: "blocked",
      step: makeStep("blocked", "blocked", {
        runId: run.id,
        taskId: selected.id,
        phase: selected.phase,
        reason:
          "agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion",
      }),
    };
  }

  return { kind: undefined };
}

// ---------------------------------------------------------------------------
// Retry / park math (handleHop).
// ---------------------------------------------------------------------------

export interface SchedulingPolicy {
  maxAttempts: number;
}

export const DEFAULT_SCHEDULING_POLICY: SchedulingPolicy = { maxAttempts: 3 };

export interface RetryOrParkDecision {
  status: "retryable" | "parked";
  attempts: number;
  parkedReason?: string;
}

/** `retryOrPark` — adds one attempt; at `attempts >= maxAttempts` parks
 *  with `parkedReason = "<reason> (attempt <n>/<max>)"`. */
export function retryOrPark(priorAttempts: number, policy: SchedulingPolicy, reason: string): RetryOrParkDecision {
  const attempts = priorAttempts + 1;
  if (attempts >= policy.maxAttempts) {
    return { status: "parked", attempts, parkedReason: `${reason} (attempt ${attempts}/${policy.maxAttempts})` };
  }
  return { status: "retryable", attempts };
}

/** `handleHop`'s attempt-accounting rule: prior attempts = max(in-memory
 *  count, the worker scope's persisted retryCount). */
export function priorAttempts(inMemoryAttempts: number, persistedRetryCount: number): number {
  return Math.max(inMemoryAttempts, persistedRetryCount);
}

// ---------------------------------------------------------------------------
// Loop iteration bound.
// ---------------------------------------------------------------------------

/** `maxIterations = (plannedWorkers + maxLoopExpansion) * (maxAttempts +
 *  1) + 5`. */
export function maxIterations(plannedWorkers: number, loopExpansion: number, policy: SchedulingPolicy): number {
  return (plannedWorkers + loopExpansion) * (policy.maxAttempts + 1) + 5;
}

/** Round width per iteration: an explicit concurrency > 1 wins; else
 *  autoWidth for a first-runnable parallel phase. */
export function autoWidth(run: WorkflowRun): number {
  const phase = firstRunnablePhase(run);
  if (!phase || phase.mode !== "parallel") return 1;
  const cap = Math.max(1, Math.floor(run.workflow.limits?.maxConcurrentAgents || 1));
  return Math.max(1, Math.min(cap, phase.taskIds.length));
}

export function roundWidth(run: WorkflowRun, concurrency: number | undefined): number {
  return concurrency && concurrency > 1 ? concurrency : autoWidth(run);
}

// ---------------------------------------------------------------------------
// Final DriveResult.status.
// ---------------------------------------------------------------------------

export interface DriveResultStatusInputs {
  once: boolean;
  completedWorkers: number;
  plannedWorkers: number;
  committed: boolean;
  lastStepStatus: DriveStepStatus | undefined;
  exhaustedMaxIterations: boolean;
  parkedWorkers: number;
}

export function finalDriveStatus(inputs: DriveResultStatusInputs): "complete" | "parked" | "blocked" | "in-progress" {
  if (inputs.once) {
    if (inputs.completedWorkers === inputs.plannedWorkers && inputs.committed) return "complete";
    if (inputs.lastStepStatus === "parked" || inputs.lastStepStatus === "blocked") return inputs.lastStepStatus;
    return "in-progress";
  }
  if (inputs.exhaustedMaxIterations) return "blocked";
  if (inputs.parkedWorkers > 0 || inputs.lastStepStatus === "parked") return "parked";
  if (inputs.lastStepStatus === "blocked") return "blocked";
  return "complete";
}

// ---------------------------------------------------------------------------
// Result cache key formulas.
// ---------------------------------------------------------------------------

/** Cache file path (relative to `<run.cwd>/.cw/cache/worker-results/`).
 *  Actual path join / atomic write is shell-side. */
export function cacheFileName(taskId: string, digest: string): string {
  return `${safeFileNamePart(taskId)}-${digest.replace(/^sha256:/, "").slice(0, 32)}.md`;
}

function safeFileNamePart(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Default (no `--incremental`) cache key. `undefined` disables caching
 *  for this call (no keyInput, empty keyValue, or an unavailable
 *  completedResultsDigest upstream). */
export function defaultCacheKey(
  workflowId: string,
  taskId: string,
  keyInput: string | undefined,
  keyValue: string | undefined,
  promptDigest: string,
  completedResultsDigest: string | undefined
): string | undefined {
  if (!keyInput || !keyValue || !keyValue.trim()) return undefined;
  if (completedResultsDigest === undefined) return undefined;
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      workflowId,
      taskId,
      keyInput,
      keyValue: keyValue.trim(),
      promptDigest,
      completedResultsDigest,
    })
  );
}

/** `--incremental` cache key (schemaVersion 2 — never collides with
 *  schemaVersion 1). `undefined` disables caching (an upstream result is
 *  unavailable). */
export function incrementalCacheKey(
  workflowId: string,
  taskId: string,
  promptDigest: string,
  runInputsDigest: string,
  delegationDigest: string,
  upstreamResultsDigest: string | undefined
): string | undefined {
  if (upstreamResultsDigest === undefined) return undefined;
  return sha256(
    stableStringify({
      schemaVersion: 2,
      workflowId,
      taskId,
      promptDigest,
      runInputsDigest,
      delegationDigest,
      upstreamResultsDigest,
    })
  );
}

/** The delegation digest folded into the incremental cache key. */
export function incrementalDelegationDigest(
  model: string,
  agentType: string,
  sandboxProfileId: string,
  command: string,
  strippedArgs: string[],
  endpoint: string
): string {
  return sha256(
    stableStringify({
      model,
      agentType,
      sandboxProfileId,
      command,
      args: strippedArgs,
      endpoint,
    })
  );
}
