import type { StateEvidence } from "./result";
import type { ResolvedSandboxPolicy } from "./sandbox";

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
