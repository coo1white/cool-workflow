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
  | "blackboard"
  | "blackboard-topic"
  | "blackboard-message"
  | "blackboard-context"
  | "blackboard-artifact"
  | "blackboard-snapshot"
  | "coordinator-decision"
  | "topology-run"
  | "topology-phase"
  | "multi-agent-run"
  | "agent-role"
  | "agent-group"
  | "agent-membership"
  | "agent-fanout"
  | "agent-fanin"
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
  multiAgentDir?: string;
  blackboardDir?: string;
  topologiesDir?: string;
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
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  blackboardContextId?: string;
  blackboardArtifactRefId?: string;
  blackboardSnapshotId?: string;
  coordinatorDecisionId?: string;
  topologyId?: string;
  topologyRunId?: string;
  sandboxProfileId?: string;
  policyRef?: string;
  multiAgentPolicyRef?: string;
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
  multiAgent: {
    runs: number;
    roles: number;
    groups: number;
    memberships: number;
    fanouts: number;
    fanins: number;
    events: number;
  };
  blackboard?: {
    boards: number;
    topics: number;
    messages: number;
    contexts: number;
    artifacts: number;
    snapshots: number;
    decisions: number;
    events: number;
  };
  topologies?: {
    runs: number;
    events: number;
  };
  multiAgentTrust?: {
    rolePolicies: number;
    permissionDecisions: number;
    blackboardWrites: number;
    messageProvenance: number;
    judgeRationales: number;
    panelDecisions: number;
    policyViolations: number;
  };
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

export type MultiAgentLifecycleStatus =
  | "planned"
  | "forming"
  | "running"
  | "collecting"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";
export type AgentRoleStatus = "planned" | "active" | "completed" | "blocked" | "cancelled";
export type AgentGroupStatus = MultiAgentLifecycleStatus;
export type AgentMembershipStatus =
  | "planned"
  | "assigned"
  | "running"
  | "reported"
  | "verified"
  | "failed"
  | "cancelled";
export type AgentFanoutStatus = "planned" | "dispatched" | "completed" | "failed" | "cancelled";
export type AgentFaninStatus = "planned" | "collecting" | "blocked" | "ready" | "verifying" | "completed" | "failed";

