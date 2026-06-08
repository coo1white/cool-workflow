import type { TrustAuditSource } from "./trust";

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
