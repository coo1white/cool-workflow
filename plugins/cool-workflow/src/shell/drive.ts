// shell/drive.ts — drives a run to its end: start the runnable tasks' agents
// (a parallel phase up to maxConcurrentAgents at once), gate each result,
// retry or park a failing task, then make the final verifier-gated commit
// and write the report. Decisions live in core/pipeline/drive-decide.ts.

import * as fs from "node:fs";
import { RunTask, WorkflowRun } from "../core/state/types.js";
import {
  AGENT_PARKED_CODE,
  autoWidth,
  BLOCKED_NO_AGENT,
  countCompleted,
  countParked,
  DEFAULT_SCHEDULING_POLICY,
  DriveStep,
  finalDriveStatus,
  hopRetryLine,
  makeStep,
  reopenableParkedTaskIds,
  retryOrPark,
  SchedulingPolicy,
  selectRoundTasks,
  spawningAgentLine,
  concurrentRoundLine,
  AliveJob,
  quietNote,
  sinceText,
  terminalStep,
  TERMINAL_COMMIT_REASON,
  updatePhaseStatuses,
} from "../core/pipeline/drive-decide.js";
import { messageOf } from "../core/util/cli-args.js";
import { acquireDriveLock, loadRun, saveRun } from "./run-store.js";
import { acceptResult, prepareWorker, WorkerFiles } from "./worker.js";
import { commitRun } from "./commit.js";
import { writeReport } from "./report.js";
import { AgentDelegationConfig, AgentOutcome, driveTtyClaimPath, runAgent } from "./execution-backend/agent.js";
import { phaseProgressLine } from "./term.js";
import { reporter } from "./reporter.js";

export interface DriveOptions {
  agentConfig: AgentDelegationConfig;
  /** `--resume --run`: run each parked task again with a fresh retry budget. */
  reopenParked?: boolean;
  policy?: Partial<SchedulingPolicy>;
}

export interface DriveResult {
  schemaVersion: 1;
  runId: string;
  workflowId: string;
  status: "complete" | "parked" | "blocked";
  steps: DriveStep[];
  plannedWorkers: number;
  completedWorkers: number;
  parkedWorkers: number;
  commitId?: string;
  reportPath: string;
  statePath: string;
  agentConfigured: boolean;
  reopenedWorkers?: string[];
}

/** Progress goes to stderr: on for a TTY, CW_DRIVE_PROGRESS=0/1 forces it. */
function progressEnabled(): boolean {
  if (process.env.CW_DRIVE_PROGRESS === "0") return false;
  return process.env.CW_DRIVE_PROGRESS === "1" || Boolean(process.stderr.isTTY);
}

function emitProgress(message: string): void {
  if (progressEnabled()) reporter.progress(`[drive] ${message}`);
}

function shouldStreamAgentStderr(): boolean {
  if (process.env.CW_NO_STREAM === "1" || process.env.CW_AGENT_STREAM === "0") return false;
  return process.env.CW_AGENT_STREAM === "1" || Boolean(process.stderr.isTTY);
}

/** `[drive]   … <Phase> still working — 20s` every CW_DRIVE_TICK_MS (default
 *  10000; 0 turns it off), quiet while a live agent view holds the terminal. */
function startTicker(label: string, alive: readonly AliveJob[]): () => void {
  const raw = process.env.CW_DRIVE_TICK_MS;
  const interval = raw === undefined || raw === "" ? 10000 : Number(raw);
  if (!progressEnabled() || !Number.isFinite(interval) || interval <= 0) return () => {};
  const started = Date.now();
  const timer = setInterval(() => {
    if (fs.existsSync(driveTtyClaimPath())) return;
    const now = Date.now();
    emitProgress(`  … ${label} still working — ${sinceText(now - started)}${quietNote(alive, now)}`);
  }, interval);
  timer.unref();
  return () => clearInterval(timer);
}

