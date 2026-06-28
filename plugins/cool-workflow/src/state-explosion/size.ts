// State size computation — carved from state-explosion.ts (v0.1.95).
// Pure function of run state + thresholds; no blackboard/report/graph deps.
import { WorkflowRun } from "../types";
import { buildMultiAgentOperatorGraph } from "../multi-agent-operator-ux";

export const STATE_EXPLOSION_SCHEMA_VERSION = 1;

export interface StateExplosionThresholds {
  graphNodes: number;
  graphEdges: number;
  blackboardMessages: number;
  blackboardRecords: number;
  collapseBucket: number;
  totalRecords: number;
}

export const DEFAULT_STATE_EXPLOSION_THRESHOLDS: StateExplosionThresholds = {
  graphNodes: 40,
  graphEdges: 60,
  blackboardMessages: 25,
  blackboardRecords: 40,
  collapseBucket: 6,
  totalRecords: 80
};

export interface StateSize {
  /** Per-category counts. */
  multiAgentRuns: number;
  roles: number;
  groups: number;
  memberships: number;
  fanouts: number;
  fanins: number;
  topics: number;
  messages: number;
  contexts: number;
  artifacts: number;
  snapshots: number;
  decisions: number;
  /** Total raw multi-agent + blackboard record count. */
  total: number;
  /** Graph shape: nodes. */
  graphNodes: number;
  /** Graph shape: edges. */
  graphEdges: number;
  compactionRecommended: boolean;
  reasons: string[];
}

export function computeStateSize(run: WorkflowRun, thresholds = DEFAULT_STATE_EXPLOSION_THRESHOLDS): StateSize {
  return computeStateSizeWithGraph(run, thresholds, buildMultiAgentOperatorGraph(run));
}

export function computeStateSizeWithGraph(
  run: WorkflowRun,
  thresholds: StateExplosionThresholds,
  graph: ReturnType<typeof buildMultiAgentOperatorGraph>
): StateSize {
  const ma = run.multiAgent || { runs: [], roles: [], groups: [], memberships: [], fanouts: [], fanins: [] };
  const bb = run.blackboard || { topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] };
  const counts = {
    multiAgentRuns: (ma.runs || []).length,
    roles: (ma.roles || []).length,
    groups: (ma.groups || []).length,
    memberships: (ma.memberships || []).length,
    fanouts: (ma.fanouts || []).length,
    fanins: (ma.fanins || []).length,
    topics: (bb.topics || []).length,
    messages: (bb.messages || []).length,
    contexts: (bb.contexts || []).length,
    artifacts: (bb.artifacts || []).length,
    snapshots: (bb.snapshots || []).length,
    decisions: (bb.decisions || []).length,
    graphNodes: graph.nodes.length,
    graphEdges: graph.edges.length
  };
  const total =
    counts.multiAgentRuns +
    counts.roles +
    counts.groups +
    counts.memberships +
    counts.fanouts +
    counts.fanins +
    counts.topics +
    counts.messages +
    counts.contexts +
    counts.artifacts +
    counts.snapshots +
    counts.decisions;
  const reasons: string[] = [];
  if (counts.graphNodes > thresholds.graphNodes) reasons.push(`graph has ${counts.graphNodes} nodes (> ${thresholds.graphNodes})`);
  if (counts.graphEdges > thresholds.graphEdges) reasons.push(`graph has ${counts.graphEdges} edges (> ${thresholds.graphEdges})`);
  if (counts.messages > thresholds.blackboardMessages) reasons.push(`blackboard has ${counts.messages} messages (> ${thresholds.blackboardMessages})`);
  const bbRecords = counts.topics + counts.messages + counts.contexts + counts.artifacts + counts.snapshots + counts.decisions;
  if (bbRecords > thresholds.blackboardRecords) reasons.push(`blackboard has ${bbRecords} records (> ${thresholds.blackboardRecords})`);
  if (total > thresholds.totalRecords) reasons.push(`run has ${total} multi-agent records (> ${thresholds.totalRecords})`);
  return { ...counts, total, compactionRecommended: reasons.length > 0, reasons: reasons.sort() };
}
