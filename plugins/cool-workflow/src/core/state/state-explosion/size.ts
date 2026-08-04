// core/state/state-explosion/size.ts — computeStateSizeWithGraph,
// DEFAULT_STATE_EXPLOSION_THRESHOLDS.
//
// MILESTONE 4 (plugins/cool-workflow/project/docs/rebuild/PLAN.md build order, step 4). Byte-exact port of the old
// build's src/state-explosion/size.ts. The counts are the same 12
// categories the old build reads off `run.multiAgent`/`run.blackboard`
// (loose `unknown[]`-typed record arrays at this milestone — see core/
// state/types.ts's header note; their per-record shapes land with
// milestone 9), so this file needs no reshape once those arrays start
// carrying real records.
//
// `computeStateSize` (the old build's one-arg convenience wrapper that
// ALSO builds the graph) is NOT defined here — the old build's own module
// boundary already has size.ts call the graph builder from a DIFFERENT
// file (multi-agent-operator-ux.ts); this file mirrors that by staying
// graph-builder-agnostic (`computeStateSizeWithGraph` takes the graph
// view as a plain parameter) and core/state/state-explosion/report.ts
// (which already imports both this file and graph.ts) supplies the
// one-arg convenience wrapper instead, avoiding a size.ts <-> graph.ts
// import cycle.
//
// Evidence: SPEC/state-core.md "src/state-explosion.ts + src/state-
// explosion/* — derived summary layer", "computeStateSize(...)".

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
  totalRecords: 80,
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

/** Minimal run shape this file reads: the loose `multiAgent`/`blackboard`
 *  record arrays (core/state/types.ts's `MultiAgentState`/`BlackboardState`
 *  — `unknown[]` at this milestone, real shapes land with milestone 9). */
export interface StateSizeRunView {
  multiAgent?: {
    runs?: unknown[];
    roles?: unknown[];
    groups?: unknown[];
    memberships?: unknown[];
    fanouts?: unknown[];
    fanins?: unknown[];
  };
  blackboard?: {
    topics?: unknown[];
    messages?: unknown[];
    contexts?: unknown[];
    artifacts?: unknown[];
    snapshots?: unknown[];
    decisions?: unknown[];
  };
}

/** The graph shape `computeStateSizeWithGraph` needs — just node/edge
 *  counts, so any caller (the milestone-4 `buildCompactGraph` below, or a
 *  later milestone's full multi-agent operator graph) can supply it
 *  without this file depending on the graph BUILDER itself. */
export interface StateSizeGraphView {
  nodes: unknown[];
  edges: unknown[];
}

export function computeStateSizeWithGraph(
  run: StateSizeRunView,
  thresholds: StateExplosionThresholds,
  graph: StateSizeGraphView
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
    graphEdges: graph.edges.length,
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

