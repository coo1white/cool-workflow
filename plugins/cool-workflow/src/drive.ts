// Agent Delegation Drive (v0.1.38) — the `run --drive` auto-advance loop.
//
// THE GAP THIS CLOSES: CW can plan, isolate, and accept worker output, but nothing
// SPAWNS the agent that writes each result.md — the last mile was a human/agent
// hand-writing 14 result.md files out-of-band. This loop wires the EXISTING verbs
// (plan -> dispatch -> agent-fulfill -> recordWorkerOutput/verify -> commit) and the
// v0.1.37 scheduler (retryOrPark) into ONE thin orchestrator. It spawns NOTHING
// itself except through `runBackend({ backendId: "agent" })`; it introduces NO second
// queue, runner, or scheduler.
//
// BSD discipline:
//  - DELEGATE, DON'T EXECUTE: the model runs in the agent's process. The loop only
//    sequences existing verbs + the agent backend; it never imports a model SDK.
//  - FAIL CLOSED [load-bearing]: an unconfigured agent BLOCKS (never fabricates a
//    completion); an agent hop that exits non-zero / writes no result.md / writes an
//    invalid result.md is a FAILED hop. A worker that exhausts the scheduling retry
//    budget PARKS (reuse v0.1.37 retryOrPark) — never silently re-driven forever.
//  - DETERMINISTIC: `now` is injected; the per-worker order is the existing
//    deterministic phase/dispatch order; `--once` advances exactly one step.
//  - REUSE, DON'T FORK: every mutation goes through the existing runner verbs.
//
// See docs/agent-delegation-drive.7.md.

import fs from "node:fs";
import { CoolWorkflowRunner } from "./orchestrator";
import { firstRunnablePhase } from "./dispatch";
import { runBackend, sha256 } from "./execution-backend";
import { resolveAgentConfig } from "./agent-config";
import { DEFAULT_SCHEDULING_POLICY, normalizeSchedulingPolicy, retryOrPark } from "./scheduling";
import {
  AgentDelegationConfig,
  DrivePreview,
  DriveResult,
  DriveStep,
  DriveStepAction,
  RunQueueEntry,
  RunTask,
  SchedulingPolicy,
  WorkflowRun
} from "./types";

export const DRIVE_SCHEMA_VERSION = 1;

export interface DriveOptions {
  once?: boolean;
  now?: string;
  /** Resolved agent config (flags > env > file). Defaults to resolving from args. */
  agentConfig?: AgentDelegationConfig;
  policy?: Partial<SchedulingPolicy>;
  /** Raw flags forwarded to resolveAgentConfig when agentConfig is not supplied. */
  args?: Record<string, unknown>;
}

/** The task the next drive step would advance: a RUNNING (already-dispatched,
 *  awaiting fulfillment / retry) task first, else the next PENDING task in the
 *  first runnable phase. Deterministic; honors the existing phase gate. */
function selectDriveTask(run: WorkflowRun): RunTask | undefined {
  const phase = firstRunnablePhase(run);
  if (!phase) return undefined;
  const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
  return phaseTasks.find((task) => task.status === "running") || phaseTasks.find((task) => task.status === "pending");
}

function countCompleted(run: WorkflowRun): number {
  return run.tasks.filter((task) => task.status === "completed").length;
}

function countParked(run: WorkflowRun): number {
  return run.tasks.filter((task) => task.status === "failed").length;
}

function verdictVerifierNodeId(run: WorkflowRun): string | undefined {
  const verdict = run.tasks.find((task) => /^verdict[:/]|^synthesis[:/]/i.test(task.id) && task.status === "completed");
  return verdict?.verifierNodeId;
}

function exitCodeFromEvidence(evidence: string[]): number | null {
  const entry = evidence.find((line) => line.startsWith("exitCode:"));
  if (!entry) return null;
  const raw = entry.slice("exitCode:".length);
  return raw === "null" ? null : Number(raw);
}

interface DriveContext {
  runner: CoolWorkflowRunner;
  runId: string;
  now: string;
  policy: SchedulingPolicy;
  config: AgentDelegationConfig;
  /** In-memory per-task attempt accounting for THIS drive() invocation. */
  attempts: Map<string, number>;
}

function agentConfigured(config: AgentDelegationConfig): boolean {
  return Boolean(config.command || config.endpoint);
}

/** Opt-in progress to STDERR (stdout stays clean JSON), gated on CW_DRIVE_PROGRESS,
 *  so a live multi-minute drive is observable. */
function emitProgress(message: string): void {
  if (process.env.CW_DRIVE_PROGRESS) process.stderr.write(`[drive] ${message}\n`);
}

/** Advance exactly ONE deterministic step. Pure-ish: all mutation is through the
 *  existing runner verbs + runBackend. */
