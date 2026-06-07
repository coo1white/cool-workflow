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
  | "candidate"
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
  type?: "string" | "number" | "boolean" | "path" | "json";
  description?: string;
  required?: boolean;
  repeated?: boolean;
  default?: unknown;
}

export interface WorkflowTaskDefinition {
  id: string;
  kind: TaskKind;
  prompt: string;
  status: TaskStatus;
  requiresEvidence?: boolean;
  sandboxProfileId?: string;
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
  sandboxProfiles?: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkflowAppEntrypoint {
  entrypoint: string;
  exportName?: string;
}

export type WorkflowAppWorkflow = WorkflowDefinition | WorkflowAppEntrypoint;

export interface WorkflowAppCompatibility {
  minVersion?: string;
  maxVersion?: string;
  coolWorkflow?: string;
  workflowSchemaVersion?: 1;
  node?: string;
  notes?: string;
}

export interface WorkflowAppDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  summary?: string;
  version: string;
  author?: string | { name: string; url?: string; email?: string };
  workflow: WorkflowAppWorkflow;
  inputs?: WorkflowInputDefinition[];
  sandboxProfiles?: string[];
  compatibility?: WorkflowAppCompatibility;
  metadata?: Record<string, unknown>;
}

export type WorkflowAppSourceKind = "app-directory" | "app-manifest" | "workflow-file";

export interface WorkflowAppSource {
  kind: WorkflowAppSourceKind;
  path: string;
  manifestPath?: string;
  entrypointPath?: string;
}

export interface LoadedWorkflowApp {
  app: WorkflowAppDefinition & { workflow: WorkflowDefinition };
  source: WorkflowAppSource;
  legacy: boolean;
}

export interface WorkflowAppSummary {
  id: string;
  title: string;
  summary: string;
  version: string;
  author?: WorkflowAppDefinition["author"];
  file: string;
  sourceKind: WorkflowAppSourceKind;
  legacy: boolean;
  compatible: boolean;
  inputs: WorkflowInputDefinition[];
  sandboxProfiles: string[];
  phases: Array<{ id: string; name: string; taskCount: number }>;
  taskCount: number;
}

export interface WorkflowAppValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface WorkflowAppValidationResult {
  valid: boolean;
  appId?: string;
  appPath?: string;
  issues: WorkflowAppValidationIssue[];
  summary?: WorkflowAppSummary;
}

export interface WorkflowAppRunMetadata {
  schemaVersion: 1;
  id: string;
  title: string;
  summary?: string;
  version: string;
  author?: WorkflowAppDefinition["author"];
  compatibility?: WorkflowAppCompatibility;
  sandboxProfiles?: string[];
  source?: WorkflowAppSource;
  metadata?: Record<string, unknown>;
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
  feedbackDir: string;
  auditDir?: string;
  workersDir?: string;
  candidatesDir?: string;
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
  provenance?: EvidenceProvenance;
}

export type TrustAuditSource =
  | "cw-validated"
  | "host-attested"
  | "operator-recorded"
  | "runtime-derived";

export type TrustAuditDecision =
  | "allowed"
  | "denied"
  | "accepted"
  | "rejected"
  | "recorded"
  | "validated"
  | "failed";

export interface EvidenceProvenance {
  schemaVersion: 1;
  runId?: string;
  source: TrustAuditSource;
  workerId?: string;
  taskId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  parentEvidenceIds?: string[];
  auditEventIds?: string[];
  note?: string;
}

