// core/pipeline/drive-decide.ts — the drive's pure decisions: which tasks may
// run, retry or park, what the final status is. shell/drive.ts does the I/O.

import { RunPhase, RunTask, WorkflowRun } from "../state/types.js";

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
  backendId?: string;
  attempts?: number;
  handleKind?: string;
  reportedModel?: string;
  reason?: string;
}

export function makeStep(action: DriveStepAction, status: DriveStepStatus, fields: Partial<DriveStep> & { runId: string }): DriveStep {
  return { schemaVersion: 1, action, status, ...fields };
}

function tasksOf(run: WorkflowRun, phase: RunPhase): RunTask[] {
  const ids = new Set(phase.taskIds);
  return run.tasks.filter((task) => ids.has(task.id));
}

/** The first phase with work left; a phase that is not complete and has
 *  nothing pending or running blocks every phase after it (null). */
export function firstRunnablePhase(run: WorkflowRun): RunPhase | null {
  for (const phase of run.phases) {
    const tasks = tasksOf(run, phase);
    if (tasks.some((task) => task.status === "running" || task.status === "pending")) return phase;
    if (!tasks.every((task) => task.status === "completed")) return null;
  }
  return null;
}

/** The first runnable phase's tasks, plus each next phase marked overlapPrevious. */
export function runnableTaskIds(run: WorkflowRun): Set<string> {
  const first = firstRunnablePhase(run);
  if (!first) return new Set();
  const ids = new Set(first.taskIds);
  for (let i = run.phases.indexOf(first) + 1; i < run.phases.length && run.phases[i].overlapPrevious; i += 1) {
    for (const id of run.phases[i].taskIds) ids.add(id);
  }
  return ids;
}

export function updatePhaseStatuses(run: WorkflowRun): void {
  for (const phase of run.phases) {
    const tasks = tasksOf(run, phase);
    if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) phase.status = "completed";
    else if (tasks.some((task) => task.status === "running" || task.status === "completed")) phase.status = "running";
    else phase.status = "pending";
  }
}

/** The tasks the next round may start, in plan order, at most `width`. */
export function selectRoundTasks(run: WorkflowRun, width: number): RunTask[] {
  const ids = runnableTaskIds(run);
  return run.tasks.filter((task) => ids.has(task.id) && (task.status === "pending" || task.status === "running")).slice(0, Math.max(1, width));
}

/** Round width: a parallel phase runs up to maxConcurrentAgents at once. */
export function autoWidth(run: WorkflowRun): number {
  const phase = firstRunnablePhase(run);
  if (!phase || phase.mode !== "parallel") return 1;
  const cap = Math.max(1, Math.floor(run.workflow.limits?.maxConcurrentAgents || 1));
  return Math.max(1, Math.min(cap, runnableTaskIds(run).size));
}

export function countCompleted(run: WorkflowRun): number {
  return run.tasks.filter((task) => task.status === "completed").length;
}

export function countParked(run: WorkflowRun): number {
  return run.tasks.filter((task) => task.status === "failed").length;
}

export const AGENT_PARKED_CODE = "agent-delegation-parked";

/** Tasks the drive parked after their retries; `--resume --run` opens them again. */
export function reopenableParkedTaskIds(run: WorkflowRun): string[] {
  return run.tasks
    .filter((task) => task.status === "failed" && task.errors?.length && task.errors[task.errors.length - 1].code === AGENT_PARKED_CODE)
    .map((task) => task.id);
}

export const TERMINAL_COMMIT_REASON = "agent-delegation-drive";

export function hasTerminalCommit(run: WorkflowRun): boolean {
  return run.commits.some((commit) => commit.reason.startsWith(TERMINAL_COMMIT_REASON));
}

export const BLOCKED_PHASE_GATE = "no eligible worker (a parked/failed worker blocks the phase gate)";
export const BLOCKED_NO_AGENT =
  "agent backend not configured (set CW_AGENT_COMMAND or pass --agent-command) — refusing rather than fabricating a completion";

/** Nothing left to start: commit, complete, or blocked by a parked task. */
export function terminalStep(run: WorkflowRun): { kind: "commit" } | { kind: "complete" | "blocked"; step: DriveStep } {
  if (run.tasks.every((task) => task.status === "completed")) {
    if (!hasTerminalCommit(run)) return { kind: "commit" };
    return { kind: "complete", step: makeStep("complete", "complete", { runId: run.id }) };
  }
  return { kind: "blocked", step: makeStep("blocked", "blocked", { runId: run.id, reason: BLOCKED_PHASE_GATE }) };
}