export function driveStep(ctx: DriveContext): DriveStep {
  const { runner, runId, now } = ctx;
  let run = runner.loadRun(runId);

  // Terminal: no pending/running work remains -> commit (once) then complete.
  const selected = selectDriveTask(run);
  if (!selected) {
    const allComplete = run.tasks.every((task) => task.status === "completed");
    if (allComplete) {
      const alreadyCommitted = (run.commits || []).some((commit) => commit.reason && commit.reason.startsWith("agent-delegation-drive"));
      if (!alreadyCommitted) {
        const verifierNodeId = verdictVerifierNodeId(run);
        const commit = runner.commit(runId, {
          reason: "agent-delegation-drive: audited verdict committed",
          ...(verifierNodeId ? { verifier: verifierNodeId } : { allowUnverifiedCheckpoint: true })
        });
        return step("commit", "complete", { runId, reason: `committed ${commit.commit.id}` });
      }
      return step("complete", "complete", { runId });
    }
    // Nothing eligible but not all complete: a parked/failed worker blocks the phase.
    return step("blocked", "blocked", { runId, reason: "no eligible worker (a parked/failed worker blocks the phase gate)" });
  }

  // Fail closed: an unconfigured agent cannot fulfill anything.
  if (!agentConfigured(ctx.config)) {
    return step("blocked", "blocked", {
      runId,
      taskId: selected.id,
      phase: selected.phase,
      reason: "agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion"
    });
  }

  // 1. DISPATCH (only a fresh pending task; a running task is a retry on its scope).
  let workerId = selected.workerId;
  let dispatched = false;
  if (selected.status === "pending") {
    const manifest = runner.dispatch(runId, { limit: 1, backend: "agent" });
    const task = manifest.tasks.find((entry) => entry.id === selected.id) || manifest.tasks[0];
    if (!task || !task.workerId) {
      return step("dispatch", "failed", { runId, taskId: selected.id, phase: selected.phase, reason: "dispatch produced no worker scope" });
    }
    workerId = task.workerId;
    dispatched = true;
    run = runner.loadRun(runId);
  }
  if (!workerId) {
    return step("dispatch", "failed", { runId, taskId: selected.id, phase: selected.phase, reason: "no worker scope for task" });
  }

  // 2. FULFILL — delegate the worker to the agent backend (out-of-process). The
  //    agent reads input/manifest and writes result.md; CW captures the child's
  //    command/exit/stdout digest (the evidence triple) + the reported model.
  const manifest = runner.showWorkerManifest(runId, workerId);
  // Progress BEFORE the (possibly multi-minute) agent spawn, so a live drive shows
  // immediate activity instead of a long silence on the first worker.
  emitProgress(`→ ${selected.id} (${selected.phase}) — ${dispatched ? "dispatched, " : ""}spawning agent, may take minutes…`);
  const promptDigest = fs.existsSync(manifest.inputPath) ? sha256(fs.readFileSync(manifest.inputPath, "utf8")) : sha256(manifest.prompt || "");
  const envelope = runBackend({
    schemaVersion: 1,
    runId,
    taskId: selected.id,
    backendId: "agent",
    cwd: run.cwd,
    sandboxPolicy: manifest.sandboxPolicy || manifest.sandbox?.policy,
    manifest,
    label: selected.id,
    timeoutMs: ctx.config.timeoutMs,
    delegation: {
      command: ctx.config.command,
      args: ctx.config.args,
      endpoint: ctx.config.endpoint,
      model: ctx.config.model
    }
  } as Parameters<typeof runBackend>[0]);

  const handle = envelope.provenance.handle;
  const reportedModel = (handle?.metadata?.reportedModel as string) || "unreported";

  if (envelope.status !== "completed") {
    return handleHop(ctx, selected, workerId, `agent hop ${envelope.status}: ${envelope.result.summary}`, dispatched);
  }

  // 3. ACCEPT — the SEPARATE recordWorkerOutput layer validates + records result.md.
  //    A missing result.md is a failed hop (pre-checked so no terminal side effect);
  //    an invalid result.md throws at validation BEFORE any state mutation.
  if (!manifest.resultPath || !fs.existsSync(manifest.resultPath)) {
    return handleHop(ctx, selected, workerId, "agent produced no result.md", dispatched);
  }
  try {
    runner.recordWorkerOutput(runId, workerId, manifest.resultPath, {
      agentDelegation: {
        handle: handle!,
        model: reportedModel,
        promptDigest,
        command: handle?.metadata?.command as string | undefined,
        args: (handle?.metadata?.args as string[]) || [],
        exitCode: exitCodeFromEvidence(envelope.evidence)
      }
    });
  } catch (error) {
    return handleHop(ctx, selected, workerId, `result.md rejected: ${error instanceof Error ? error.message : String(error)}`, dispatched);
  }

  return step("accept", "ok", {
    runId,
    taskId: selected.id,
    phase: selected.phase,
    backendId: "agent",
    handleKind: handle?.kind,
    reportedModel
  });
}

/** A failed agent hop: charge one attempt and (reuse v0.1.37 retryOrPark) either
 *  retry on the SAME worker scope next step, or PARK past the retry budget. */