export interface TrustAuditEvent {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  runId: string;
  kind: string;
  decision: TrustAuditDecision;
  source: TrustAuditSource;
  actor?: string;
  workerId?: string;
  taskId?: string;
  nodeId?: string;
  feedbackIds?: string[];
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  sandboxProfileId?: string;
  policyRef?: string;
  policySnapshot?: ResolvedSandboxPolicy;
  normalizedPath?: string;
  command?: string;
  networkTarget?: string;
  envVars?: string[];
  evidence?: StateEvidence[];
  evidenceRefs?: string[];
  parentEventIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface TrustAuditSummary {
  schemaVersion: 1;
  runId: string;
  generatedAt?: string;
  eventCount: number;
  eventLogPath: string;
  indexPath: string;
  summaryPath: string;
  byKind: Record<string, number>;
  byDecision: Record<string, number>;
  bySource: Record<string, number>;
  bySandboxProfile: Record<string, number>;
  workers: Array<{
    workerId: string;
    taskId?: string;
    sandboxProfileId?: string;
    decisions: Record<string, number>;
    denied: number;
    feedbackIds: string[];
  }>;
  candidates: Array<{
    candidateId: string;
    scoreIds: string[];
    selectionIds: string[];
    evidenceCount: number;
  }>;
  commits: Array<{
    commitId: string;
    verifierGated: boolean;
    candidateId?: string;
    selectionId?: string;
    evidenceCount: number;
    rationale?: Record<string, unknown>;
  }>;
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

export type ErrorFeedbackStatus = "open" | "tasked" | "resolved" | "rejected";
export type ErrorFeedbackSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ErrorFeedbackClassification =
  | "contract-violation"
  | "verifier-failure"
  | "state-transition"
  | "missing-artifact"
  | "missing-evidence"
  | "parse-error"
  | "pipeline-failure"
  | "sandbox-policy"
  | "runtime-error"
  | "unknown";
export type ErrorFeedbackSource =
  | "state-node"
  | "pipeline-runner"
  | "verifier"
  | "contract"
  | "cli"
  | "manual";

export interface ErrorFeedbackPolicy {
  retryableByDefault?: boolean;
  createCorrectionTasks?: boolean;
  verifierCommand?: string;
}

export interface ErrorFeedbackLoopOptions {
  policy?: ErrorFeedbackPolicy;
  source?: ErrorFeedbackSource;
  persist?: boolean;
}

export interface ErrorFeedbackRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: ErrorFeedbackStatus;
  severity: ErrorFeedbackSeverity;
  classification: ErrorFeedbackClassification;
  source: ErrorFeedbackSource;
  code: string;
  message: string;
  nodeId?: string;
  stageId?: string;
  contractId?: string;
  taskId?: string;
  path?: string;
  retryable: boolean;
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  correctionTaskId?: string;
  resolvedByNodeId?: string;
  metadata?: Record<string, unknown>;
}

export interface CorrectionTaskResult {
  status: "resolved" | "rejected";
  nodeId?: string;
  message?: string;
  evidence?: StateEvidence[];
  artifacts?: StateArtifact[];
  metadata?: Record<string, unknown>;
}

export type SandboxPolicyMode = "none" | "allowlist" | "any";

export interface SandboxCommandPolicy {
  mode: SandboxPolicyMode;
  allow?: string[];
  deny?: string[];
}

export interface SandboxNetworkPolicy {
  mode: SandboxPolicyMode;
  allow?: string[];
}

export interface SandboxEnvironmentPolicy {
  inherit?: boolean;
  expose: string[];
  deny?: string[];
}

export interface SandboxWorkerOutputPolicy {
  result: boolean;
  artifacts: boolean;
  logs: boolean;
}

export interface SandboxProfileDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  readPaths?: string[];
  writePaths?: string[];
  workerOutput?: Partial<SandboxWorkerOutputPolicy>;
  execute?: SandboxCommandPolicy;
  network?: SandboxNetworkPolicy;
  env?: SandboxEnvironmentPolicy;
  hostInstructions?: string[];
  metadata?: Record<string, unknown>;
}

export interface SandboxEnforcementContract {
  enforcedByCW: string[];
  hostRequired: string[];
}

export interface ResolvedSandboxPolicy {
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  readPaths: string[];
  writePaths: string[];
  workerOutput: SandboxWorkerOutputPolicy;
  execute: SandboxCommandPolicy;
  network: SandboxNetworkPolicy;
  env: SandboxEnvironmentPolicy;
  enforcement: SandboxEnforcementContract;
  hostInstructions: string[];
  resolvedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SandboxResolutionContext {
  cwd: string;
  runDir?: string;
  workerDir?: string;
  inputPath?: string;
  resultPath?: string;
  artifactsDir?: string;
  logsDir?: string;
  extraReadPaths?: string[];
  extraWritePaths?: string[];
  allowArtifacts?: boolean;
  allowLogs?: boolean;
}

export interface SandboxProfileValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface SandboxProfileValidationResult {
  valid: boolean;
  profileFile: string;
  issues: SandboxProfileValidationIssue[];
  profile?: ResolvedSandboxPolicy;
}

export type WorkerIsolationStatus =
  | "allocated"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "verified";

export interface WorkerIsolationPolicy {
  allowArtifacts?: boolean;
  allowLogs?: boolean;
  allowedPaths?: string[];
  readPaths?: string[];
  writePaths?: string[];
  sandboxProfileId?: string;
}

export interface WorkerBoundaryViolation {
  code: string;
  message: string;
  path?: string;
  allowedPaths: string[];
}

export interface WorkerOutputRecord {
  workerId: string;
  taskId: string;
  resultPath: string;
  recordedAt: string;
  stateNodeId?: string;
  verifierNodeId?: string;
  auditEventIds?: string[];
}

export interface WorkerScope {
  schemaVersion: 1;
  id: string;
  runId: string;
  taskId: string;
  dispatchId?: string;
  createdAt: string;
  updatedAt: string;
  status: WorkerIsolationStatus;
  workerDir: string;
  inputPath: string;
  resultPath: string;
  artifactsDir: string;
  logsDir: string;
  allowedPaths: string[];
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  stateNodeId?: string;
  resultNodeId?: string;
  feedbackIds: string[];
  errors: StateNodeError[];
  output?: WorkerOutputRecord;
  metadata?: Record<string, unknown>;
}

export interface WorkerManifest {
  schemaVersion: 1;
  id: string;
  runId: string;
  taskId: string;
  dispatchId?: string;
  createdAt: string;
  updatedAt: string;
  status: WorkerIsolationStatus;
  workerDir: string;
  inputPath: string;
  resultPath: string;
  artifactsDir: string;
  logsDir: string;
  allowedPaths: string[];
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  sandbox?: {
    profileId: string;
    policy: ResolvedSandboxPolicy;
    enforcedByCW: string[];
    hostRequired: string[];
  };
  instructions: string[];
  taskPath?: string;
  prompt?: string;
  stateNodeId?: string;
  resultNodeId?: string;
  feedbackIds?: string[];
  errors?: StateNodeError[];
  output?: WorkerOutputRecord;
  metadata?: Record<string, unknown>;
}

export interface WorkerIsolationOptions {
  workerId?: string;
  dispatchId?: string;
  sandboxProfileId?: string;
  status?: WorkerIsolationStatus;
  policy?: WorkerIsolationPolicy;
  metadata?: Record<string, unknown>;
  persist?: boolean;
}

export type CandidateStatus = "registered" | "scored" | "selected" | "rejected" | "verified" | "failed";
export type CandidateKind = "worker-output" | "result" | "artifact" | "manual";
export type CandidateScoreVerdict = "pass" | "warn" | "fail";

export interface CandidateScoringPolicy {
  id?: string;
  title?: string;
  criteria?: string[];
  requireEvidence?: boolean;
  requireVerifierGate?: boolean;
  minNormalized?: number;
  tieBreaker?: "createdAt" | "candidateId";
}

export interface CandidateScoringOptions {
  policy?: CandidateScoringPolicy;
  persist?: boolean;
}

export interface CandidateRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  kind: CandidateKind;
  status: CandidateStatus;
  createdAt: string;
  updatedAt: string;
  workerId?: string;
  taskId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  resultPath?: string;
  artifacts: StateArtifact[];
  evidence: StateEvidence[];
  scores: string[];
  selectedAt?: string;
  rejectedAt?: string;
  feedbackIds: string[];
  metadata?: Record<string, unknown>;
}

