// Agent Delegation Drive (v0.1.38) — result types for the `run --drive` auto-advance
// loop. The loop is a THIN orchestrator over the EXISTING verbs (plan / dispatch /
// recordWorkerOutput / commit) + the v0.1.37 scheduler; it introduces no second
// runner/queue. These are plain, deterministic projections of run state.
//
// DETERMINISM: every payload is derivable from the run state + an injected `now`.
// No now-derived NUMERIC field (counts come from state); only ISO timestamps may be
// now-derived (the parity probe strips them).

import { ReportBundleResult } from "./report-bundle";

/** What the drive loop did in ONE step. */
export type DriveStepAction =
  | "dispatch" // allocated the next worker scope (input.md + manifest)
  | "fulfill" // delegated the worker to the agent backend (out-of-process)
  | "accept" // recorded + verified the worker's result.md
  | "commit" // committed the driven run (verifier-gated)
  | "park" // the worker exhausted its retry budget and parked (fail closed)
  | "blocked" // nothing eligible to advance (e.g. phase gate, missing config, token budget exhausted)
  | "complete"; // no pending work remains

export type DriveStepStatus = "ok" | "parked" | "blocked" | "failed" | "complete";

/** ONE deterministic drive step. */
export interface DriveStep {
  schemaVersion: 1;
  runId: string;
  action: DriveStepAction;
  status: DriveStepStatus;
  taskId?: string;
  workerId?: string;
  phase?: string;
  backendId?: "agent";
  /** Retry attempts consumed for this worker (scheduler park accounting). */
  attempts?: number;
  /** Backend execution handle kind for the agent hop (`process`). */
  handleKind?: string;
  /** Agent-REPORTED model id (or `unreported`) for the fulfilled worker. */
  reportedModel?: string;
  reason?: string;
}

/** The result of a `--drive` run (one `--once` step, or run-to-completion). */
export interface DriveResult {
  schemaVersion: 1;
  runId: string;
  workflowId: string;
  /** complete = no pending work; parked = a worker fail-closed parked; blocked =
   *  nothing eligible (e.g. unconfigured agent); in-progress = `--once` advanced. */
  status: "complete" | "parked" | "blocked" | "in-progress";
  steps: DriveStep[];
  plannedWorkers: number;
  completedWorkers: number;
  parkedWorkers: number;
  commitId?: string;
  reportPath: string;
  statePath: string;
  /** True iff an agent command-template/endpoint was configured. When false a blocked
   *  drive is the fail-closed no-agent stop — surfaced so the CLI/MCP can offer the right
   *  recovery (`cw doctor`) instead of a generic status hint. Mirrors DrivePreview. */
  agentConfigured: boolean;
}

/** The result of the one-command `quickstart` wrapper: plan(app) -> run --drive ->
 *  report, assembled from the EXISTING verbs only (no second executor/scheduler).
 *  Carries the drive outcome verbatim plus the written report path so a newcomer
 *  gets a run id, a status, and a cited report in ONE invocation. `--preview`
 *  returns a DrivePreview instead (read-only next-step projection, no mutation). */
export interface QuickstartResult {
  schemaVersion: 1;
  /** The app planned + driven (defaults to architecture-review). */
  appId: string;
  runId: string;
  workflowId: string;
  /** Mirrors DriveResult.status: complete | parked | blocked | in-progress. */
  status: DriveResult["status"];
  plannedWorkers: number;
  completedWorkers: number;
  parkedWorkers: number;
  commitId?: string;
  reportPath: string;
  statePath: string;
  /** True iff an agent command-template/endpoint was configured. When false the
   *  drive fails closed (status=blocked) — CW never fabricates a completion. */
  agentConfigured: boolean;
  /** The deterministic drive steps (verbatim from drive()), for inspection. */
  steps: DriveStep[];
  /** Operator-facing next action when the drive did not complete (e.g. how to
   *  configure the agent backend, or where the parked worker is). */
  hint?: string;
  /** When this invocation CONTINUED an existing run (`--resume --run <id>`), the
   *  run id it resumed from (=== runId). Absent on a fresh plan and on the default
   *  (no `--resume`) path, so default output stays byte-identical. */
  resumedFrom?: string;
  /** Present ONLY when `--bundle` was passed AND the drive completed: the sealed,
   *  self-verified portable bundle (export + offline self-verify of this run). Absent
   *  on every other path (no `--bundle`, or status != complete), so default quickstart
   *  output stays byte-identical. `bundle.ok === false` means do not ship it. */
  bundle?: ReportBundleResult;
}

export type QuickstartCheckStatus = "ok" | "warn" | "blocked";

export interface QuickstartCheck {
  name: string;
  status: QuickstartCheckStatus;
  detail: string;
  fix?: string;
}

/** Zero-write preflight for the one-command quickstart. It checks the inputs and
 *  host readiness without creating a run, writing `.cw/`, spawning an agent, or
 *  rendering a report. */
export interface QuickstartCheckResult {
  schemaVersion: 1;
  mode: "check";
  ok: boolean;
  appId: string;
  repo: string;
  checks: QuickstartCheck[];
  nextCommand: string;
}

/** Read-only, deterministic preview of the drive loop's NEXT step for a run —
 *  no mutation, no spawn. Counts come from state; safe for CLI<->MCP parity. */
export interface DrivePreview {
  schemaVersion: 1;
  runId: string;
  workflowId: string;
  plannedWorkers: number;
  pendingWorkers: number;
  completedWorkers: number;
  parkedWorkers: number;
  /** The action the next `--drive --once` would take. */
  nextAction: DriveStepAction;
  nextTaskId?: string;
  nextPhase?: string;
  /** True iff an agent command-template/endpoint is configured (else next step
   *  would fail closed). */
  agentConfigured: boolean;
}
