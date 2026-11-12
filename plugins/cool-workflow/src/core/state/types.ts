// core/state/types.ts — the run state written to .cw/runs/<id>/state.json.

import type { ResultEnvelope } from "../pipeline/result-normalize.js";

/** state.json format. A run dir with any other value is refused on load. */
export const RUN_STATE_SCHEMA_VERSION = 2;

export type LoopStage = "interpret" | "act" | "observe" | "adjust" | "checkpoint";
export type PhaseStatus = "pending" | "running" | "completed";
export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface RunPaths {
  runDir: string;
  state: string;
  report: string;
  resultsDir: string;
  commitsDir: string;
  workersDir: string;
}

export interface RunPhase {
  id: string;
  name: string;
  status: PhaseStatus;
  taskIds: string[];
  mode: "sequential" | "parallel";
  overlapPrevious?: boolean;
}

export interface TaskError {
  code: string;
  message: string;
  at: string;
}

export interface RunTask {
  id: string;
  kind: "agent" | "artifact";
  phase: string;
  status: TaskStatus;
  prompt: string;
  requiresEvidence: boolean;
  /** The task reviews the target repo: evidence mostly under .cw/ is refused. */
  reviewsRepo?: boolean;
  /** Earlier phases' accepted results go into this task's input.md. */
  includePriorResults?: boolean;
  workerId?: string;
  attempts?: number;
  errors?: TaskError[];
  startedAt?: string;
  completedAt?: string;
  resultPath?: string;
  result?: ResultEnvelope;
  /** The model the agent named itself; "unreported" when it named none. */
  model?: string;
  usageAttestation?: "attested" | "unattested" | "absent";
}

export interface StateCommit {
  id: string;
  createdAt: string;
  reason: string;
  loopStage: LoopStage;
  statePath: string;
  reportPath: string;
  snapshotPath: string;
  gitHead?: string;
  verifierGated: boolean;
  verifierTaskId?: string;
  evidence?: string[];
}

export interface WorkflowRun {
  schemaVersion: typeof RUN_STATE_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  workflow: {
    id: string;
    title: string;
    summary: string;
    limits: { maxAgents: number; maxConcurrentAgents: number };
  };
  inputs: Record<string, unknown>;
  loopStage: LoopStage;
  phases: RunPhase[];
  tasks: RunTask[];
  commits: StateCommit[];
  paths: RunPaths;
}