export interface CandidateScore {
  schemaVersion: 1;
  id: string;
  candidateId: string;
  runId: string;
  createdAt: string;
  scorer: string;
  criteria: Record<string, number>;
  total: number;
  maxTotal: number;
  normalized: number;
  verdict: CandidateScoreVerdict;
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CandidateRanking {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  policy: Required<Pick<CandidateScoringPolicy, "requireEvidence" | "requireVerifierGate" | "tieBreaker">> &
    CandidateScoringPolicy;
  candidates: Array<{
    candidateId: string;
    status: CandidateStatus;
    scoreCount: number;
    bestScoreId?: string;
    normalized: number;
    verdict?: CandidateScoreVerdict;
    rank: number;
  }>;
  ties: string[][];
}

export interface CandidateSelection {
  schemaVersion: 1;
  id: string;
  runId: string;
  candidateId: string;
  selectedAt: string;
  selectedBy: string;
  verifierNodeId?: string;
  scoreId?: string;
  rankingPath?: string;
  reason: string;
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  feedbackIds: string[];
  acceptanceRationale?: AcceptanceRationale;
  metadata?: Record<string, unknown>;
}

export interface AcceptanceRationale {
  schemaVersion: 1;
  selectedCandidateId?: string;
  scoreId?: string;
  scoreCriteria?: Record<string, number>;
  verifierNodeId?: string;
  evidenceCount: number;
  sandboxProfileId?: string;
  workerId?: string;
  commitGateResult?: "passed" | "blocked" | "checkpoint";
  auditEventIds?: string[];
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
  workerId?: string;
  workerManifestPath?: string;
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
}

export interface DispatchTask {
  id: string;
  kind: TaskKind;
  phase: string;
  status: TaskStatus;
  taskPath: string;
  prompt: string;
  workerId?: string;
  workerManifestPath?: string;
  workerDir?: string;
  workerResultPath?: string;
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
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
  workerIndexPath?: string;
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
}

export interface RunDispatch {
  id: string;
  phase: string;
  taskIds: string[];
  manifestPath: string;
  createdAt: string;
  stateNodeId?: string;
  workerIds?: string[];
  sandboxProfileId?: string;
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
  verifierGated?: boolean;
  checkpoint?: boolean;
  verifierNodeId?: string;
  candidateId?: string;
  selectionId?: string;
  evidence?: StateEvidence[];
  acceptanceRationale?: AcceptanceRationale;
  metadata?: Record<string, unknown>;
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
    app?: WorkflowAppRunMetadata;
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
  feedback?: ErrorFeedbackRecord[];
  audit?: {
    schemaVersion: 1;
    eventLogPath?: string;
    summaryPath?: string;
    indexPath?: string;
  };
  workers?: WorkerScope[];
  sandboxProfiles?: ResolvedSandboxPolicy[];
  candidates?: CandidateRecord[];
  candidateSelections?: CandidateSelection[];
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  app?: WorkflowAppRunMetadata;
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
  workers?: {
    total: number;
    byStatus: Record<string, number>;
  };
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