export interface SchedulingPolicy {
  maxAttempts: number;
  maxTimeoutAttempts?: number;
}

export const DEFAULT_SCHEDULING_POLICY: SchedulingPolicy = { maxAttempts: 3 };

export const TIMEOUT_PARK_NEXT_STEP = "raise CW_AGENT_TIMEOUT_MS (or --agent-timeout-ms) or check the agent command";

export function timeoutAttemptLimit(policy: SchedulingPolicy): number {
  const raw = Number(policy.maxTimeoutAttempts ?? 1);
  return Math.max(1, Math.min(Number.isFinite(raw) ? Math.floor(raw) : 1, policy.maxAttempts));
}

export interface RetryOrParkDecision {
  status: "retryable" | "parked";
  attempts: number;
  parkedReason?: string;
}

/** A timeout parks at once (a second wait would cost the same again). */
export function retryOrPark(priorAttempts: number, policy: SchedulingPolicy, reason: string, timedOutMs?: number): RetryOrParkDecision {
  const attempts = priorAttempts + 1;
  if (timedOutMs && timedOutMs > 0) {
    const limit = timeoutAttemptLimit(policy);
    if (attempts >= limit) {
      const tries = attempts > limit ? String(attempts) : `${attempts}/${limit}`;
      return { status: "parked", attempts, parkedReason: `${reason} (attempt ${tries}; limit ${shortDuration(timedOutMs)}) — not tried again: ${TIMEOUT_PARK_NEXT_STEP}` };
    }
    return { status: "retryable", attempts };
  }
  if (attempts >= policy.maxAttempts) {
    return { status: "parked", attempts, parkedReason: `${reason} (attempt ${attempts}/${policy.maxAttempts})` };
  }
  return { status: "retryable", attempts };
}

export function shortDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const seconds = total % 60;
  return seconds ? `${Math.floor(total / 60)}m ${seconds}s` : `${Math.floor(total / 60)}m`;
}

export function shortHopReason(reason: string): string {
  const timeout = /timed out after (\d+)ms/.exec(reason);
  if (timeout) return `timed out after ${shortDuration(Number(timeout[1]))}`;
  const dash = reason.indexOf(" — ");
  const tail = (dash >= 0 ? reason.slice(dash + 3) : reason).trim();
  return tail.length > 120 ? `${tail.slice(0, 119)}…` : tail;
}

export function hopRetryLine(label: string, phase: string, reason: string, attempts: number, policy: SchedulingPolicy, timedOutMs?: number): string {
  const max = timedOutMs ? timeoutAttemptLimit(policy) : policy.maxAttempts;
  return `✗ ${label} (${phase}) — ${shortHopReason(reason)}; trying again (${attempts + 1}/${max})`;
}

export const WAIT_NOTE = ", may take minutes…";

/** ", may take minutes…" goes on a process's first spawn or round line only. */
export function spawningAgentLine(task: { id: string; phase: string }, waitNote: boolean): string {
  return `→ ${task.id} (${task.phase}) — spawning agent${waitNote ? WAIT_NOTE : ""}`;
}

/** "20s" or "4m 10s". */
export function sinceText(ms: number): string {
  const total = Math.round(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

export interface AliveJob {
  lastOutputAt: number;
  done: boolean;
}

/** The still-working line's note on how long the running agents have been
 *  quiet; "" when none is running. */
export function quietNote(jobs: readonly AliveJob[], now: number): string {
  const running = jobs.filter((job) => !job.done && Number.isFinite(job.lastOutputAt));
  if (!running.length) return "";
  const quiet = sinceText(Math.max(0, now - Math.min(...running.map((job) => job.lastOutputAt))));
  return running.length === 1 ? ` (last output ${quiet} ago)` : ` (${running.length} agents running, longest without output ${quiet})`;
}

export function concurrentRoundLine(agents: number, waitNote: boolean): string {
  return `» concurrent round: ${agents} agent${agents > 1 ? "s" : ""} spawning in parallel${waitNote ? WAIT_NOTE : ""}`;
}

export interface DriveResultStatusInputs {
  completedWorkers: number;
  plannedWorkers: number;
  lastStepStatus: DriveStepStatus | undefined;
  parkedWorkers: number;
}

export function finalDriveStatus(inputs: DriveResultStatusInputs): "complete" | "parked" | "blocked" {
  if (inputs.parkedWorkers > 0 || inputs.lastStepStatus === "parked") return "parked";
  if (inputs.lastStepStatus === "blocked") return "blocked";
  return inputs.plannedWorkers > 0 && inputs.completedWorkers === inputs.plannedWorkers ? "complete" : "blocked";
}
