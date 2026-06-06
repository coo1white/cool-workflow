export type TaskKind = "agent" | "artifact";
export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type PhaseStatus = "pending" | "running" | "completed";
export type LoopStage = "interpret" | "act" | "observe" | "adjust" | "checkpoint";
export type FindingClassification = "real" | "conditional" | "non-issue" | "unknown";
export type Severity = "P0" | "P1" | "P2" | "P3" | "none";
export type StateNodeKind =
  | "input"
  | "task"
  | "dispatch"
  | "result"
  | "verifier"
  | "commit"
  | "report"
  | "schedule"
  | "trigger"
  | "error";
export type StateNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "verified"
  | "rejected"
  | "committed";

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
  stateNodesDir: string;
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

export interface StateArtifact {
  id: string;
  kind: string;
  path: string;
  description?: string;
}

export interface StateEvidence {
  id: string;
  source?: string;
  path?: string;
  locator?: string;
  summary?: string;
}

export interface StateNodeError {
  code: string;
  message: string;
  at: string;
  nodeId?: string;
  path?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface StateNode {
  schemaVersion: 1;
  id: string;
  kind: StateNodeKind;
  status: StateNodeStatus;
  loopStage: LoopStage;
  createdAt: string;
  updatedAt: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  artifacts: StateArtifact[];
  evidence: StateEvidence[];
  errors: StateNodeError[];
  parents: string[];
  children: string[];
  contractId?: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineVerifierGate {
  required?: boolean;
  acceptedStatuses?: StateNodeStatus[];
  requiredEvidence?: boolean;
}

export interface PipelineStageFailurePolicy {
  retryable?: boolean;
  maxAttempts?: number;
  preserveFailureNode?: boolean;
  failureKind?: StateNodeKind;
}

export interface PipelineStageContract {
  id: string;
  name: string;
  acceptedInputKinds: StateNodeKind[];
  acceptedInputStatuses: StateNodeStatus[];
  producedOutputKind: StateNodeKind;
  requiredArtifacts?: string[];
  requiredEvidence?: string[];
  verifierGate?: PipelineVerifierGate;
  failure?: PipelineStageFailurePolicy;
}

export interface PipelineArtifactPolicy {
  root?: string;
  requireReadablePaths?: boolean;
}

export interface PipelineEvidencePolicy {
  requireEvidence?: boolean;
  highPriorityRequiresEvidence?: boolean;
}

export interface PipelineFailurePolicy {
  preserveFailureNodes?: boolean;
  retryableByDefault?: boolean;
}

export interface PipelineCommitPolicy {
  requiresVerifierGate?: boolean;
  acceptedVerifierStatuses?: StateNodeStatus[];
}

export interface PipelineCompatibility {
  minSchemaVersion: number;
  maxSchemaVersion: number;
  notes?: string;
}

export interface PipelineContract {
  schemaVersion: 1;
  id: string;
  title: string;
  stages: PipelineStageContract[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  artifactPolicy?: PipelineArtifactPolicy;
  evidencePolicy?: PipelineEvidencePolicy;
  failurePolicy?: PipelineFailurePolicy;
  commitPolicy?: PipelineCommitPolicy;
  compatibility: PipelineCompatibility;
}

export type PipelineRunnerStatus = "advanced" | "failed" | "idle";

export interface PipelineRunnerOptions {
  contractId?: string;
  persist?: boolean;
}

export interface PipelineStageRunOptions extends PipelineRunnerOptions {
  outputNodeId?: string;
  outputStatus?: StateNodeStatus;
  loopStage?: LoopStage;
  outputs?: Record<string, unknown>;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
  metadata?: Record<string, unknown>;
  preserveFailureNode?: boolean;
}

export interface RunnablePipelineStage {
  runId: string;
  contractId: string;
  stageId: string;
  inputNodeId: string;
  outputKind: StateNodeKind;
}

export interface PipelineStageFailure {
  runId: string;
  contractId: string;
  stageId: string;
  inputNodeId: string;
  outputNodeId?: string;
  status: "failed";
  error: StateNodeError;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
}

export interface PipelineStageRunResult {
  runId: string;
  contractId: string;
  stageId: string;
  inputNodeId: string;
  outputNodeId?: string;
  status: Exclude<PipelineRunnerStatus, "idle">;
  error?: StateNodeError;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
}

export interface PipelineAdvanceResult {
  runId: string;
  contractId: string;
  status: PipelineRunnerStatus;
  stages: PipelineStageRunResult[];
  runnable: RunnablePipelineStage[];
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
  stateNodeId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
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
  stateNodeId?: string;
}

export interface RunDispatch {
  id: string;
  phase: string;
  taskIds: string[];
  manifestPath: string;
  createdAt: string;
  stateNodeId?: string;
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
  stateNodeId?: string;
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
  nodes?: StateNode[];
  contracts?: PipelineContract[];
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