export interface MultiAgentLifecycleEvent {
  at: string;
  from?: string;
  to: string;
  actor?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type MultiAgentPolicyWriteOperation =
  | "message"
  | "context"
  | "artifact"
  | "snapshot"
  | "topic"
  | "coordinator-decision";
export type MultiAgentPolicyCandidateOperation = "register" | "score" | "select";
export type MultiAgentPolicyJudgeOperation = "verdict" | "rationale" | "panel-decision";
export type MultiAgentPolicyOperation =
  | MultiAgentPolicyWriteOperation
  | `candidate.${MultiAgentPolicyCandidateOperation}`
  | `judge.${MultiAgentPolicyJudgeOperation}`;

export interface MultiAgentDeniedOperation {
  operation: MultiAgentPolicyOperation | string;
  reason: string;
}

export interface MultiAgentPolicy {
  schemaVersion: 1;
  id: string;
  policyRef: string;
  subjectKind: "multi-agent-run" | "role" | "group" | "membership" | "fanout" | "fanin" | "topology";
  subjectId: string;
  allowedBlackboardTopicIds: string[];
  allowedWriteOperations: MultiAgentPolicyWriteOperation[];
  allowedCandidateOperations: MultiAgentPolicyCandidateOperation[];
  allowedJudgeOperations: MultiAgentPolicyJudgeOperation[];
  sandboxProfileHints: string[];
  requiredEvidenceRefs: string[];
  requiredEvidenceFor?: Record<string, string[]>;
  deniedOperations: MultiAgentDeniedOperation[];
  metadata?: Record<string, unknown>;
}

export interface MultiAgentLinkage {
  workflowRunId: string;
  phase?: string;
  phaseId?: string;
  taskIds?: string[];
  dispatchIds?: string[];
  workerIds?: string[];
  candidateIds?: string[];
  verifierNodeIds?: string[];
  commitIds?: string[];
  auditEventIds?: string[];
  blackboardId?: string;
  blackboardTopicIds?: string[];
}

export interface MultiAgentRun {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: MultiAgentLifecycleStatus;
  title?: string;
  objective?: string;
  parentMultiAgentRunId?: string;
  childMultiAgentRunIds: string[];
  roleIds: string[];
  groupIds: string[];
  fanoutIds: string[];
  faninIds: string[];
  blackboardId?: string;
  topicIds?: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  links: MultiAgentLinkage;
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentRole {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  createdAt: string;
  updatedAt: string;
  status: AgentRoleStatus;
  title: string;
  responsibilities: string[];
  requiredEvidence: string[];
  sandboxProfileHints: string[];
  expectedArtifacts: string[];
  faninObligations: string[];
  blackboardId?: string;
  topicIds?: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  parentRoleId?: string;
  childRoleIds: string[];
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentGroup {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  createdAt: string;
  updatedAt: string;
  status: AgentGroupStatus;
  title?: string;
  phase?: string;
  phaseId?: string;
  taskIds: string[];
  roleIds: string[];
  membershipIds: string[];
  workerIds: string[];
  fanoutIds: string[];
  faninIds: string[];
  blackboardId?: string;
  topicIds?: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  parentGroupId?: string;
  childGroupIds: string[];
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentMembership {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  groupId: string;
  roleId: string;
  taskId: string;
  workerId?: string;
  dispatchId?: string;
  fanoutId?: string;
  createdAt: string;
  updatedAt: string;
  status: AgentMembershipStatus;
  lifecycle: MultiAgentLifecycleEvent[];
  resultNodeId?: string;
  verifierNodeId?: string;
  evidenceRefs: string[];
  artifactPaths: string[];
  blackboardId?: string;
  topicIds?: string[];
  blackboardMessageIds?: string[];
  blackboardArtifactRefIds?: string[];
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentFanout {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  status: AgentFanoutStatus;
  reason: string;
  roleIds: string[];
  taskIds: string[];
  workerIds: string[];
  membershipIds: string[];
  dispatchIds: string[];
  concurrencyLimit?: number;
  sandboxProfileChoices: Record<string, string>;
  expectedReturnShape: string;
  blackboardId?: string;
  topicIds?: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentFaninEvidenceCoverage {
  membershipId: string;
  roleId: string;
  taskId: string;
  workerId?: string;
  evidenceRefs: string[];
  blackboardMessageIds?: string[];
  blackboardArtifactRefIds?: string[];
  resultNodeId?: string;
  verifierNodeId?: string;
  complete: boolean;
}

export interface AgentFanin {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  groupId: string;
  fanoutId?: string;
  createdAt: string;
  updatedAt: string;
  status: AgentFaninStatus;
  strategy: string;
  requiredRoleIds: string[];
  reportedMembershipIds: string[];
  missingMembershipIds: string[];
  missingRoleIds: string[];
  evidenceCoverage: AgentFaninEvidenceCoverage[];
  verifierReady: boolean;
  blockedReasons: string[];
  blackboardId?: string;
  topicIds?: string[];
  blackboardArtifactRefIds?: string[];
  blackboardMessageIds?: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface MultiAgentState {
  schemaVersion: 1;
  runs: MultiAgentRun[];
  roles: AgentRole[];
  groups: AgentGroup[];
  memberships: AgentMembership[];
  fanouts: AgentFanout[];
  fanins: AgentFanin[];
}

export type MultiAgentTopologyId = "map-reduce" | "debate" | "judge-panel";
export type TopologyRunStatus = "planned" | "running" | "blocked" | "ready" | "completed" | "failed";

export interface TopologyRoleSpec {
  id: string;
  title: string;
  responsibilities: string[];
  groupId?: string;
  count?: number;
  requiredEvidence: string[];
  expectedArtifacts: string[];
  faninObligations: string[];
}

export interface TopologyPhaseSpec {
  id: string;
  title: string;
  roleIds: string[];
  fanout?: boolean;
  fanin?: boolean;
  requiredEvidence: string[];
  coordinatorDecisionKinds: CoordinatorDecisionKind[];
}

export interface MultiAgentTopologyDefinition {
  schemaVersion: 1;
  id: MultiAgentTopologyId;
  title: string;
  summary: string;
  roles: TopologyRoleSpec[];
  groups: Array<{ id: string; title: string; roleIds: string[] }>;
  blackboardTopics: Array<{ id: string; title: string; description: string }>;
  phases: TopologyPhaseSpec[];
  fanoutStrategy: string;
  faninStrategy: string;
  requiredEvidence: string[];
  coordinatorDecisions: CoordinatorDecisionKind[];
  candidateExpectations: string[];
  verifierGates: string[];
}

export interface TopologyValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface TopologyValidationResult {
  valid: boolean;
  topologyId: string;
  issues: TopologyValidationIssue[];
  definition?: MultiAgentTopologyDefinition;
}

export interface MultiAgentTopologyRun {
  schemaVersion: 1;
  id: string;
  runId: string;
  topologyId: MultiAgentTopologyId;
  createdAt: string;
  updatedAt: string;
  status: TopologyRunStatus;
  title: string;
  multiAgentRunId: string;
  blackboardId: string;
  topicIds: string[];
  roleIds: string[];
  groupIds: string[];
  fanoutIds: string[];
  faninIds: string[];
  messageIds: string[];
  artifactRefIds: string[];
  coordinatorDecisionIds: string[];
  candidateIds: string[];
  selectionIds: string[];
  commitIds: string[];
  missingEvidence: string[];
  conflicts: string[];
  nextActions: string[];
  links: {
    workflowRunId: string;
    multiAgentRunId: string;
    blackboardId: string;
    blackboardTopicIds: string[];
    agentRoleIds: string[];
    agentGroupIds: string[];
    agentFanoutIds: string[];
    agentFaninIds: string[];
    coordinatorDecisionIds: string[];
    candidateIds: string[];
    selectionIds: string[];
    commitIds: string[];
    auditEventIds: string[];
  };
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface TopologyState {
  schemaVersion: 1;
  runs: MultiAgentTopologyRun[];
}

export interface TopologySummary {
  runId: string;
  totalRuns: number;
  runsByStatus: Record<string, number>;
  officialTopologies: string[];
  active: Array<{
    id: string;
    topologyId: string;
    status: TopologyRunStatus;
    multiAgentRunId: string;
    blackboardId: string;
    roles: string[];
    groups: string[];
    topics: string[];
    fanouts: string[];
    fanins: string[];
    missingEvidence: string[];
    conflicts: string[];
    readiness: string;
    nextActions: string[];
  }>;
  nextAction?: string;
}

export interface WorkerMultiAgentMetadata {
  runId: string;
  groupId: string;
  roleId: string;
  membershipId?: string;
  fanoutId?: string;
}

export type BlackboardRecordStatus = "active" | "open" | "resolved" | "superseded" | "conflicting" | "rejected" | "archived";
export type BlackboardScopeKind = "run" | "multi-agent-run" | "group" | "role" | "membership" | "task" | "worker" | "candidate" | "verifier" | "commit" | "operator";
export type BlackboardAuthorKind = "runtime" | "operator" | "worker" | "role" | "group" | "membership" | "coordinator" | "verifier";
export type BlackboardContextKind = "fact" | "constraint" | "assumption" | "question" | "decision";
export type CoordinatorDecisionKind = "context-update" | "artifact-index" | "candidate-synthesis" | "conflict-resolution" | "fanin-readiness" | "message-moderation";
export type CoordinatorDecisionOutcome = "accepted" | "rejected" | "superseded" | "conflicting" | "ready" | "blocked";

export interface BlackboardAuthor {
  kind: BlackboardAuthorKind;
  id: string;
  displayName?: string;
}

export interface BlackboardScope {
  kind: BlackboardScopeKind;
  id: string;
}

export interface BlackboardLinks {
  workflowRunId: string;
  multiAgentRunId?: string;
  agentGroupId?: string;
  agentRoleId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  taskId?: string;
  workerId?: string;
  candidateId?: string;
  verifierNodeId?: string;
  commitId?: string;
  auditEventIds?: string[];
  evidenceRefs?: string[];
}

export interface BlackboardMessageProvenance {
  schemaVersion: 1;
  authorKind: BlackboardAuthorKind;
  authorId: string;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  workerId?: string;
  source: TrustAuditSource;
  linkedEvidenceRefs: string[];
  linkedAuditEventIds: string[];
  parentMessageIds: string[];
  topicScope: string;
  bodyHash?: string;
  locator?: string;
}

export interface BlackboardRecordBase {
  schemaVersion: 1;
  id: string;
  runId: string;
  blackboardId: string;
  createdAt: string;
  updatedAt: string;
  author: BlackboardAuthor;
  scope: BlackboardScope;
  status: BlackboardRecordStatus;
  parentIds: string[];
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface Blackboard {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  author: BlackboardAuthor;
  scope: BlackboardScope;
  status: BlackboardRecordStatus;
  parentIds: string[];
  tags: string[];
  title: string;
  topicIds: string[];
  messageCount: number;
  contextIds: string[];
  artifactRefIds: string[];
  snapshotIds: string[];
  decisionIds: string[];
  links: BlackboardLinks;
  paths: {
    root: string;
    index: string;
    messages: string;
    topicsDir: string;
    contextsDir: string;
    artifactsDir: string;
    snapshotsDir: string;
    decisionsDir: string;
  };
  metadata?: Record<string, unknown>;
}

export interface BlackboardTopic extends BlackboardRecordBase {
  title: string;
  description?: string;
  messageIds: string[];
  contextIds: string[];
  artifactRefIds: string[];
  links: BlackboardLinks;
}

export interface BlackboardMessage extends BlackboardRecordBase {
  topicId: string;
  body: string;
  visibility: "public" | "group" | "role" | "private";
  replyToId?: string;
  linkedEvidenceRefs: string[];
  linkedArtifactRefIds: string[];
  linkedAuditEventIds: string[];
  links: BlackboardLinks;
  provenance?: BlackboardMessageProvenance;
}

export interface BlackboardContext extends BlackboardRecordBase {
  topicId: string;
  kind: BlackboardContextKind;
  key: string;
  value: string;
  supersedesContextIds: string[];
  supersededByContextId?: string;
  conflictingContextIds: string[];
  decisionId?: string;
  evidenceRefs: string[];
  artifactRefIds: string[];
  links: BlackboardLinks;
}

export interface BlackboardArtifactRef extends BlackboardRecordBase {
  topicId?: string;
  kind: string;
  path?: string;
  locator?: string;
  owner: BlackboardAuthor;
  source: string;
  provenance: BlackboardLinks;
  evidenceRefs: string[];
  checksum?: string;
  trustAuditEventIds: string[];
}

export interface BlackboardSnapshot extends BlackboardRecordBase {
  topicIds: string[];
  messageIds: string[];
  contextIds: string[];
  artifactRefIds: string[];
  decisionIds: string[];
  snapshotPath: string;
  indexPath: string;
  summary: Record<string, unknown>;
  links: BlackboardLinks;
}

export interface CoordinatorDecision extends BlackboardRecordBase {
  kind: CoordinatorDecisionKind;
  outcome: CoordinatorDecisionOutcome;
  subjectIds: string[];
  reason: string;
  evidenceRefs: string[];
  artifactRefIds: string[];
  messageIds: string[];
  links: BlackboardLinks;
}

export interface BlackboardState {
  schemaVersion: 1;
  boards: Blackboard[];
  topics: BlackboardTopic[];
  messages: BlackboardMessage[];
  contexts: BlackboardContext[];
  artifacts: BlackboardArtifactRef[];
  snapshots: BlackboardSnapshot[];
  decisions: CoordinatorDecision[];
}

export interface BlackboardSummary {
  runId: string;
  blackboardId?: string;
  topics: number;
  messages: number;
  contexts: number;
  artifacts: number;
  snapshots: number;
  decisions: number;
  openQuestions: BlackboardContext[];
  conflicts: BlackboardContext[];
  missingEvidence: string[];
  readyForFanin: boolean;
  latestSnapshotPath?: string;
  indexPath?: string;
  nextAction?: string;
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
  multiAgent?: WorkerMultiAgentMetadata;
  blackboard?: {
    id: string;
    topicIds: string[];
    indexPath: string;
    messagesPath: string;
    topicsDir: string;
    contextsDir: string;
    artifactsDir: string;
    instructions: string[];
  };
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
  multiAgent?: WorkerMultiAgentMetadata;
  blackboard?: {
    id: string;
    topicIds: string[];
    indexPath: string;
    messagesPath: string;
    topicsDir: string;
    contextsDir: string;
    artifactsDir: string;
    instructions: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface WorkerIsolationOptions {
  workerId?: string;
  dispatchId?: string;
  sandboxProfileId?: string;
  status?: WorkerIsolationStatus;
  policy?: WorkerIsolationPolicy;
  multiAgent?: WorkerMultiAgentMetadata;
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
  judgeRationaleIds?: string[];
  panelDecisionId?: string;
}

// ---------------------------------------------------------------------------
// Evidence Adoption Reasoning Chain (v0.1.26)
//
// Derived, provenance-backed records that explain WHY each evidence item was
// adopted / rejected / superseded / conflicting at each gate. These are a
// DERIVED view over existing source-of-truth records (StateEvidence,
// EvidenceProvenance, CandidateScore, CandidateSelection, AcceptanceRationale,
// StateCommit, CoordinatorDecision, TrustAuditEvent, AgentFanin): they never
// duplicate or mutate them, only link by id / ref. They follow the v0.1.25
// state-explosion summary discipline (sourceFingerprint + valid|stale|absent
// freshness, refreshable, never authoritative over raw state).
//
// FreeBSD tenet — SEPARATE MECHANISM FROM POLICY: these records capture, store
// and render the "why" (mechanism). What counts as a *sufficient* reason is left
// to the verifier / role policy (policy). The chain only reports whether a
// rationale could be traced; it never decides whether the reason is good enough.
// FreeBSD tenet — FAIL CLOSED, NEVER INFER: an adoption whose rationale cannot be
// traced to a real record renders as `unexplained` — never a fabricated reason.
// ---------------------------------------------------------------------------

// Gate at which an adoption decision is taken. Matches the existing adoption
// path vocabulary: worker result -> blackboard -> fanin -> candidate score ->
// selection -> verifier-gated commit.
export type EvidenceReasoningGate =
  | "fanin"
  | "candidate-score"
  | "selection"
  | "verifier"
  | "commit";

// Per-step / per-chain decision status. Mirrors MultiAgentOperatorEvidenceStatus
// (adopted/rejected/pending/superseded/conflicting/missing) and adds the
// fail-closed `unexplained` state for an adoption with no traceable rationale.
export type EvidenceReasoningStatus =
  | "adopted"
  | "rejected"
  | "superseded"
  | "conflicting"
  | "pending"
  | "missing"
  | "unexplained";

// Whether a rationale could be traced to a real source record. Never inferred:
// `unexplained` is a visible state, not a guess. `not-applicable` covers steps
// where no adoption decision is taken (e.g. still-pending evidence).
export type EvidenceRationaleStatus = "explained" | "unexplained" | "not-applicable";

// Derived-view freshness, identical in spirit to the state-explosion
// SummaryStatus. Declared here so types.ts stays import-free of src modules.
export type EvidenceReasoningFreshnessStatus = "valid" | "stale" | "absent";

// BASIS: the concrete evidence + provenance + trust source grounding a decision.
// Links to existing EvidenceProvenance / trust-audit records; does not copy them.
export interface EvidenceReasoningBasis {
  evidenceRefs: string[];
  provenanceSource?: TrustAuditSource;
  parentEvidenceIds: string[];
  auditEventIds: string[];
}

// AUTHORITY: which role / membership / worker made the call and under which role
// policy it was permitted. Links to existing trust / policy / audit records.
export interface EvidenceReasoningAuthority {
  actor?: string;
  actorKind:
    | "role"
    | "membership"
    | "worker"
    | "operator"
    | "coordinator"
    | "verifier"
    | "runtime";
  policyRef?: string;
  allowed?: boolean;
}

// RATIONALE: the explicit recorded reason. Reuses existing rationale fields
// (selection.reason, AcceptanceRationale, score.notes/verdict, commit.reason,
// CoordinatorDecision.reason, judge-rationale audit metadata). When none exists,
// status is `unexplained` and text is omitted — never fabricated.
export interface EvidenceReasoningRationale {
  status: EvidenceRationaleStatus;
  text?: string;
  sourceKind?:
    | "selection-reason"
    | "acceptance-rationale"
    | "score-notes"
    | "score-verdict"
    | "commit-reason"
    | "coordinator-decision"
    | "judge-rationale";
  sourceId?: string;
  judgeRationaleIds?: string[];
  panelDecisionId?: string;
  scoreCriteria?: Record<string, number>;
  // Normalized score delta vs. the best rejected candidate, when computable.
  scoreDelta?: number;
}

// COUNTERFACTUAL: a rejected/losing alternative and the recorded reason it lost,
// so adoption is understood relative to its alternatives. Reasons are recorded,
// never inferred.
export interface EvidenceReasoningCounterfactual {
  ref: string;
  kind: "candidate" | "score" | "decision" | "evidence";
  status: EvidenceReasoningStatus;
  reason: string;
}

// DECISION: one gate's worth of reasoning for a single evidence item.
export interface EvidenceReasoningStep {
  gate: EvidenceReasoningGate;
  decision: EvidenceReasoningStatus;
  basis: EvidenceReasoningBasis;
  authority: EvidenceReasoningAuthority;
  rationale: EvidenceReasoningRationale;
  counterfactuals: EvidenceReasoningCounterfactual[];
}

// The full reasoning chain for one evidence item across the gates it traversed.
export interface EvidenceReasoningChain {
  schemaVersion: 1;
  id: string;
  ref?: string;
  evidenceStatus: EvidenceReasoningStatus;
  rationaleStatus: EvidenceRationaleStatus;
  sourceKind: "worker" | "blackboard" | "coordinator" | "verifier" | "operator" | "runtime";
  sourceId?: string;
  steps: EvidenceReasoningStep[];
  sourceRecordIds: string[];
  unexplainedReasons: string[];
}

// INTEGRITY: a fingerprinted, freshness-tracked report over all chains.
export interface EvidenceReasoningReport {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  freshness: {
    status: EvidenceReasoningFreshnessStatus;
    persistedFingerprint?: string;
    currentFingerprint: string;
  };
  sourceFingerprint: string;
  totals: {
    chains: number;
    explained: number;
    unexplained: number;
    notApplicable: number;
    adopted: number;
    rejected: number;
    byStatus: Record<string, number>;
  };
  chains: EvidenceReasoningChain[];
  nextAction: string;
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
  multiAgent?: WorkerMultiAgentMetadata;
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
  multiAgent?: WorkerMultiAgentMetadata;
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
  multiAgent?: {
    runId?: string;
    groupId?: string;
    roleId?: string;
    fanoutId?: string;
    membershipIds?: string[];
  };
  blackboard?: {
    id: string;
    topicIds: string[];
    indexPath: string;
    messagesPath: string;
  };
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
  multiAgent?: {
    runId?: string;
    groupId?: string;
    roleId?: string;
    fanoutId?: string;
    membershipIds?: string[];
  };
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
  multiAgent?: MultiAgentState;
  blackboard?: BlackboardState;
  topologies?: TopologyState;
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