function phaseProgress(): (run: WorkflowRun) => void {
  const announced = new Set<string>();
  let active: string | undefined;
  return (run) => {
    for (const phase of run.phases) {
      const ids = new Set(phase.taskIds);
      const tasks = run.tasks.filter((t) => ids.has(t.id));
      if (!tasks.length) continue;
      const done = tasks.filter((t) => t.status === "completed").length;
      const label = phase.name.charAt(0).toUpperCase() + phase.name.slice(1);
      if (done >= tasks.length) {
        if (!announced.has(phase.id)) {
          announced.add(phase.id);
          emitProgress(phaseProgressLine(label, done, tasks.length, process.stderr));
        }
        continue;
      }
      if (phase.id !== active) {
        active = phase.id;
        emitProgress(phaseProgressLine(label, done, tasks.length, process.stderr));
      }
      return;
    }
  };
}

const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
const STOP_EXIT: Record<string, number> = { SIGINT: 130, SIGTERM: 143 };

/** A failed hop: count the attempt, then retry (task stays running) or park. */
function hop(run: WorkflowRun, task: RunTask, reason: string, policy: SchedulingPolicy, now: string, timedOutMs?: number): DriveStep {
  const decided = retryOrPark(task.attempts || 0, policy, reason, timedOutMs);
  task.attempts = decided.attempts;
  const fields = { runId: run.id, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts };
  if (decided.status === "parked") {
    const message = decided.parkedReason || reason;
    task.status = "failed";
    task.errors = [...(task.errors || []), { code: AGENT_PARKED_CODE, message, at: now }];
    return makeStep("park", "parked", { ...fields, reason: message });
  }
  task.errors = [...(task.errors || []), { code: "agent-delegation-retry", message: reason, at: now }];
  emitProgress(hopRetryLine(task.id, task.phase, reason, decided.attempts, policy, timedOutMs));
  return makeStep("fulfill", "failed", { ...fields, reason });
}

function settle(run: WorkflowRun, task: RunTask, files: WorkerFiles, outcome: AgentOutcome, options: DriveOptions, policy: SchedulingPolicy): DriveStep {
  const now = new Date().toISOString();
  if (!outcome.ok) return hop(run, task, `agent hop failed: ${outcome.reason}`, policy, now, outcome.timedOutMs);
  if (!fs.existsSync(files.resultPath)) return hop(run, task, "agent produced no result.md", policy, now);
  try {
    acceptResult(run, task, files, { stdout: outcome.stdout, attestPublicKey: options.agentConfig.attestPublicKey, now });
  } catch (error) {
    return hop(run, task, `result.md rejected: ${messageOf(error)}`, policy, now);
  }
  return makeStep("accept", "ok", { runId: run.id, taskId: task.id, phase: task.phase, backendId: "agent", handleKind: "process", reportedModel: task.model });
}

let waitNoteShown = false;

/** One round: start the selected tasks' agents together, then settle each
 *  in plan order and save once. */
async function driveRound(run: WorkflowRun, tasks: RunTask[], options: DriveOptions, policy: SchedulingPolicy): Promise<DriveStep[]> {
  const stream = tasks.length === 1 && shouldStreamAgentStderr();
  const jobs = tasks.map((task) => {
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    return { task, files: prepareWorker(run, task) };
  });
  run.loopStage = "act";
  updatePhaseStatuses(run);
  saveRun(run);
  const waitNote = !waitNoteShown;
  waitNoteShown = true;
  if (jobs.length > 1) emitProgress(concurrentRoundLine(jobs.length, waitNote));
  for (const { task } of jobs) emitProgress(spawningAgentLine(task, waitNote && jobs.length === 1));
  const alive: AliveJob[] = jobs.map(() => ({ lastOutputAt: Date.now(), done: false }));
  // A lone agent's line stays the plain one; a concurrent round adds the note.
  const stopTicker = startTicker(tasks[0].phase, jobs.length > 1 ? alive : []);
  let outcomes: AgentOutcome[];
  try {
    outcomes = await Promise.all(
      jobs.map(({ task, files }, i) =>
        runAgent(options.agentConfig, {
          runId: run.id,
          taskId: task.id,
          phase: task.phase,
          workerId: files.workerId,
          workerDir: files.workerDir,
          inputPath: files.inputPath,
          resultPath: files.resultPath,
          prompt: task.prompt,
          cwd: run.cwd,
          priorResults: files.priorResults,
          streamStderr: stream,
          onOutput: () => {
            alive[i].lastOutputAt = Date.now();
          },
        }).finally(() => {
          alive[i].done = true;
        })
      )
    );
  } finally {
    stopTicker();
  }
  const steps = jobs.map(({ task, files }, i) => settle(run, task, files, outcomes[i], options, policy));
  updatePhaseStatuses(run);
  saveRun(run);
  return steps;
}

