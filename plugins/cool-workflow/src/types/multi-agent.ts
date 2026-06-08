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
