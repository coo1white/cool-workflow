export type TaskKind = "agent" | "artifact";
export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type PhaseStatus = "pending" | "running" | "completed";
export type LoopStage = "interpret" | "act" | "observe" | "adjust" | "checkpoint";
export type FindingClassification = "real" | "conditional" | "non-issue" | "unknown";
export type Severity = "P0" | "P1" | "P2" | "P3" | "none";

export interface WorkflowLimits {
  maxAgents: number;
  maxConcurrentAgents: number;
}

export interface WorkflowInputDefinition {
  name: string;
  required?: boolean;
  repeated?: boolean;
}

export interface WorkflowTaskDefinition {
  id: string;
  kind: TaskKind;
  prompt: string;
  status: TaskStatus;
  requiresEvidence?: boolean;
}

export interface WorkflowPhaseDefinition {
  id: string;
  name: string;
  status: PhaseStatus;
  tasks: WorkflowTaskDefinition[];
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  summary?: string;
  limits: WorkflowLimits;
  inputs: WorkflowInputDefinition[];
  phases: WorkflowPhaseDefinition[];
}

export interface RunPaths {
  runDir: string;
  state: string;
  report: string;
  tasksDir: string;
  resultsDir: string;
  dispatchesDir: string;
  artifactsDir: string;
  commitsDir: string;
}

export interface RunPhase {
  id: string;
  name: string;
  status: PhaseStatus;
  taskIds: string[];
}

export interface Finding {
  id: string;
  classification?: FindingClassification;
  severity?: Severity;
  evidence?: string[];
}

export interface ResultEnvelope {
  summary: string;
  findings: Finding[];
  evidence: string[];
}

export interface RunTask {
  id: string;
  kind: TaskKind;
  phase: string;
  status: TaskStatus;
  requiresEvidence: boolean;
  prompt: string;
  taskPath: string;
  resultPath: string;
  loopStage: LoopStage;
  dispatchId?: string;
  dispatchedAt?: string;
  completedAt?: string;
  result?: ResultEnvelope;
}

export interface DispatchTask {
  id: string;
  kind: TaskKind;
  phase: string;
  status: TaskStatus;
  taskPath: string;
  prompt: string;
}

export interface DispatchManifest {
  schemaVersion: 1;
  runId: string;
  dispatchId: string | null;
  createdAt?: string;
  phase?: string;
  instructions?: string;
  tasks: DispatchTask[];
  manifestPath?: string | null;
}

export interface RunDispatch {
  id: string;
  phase: string;
  taskIds: string[];
  manifestPath: string;
  createdAt: string;
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
}

export interface WorkflowRun {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  workflow: {
    id: string;
    title: string;
    summary: string;
    limits: WorkflowLimits;
  };
  inputs: Record<string, unknown>;
  loopStage: LoopStage;
  phases: RunPhase[];
  tasks: RunTask[];
  dispatches: RunDispatch[];
  commits: StateCommit[];
  paths: RunPaths;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  loopStage: LoopStage;
  phases: RunPhase[];
  tasks: {
    total: number;
    pending: number;
    running: number;
    failed: number;
    completed: number;
  };
  next: string | null;
  reportPath: string;
  commits: StateCommit[];
}

export type ScheduleKind = "loop" | "cron" | "reminder";
export type ScheduleStatus = "active" | "paused" | "completed" | "expired";

export interface ScheduledTask {
  id: string;
  kind: ScheduleKind;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  expiresAt: string;
  prompt: string;
  workflowId?: string;
  runId?: string;
  sessionId?: string;
  intervalMinutes?: number;
  cron?: string;
  jitterSeconds: number;
  maxRuns?: number;
  runCount: number;
  lastRunAt?: string;
  lastDueAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export type ScheduleRunStatus = "due" | "started" | "completed" | "failed" | "skipped";

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  status: ScheduleRunStatus;
  dueAt: string;
  startedAt?: string;
  completedAt?: string;
  prompt: string;
  cwd: string;
  workflowId?: string;
  runId?: string;
  error?: string;
}

export interface ScheduleStore {
  schemaVersion: 1;
  tasks: ScheduledTask[];
  history: ScheduleRunRecord[];
}

export type RoutineTriggerKind = "api" | "github";

export interface RoutineTrigger {
  id: string;
  kind: RoutineTriggerKind;
  createdAt: string;
  updatedAt: string;
  source: string;
  prompt: string;
  workflowId?: string;
  runId?: string;
  match?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RoutineTriggerEvent {
  id: string;
  triggerId: string;
  kind: RoutineTriggerKind;
  receivedAt: string;
  matched: boolean;
  prompt?: string;
  payloadPath: string;
}

export interface RoutineTriggerStore {
  schemaVersion: 1;
  triggers: RoutineTrigger[];
  events: RoutineTriggerEvent[];
}