function handleHop(ctx: DriveContext, task: RunTask, workerId: string, reason: string, dispatched: boolean): DriveStep {
  const prior = ctx.attempts.get(task.id) || 0;
  const entry: RunQueueEntry = {
    schemaVersion: 1,
    id: task.id,
    repo: ctx.runner.loadRun(ctx.runId).cwd,
    priority: 0,
    enqueuedAt: ctx.now,
    status: "ready",
    attempts: prior
  };
  const decided = retryOrPark(entry, ctx.policy, ctx.now, reason);
  ctx.attempts.set(task.id, decided.attempts || prior + 1);

  if (decided.status === "parked") {
    // Terminal: record the failure so the worker/task carries the park reason and
    // the phase gate stops advancing it. Never silently re-driven.
    ctx.runner.recordWorkerFailure(ctx.runId, workerId, decided.parkedReason || reason, {
      code: "agent-delegation-parked",
      retryable: false
    });
    return step("park", "parked", {
      runId: ctx.runId,
      taskId: task.id,
      phase: task.phase,
      backendId: "agent",
      attempts: decided.attempts,
      reason: decided.parkedReason || reason
    });
  }
  // Retryable: leave the task running (scope reused) for the next step.
  void dispatched;
  return step("fulfill", "failed", {
    runId: ctx.runId,
    taskId: task.id,
    phase: task.phase,
    backendId: "agent",
    attempts: decided.attempts,
    reason
  });
}

function step(action: DriveStepAction, status: DriveStep["status"], fields: Partial<DriveStep> & { runId: string }): DriveStep {
  return { schemaVersion: 1, action, status, ...fields };
}

/** Drive a run: `--once` advances exactly one step; otherwise run to completion,
 *  park, or a blocked stop. Composes the existing verbs + the agent backend only. */
export function drive(runner: CoolWorkflowRunner, runId: string, options: DriveOptions = {}): DriveResult {
  const now = options.now || new Date().toISOString();
  const policy = normalizeSchedulingPolicy(options.policy || DEFAULT_SCHEDULING_POLICY);
  const config = options.agentConfig || resolveAgentConfig(options.args || {});
  const ctx: DriveContext = { runner, runId, now, policy, config, attempts: new Map() };

  const steps: DriveStep[] = [];
  const run0 = runner.loadRun(runId);
  const plannedWorkers = run0.tasks.length;
  // Safety bound: every worker, every retry, plus the terminal commit + slack.
  const maxIterations = plannedWorkers * (policy.maxAttempts + 1) + 5;

  for (let i = 0; i < maxIterations; i++) {
    const stepResult = driveStep(ctx);
    steps.push(stepResult);
    emitProgress(
      [
        `${steps.length}.`,
        stepResult.action,
        stepResult.status,
        stepResult.taskId || "",
        stepResult.reportedModel ? `model=${stepResult.reportedModel}` : "",
        stepResult.reason ? `— ${stepResult.reason}` : ""
      ]
        .filter(Boolean)
        .join(" ")
    );
    if (options.once) break;
    if (stepResult.status === "complete" || stepResult.status === "parked" || stepResult.status === "blocked") break;
  }

  const run = runner.loadRun(runId);
  const completedWorkers = countCompleted(run);
  const parkedWorkers = countParked(run);
  const committed = (run.commits || []).find((commit) => commit.reason && commit.reason.startsWith("agent-delegation-drive"));
  const last = steps[steps.length - 1];
  const status: DriveResult["status"] = options.once
    ? completedWorkers === plannedWorkers && committed
      ? "complete"
      : last && (last.status === "parked" || last.status === "blocked")
        ? last.status
        : "in-progress"
    : parkedWorkers > 0 || (last && last.status === "parked")
      ? "parked"
      : last && last.status === "blocked"
        ? "blocked"
        : "complete";

  return {
    schemaVersion: 1,
    runId,
    workflowId: run.workflow.id,
    status,
    steps,
    plannedWorkers,
    completedWorkers,
    parkedWorkers,
    commitId: committed?.id,
    reportPath: run.paths.report,
    statePath: run.paths.state
  };
}

/** Read-only, deterministic preview of the NEXT drive step for a run — no mutation,
 *  no spawn. Counts come from state; safe for CLI<->MCP payload parity. */
export function drivePreview(runner: CoolWorkflowRunner, runId: string, args: Record<string, unknown> = {}): DrivePreview {
  const run = runner.loadRun(runId);
  const config = resolveAgentConfig(args);
  const configured = agentConfigured(config);
  const selected = selectDriveTask(run);
  const plannedWorkers = run.tasks.length;
  const pendingWorkers = run.tasks.filter((task) => task.status === "pending" || task.status === "running").length;
  const completedWorkers = countCompleted(run);
  const parkedWorkers = countParked(run);

  let nextAction: DriveStepAction;
  if (!selected) {
    nextAction = run.tasks.every((task) => task.status === "completed") ? "commit" : "blocked";
  } else if (!configured) {
    nextAction = "blocked";
  } else if (selected.status === "pending") {
    nextAction = "dispatch";
  } else {
    nextAction = "fulfill";
  }

  return {
    schemaVersion: 1,
    runId,
    workflowId: run.workflow.id,
    plannedWorkers,
    pendingWorkers,
    completedWorkers,
    parkedWorkers,
    nextAction,
    nextTaskId: selected?.id,
    nextPhase: selected?.phase,
    agentConfigured: configured
  };
}
