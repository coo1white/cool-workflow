import type { CoordinatorDecisionKind } from "./blackboard";
import type { MultiAgentPolicy } from "./multi-agent";

/** Topology id — an open string namespace. The three official topologies
 *  ("map-reduce", "debate", "judge-panel") are the built-in POLICY registered
 *  at module load via registerTopology(). Any module can register additional
 *  topologies — the registry is MECHANISM, the entries are POLICY. */
export type MultiAgentTopologyId = string;
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
  /** Per-phase progress tracking (v0.1.65): phase id -> { status, completedAt }.
   *  Updated as the topology advances through phases. */
  phaseProgress?: Record<string, { status: "pending" | "running" | "completed" | "blocked"; completedAt?: string }>;
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