export async function drive(runId: string, cwd: string, options: DriveOptions): Promise<DriveResult> {
  const policy: SchedulingPolicy = { ...DEFAULT_SCHEDULING_POLICY, ...(options.policy || {}) };
  let run = loadRun(runId, cwd);
  const release = acquireDriveLock(run);
  const steps: DriveStep[] = [];
  const reopened: string[] = [];
  let interruptedBy: NodeJS.Signals | undefined;
  let hits = 0;
  const onSignal = (signal: NodeJS.Signals): void => {
    hits += 1;
    if (hits > 1) {
      emitProgress(`received a second ${signal} — exiting immediately`);
      process.exit(STOP_EXIT[signal] ?? 1);
    }
    interruptedBy = signal;
    emitProgress(`received ${signal} — stopping after the current step (resume: cw --resume --run ${runId})`);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    run = loadRun(runId, cwd); // reread under the lock
    if (options.reopenParked) {
      for (const id of reopenableParkedTaskIds(run)) {
        const task = run.tasks.find((t) => t.id === id)!;
        task.status = "running";
        task.attempts = 0;
        reopened.push(id);
      }
      if (reopened.length) saveRun(run);
    }
    const configured = Boolean(options.agentConfig.command);
    const progress = phaseProgress();
    if (!configured) {
      steps.push(makeStep("blocked", "blocked", { runId, reason: BLOCKED_NO_AGENT }));
    } else {
      for (let guard = 0; guard < run.tasks.length * (policy.maxAttempts + 1) + 4; guard++) {
        if (interruptedBy) {
          steps.push(makeStep("blocked", "blocked", { runId, reason: `drive interrupted by ${interruptedBy} — resume: cw --resume --run ${runId}` }));
          break;
        }
        const tasks = selectRoundTasks(run, autoWidth(run));
        if (tasks.length) {
          steps.push(...(await driveRound(run, tasks, options, policy)));
          progress(run);
          continue;
        }
        const end = terminalStep(run);
        if (end.kind === "commit") {
          try {
            const commit = commitRun(run, `${TERMINAL_COMMIT_REASON}: all ${run.tasks.length} workers accepted`);
            saveRun(run);
            steps.push(makeStep("commit", "complete", { runId, reason: `committed ${commit.id}` }));
          } catch (error) {
            steps.push(makeStep("commit", "blocked", { runId, reason: `final commit refused: ${messageOf(error)}` }));
          }
          break;
        }
        // A parked worker already says why the drive stopped; its park step
        // stays the last one, so the hint can name that worker's log.
        if (!(end.step.status === "blocked" && countParked(run) > 0)) steps.push(end.step);
        break;
      }
    }
    writeReport(run);
    const parkedWorkers = countParked(run);
    const status = finalDriveStatus({ completedWorkers: countCompleted(run), plannedWorkers: run.tasks.length, lastStepStatus: steps[steps.length - 1]?.status, parkedWorkers });
    const commit = run.commits.find((c) => c.reason.startsWith(TERMINAL_COMMIT_REASON));
    return {
      schemaVersion: 1,
      runId,
      workflowId: run.workflow.id,
      status,
      steps,
      plannedWorkers: run.tasks.length,
      completedWorkers: countCompleted(run),
      parkedWorkers,
      ...(commit ? { commitId: commit.id } : {}),
      reportPath: run.paths.report,
      statePath: run.paths.state,
      agentConfigured: configured,
      ...(reopened.length ? { reopenedWorkers: reopened } : {}),
    };
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
    release();
  }
}
