import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WorkflowRun } from "./types";
import { writeJson, safeFileName } from "./state";
import { summarizeBlackboard } from "./coordinator";
import { summarizeMultiAgent } from "./multi-agent";
import {
  buildMultiAgentOperatorGraph,
  summarizeMultiAgentOperator,
  MultiAgentOperatorEvidence,
  MultiAgentOperatorFailure
} from "./multi-agent-operator-ux";
import { recordTrustAuditEvent } from "./trust-audit";

export const STATE_EXPLOSION_SCHEMA_VERSION = 1;

// Thresholds describe when a derived userland index should be presented in place
// of raw state. They never delete raw records; they only decide what the default
// human view collapses. Defaults are stable so output is deterministic.
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

export type StateExplosionScope =
  | "run"
  | "topology"
  | "multi-agent-run"
  | "group"
  | "role"
  | "membership"
  | "fanout"
  | "fanin"
  | "blackboard"
  | "topic"
  | "evidence"
  | "trust"
  | "eval";

export type SummaryStatus = "valid" | "stale" | "absent";

export type GraphView =
  | "full"
  | "compact"
  | "critical-path"
  | "failures"
  | "evidence"
  | "trust"
  | "topology"
  | "blackboard"
  | "candidate"
  | "commit-gate";

export const GRAPH_VIEWS: GraphView[] = [
  "full",
  "compact",
  "critical-path",
  "failures",
  "evidence",
  "trust",
  "topology",
  "blackboard",
  "candidate",
  "commit-gate"
];

export interface SummaryRecordBase {
  schemaVersion: number;
  runId: string;
  id: string;
  scope: StateExplosionScope;
  sourceRecordIds: string[];
  sourceFingerprint: string;
  includedCount: number;
  omittedCount: number;
  importantRefs: string[];
  evidenceRefs: string[];
  trustAuditEventRefs: string[];
  generatedAt: string;
  status: SummaryStatus;
  deterministic: boolean;
  nextAction: string;
}

export interface StateSize {
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
  graphNodes: number;
  graphEdges: number;
  total: number;
  compactionRecommended: boolean;
  reasons: string[];
}

export interface BlackboardDigestEntry {
  id: string;
  label: string;
  status: string;
  sourceIds: string[];
  evidenceRefs: string[];
  expansionCommand: string;
}

export interface BlackboardSummaryRecord extends SummaryRecordBase {
  scope: "blackboard";
  blackboardId?: string;
  topicRollups: BlackboardDigestEntry[];
  threadSummaries: BlackboardDigestEntry[];
  unresolvedQuestions: BlackboardDigestEntry[];
  conflicts: BlackboardDigestEntry[];
  decisions: BlackboardDigestEntry[];
  artifacts: BlackboardDigestEntry[];
  adoptedEvidence: BlackboardDigestEntry[];
  missingEvidence: BlackboardDigestEntry[];
  policyViolations: BlackboardDigestEntry[];
  judgeRationale: BlackboardDigestEntry[];
  recentChanges: BlackboardDigestEntry[];
  highSignal: BlackboardDigestEntry[];
}

export interface SyntheticSummaryNode {
  id: string;
  kind: "summary";
  label: string;
  status: string;
  collapsedNodeCount: number;
  collapsedEdgeCount: number;
  sourceIds: string[];
  dominantStatus: string;
  blockedReason?: string;
  expansionCommand: string;
}

export interface CompactGraphNode {
  id: string;
  kind: string;
  status: string;
  label: string;
  path?: string;
  synthetic?: SyntheticSummaryNode;
}

export interface CompactGraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface GraphSummaryRecord extends SummaryRecordBase {
  scope: "run";
  view: GraphView;
  focus?: string;
  depth?: number;
  fullNodeCount: number;
  fullEdgeCount: number;
  compactNodeCount: number;
  compactEdgeCount: number;
  collapsedNodeCount: number;
  collapsedEdgeCount: number;
  syntheticNodes: SyntheticSummaryNode[];
  criticalPath: string[];
  blockedReasons: string[];
  nodes: CompactGraphNode[];
  edges: CompactGraphEdge[];
}

export interface OperatorDigest extends SummaryRecordBase {
  scope: "run";
  stateSize: StateSize;
  compactGraphRef: string;
  blackboardDigestRef: string;
  criticalPath: string[];
  failures: Array<{ id: string; kind: string; status: string; reason: string; nextCommand: string }>;
  evidenceDigest: { adopted: number; missing: number; rejected: number; entries: BlackboardDigestEntry[] };
  trustDigest: { events: number; policyViolations: number; judgeRationales: number; entries: string[] };
  hiddenSourceRecords: Array<{ kind: string; count: number; expansionCommand: string }>;
  expansionCommands: string[];
}

export interface MultiAgentSummaryIndexEntry {
  scope: StateExplosionScope;
  id: string;
  path: string;
  sourceFingerprint: string;
  includedCount: number;
  omittedCount: number;
  status: SummaryStatus;
}

export interface MultiAgentSummaryIndex extends SummaryRecordBase {
  scope: "run";
  entries: MultiAgentSummaryIndexEntry[];
  views: GraphView[];
  paths: {
    summariesDir: string;
    indexPath: string;
    reportPath: string;
  };
}

export interface StateExplosionReport {
  schemaVersion: number;
  runId: string;
  generatedAt: string;
  stateSize: StateSize;
  freshness: {
    status: SummaryStatus;
    persistedFingerprint?: string;
    currentFingerprint: string;
    staleScopes: string[];
  };
  index?: MultiAgentSummaryIndex;
  compactGraph: GraphSummaryRecord;
  criticalPathGraph: GraphSummaryRecord;
  blackboardDigest: BlackboardSummaryRecord;
  operatorDigest: OperatorDigest;
  hiddenSourceRecords: OperatorDigest["hiddenSourceRecords"];
  expansionCommands: string[];
  nextAction: string;
}

// ---------------------------------------------------------------------------
// State size
// ---------------------------------------------------------------------------

export function computeStateSize(run: WorkflowRun, thresholds = DEFAULT_STATE_EXPLOSION_THRESHOLDS): StateSize {
  const ma = run.multiAgent || { runs: [], roles: [], groups: [], memberships: [], fanouts: [], fanins: [] };
  const bb = run.blackboard || { topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] };
  const graph = buildMultiAgentOperatorGraph(run);
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

// ---------------------------------------------------------------------------
// Blackboard digest (deterministic structural summary)
// ---------------------------------------------------------------------------

export function summarizeBlackboardDigest(run: WorkflowRun, blackboardId?: string): BlackboardSummaryRecord {
  const bb = run.blackboard || {
    boards: [],
    topics: [],
    messages: [],
    contexts: [],
    artifacts: [],
    snapshots: [],
    decisions: []
  };
  const board = blackboardId ? (bb.boards || []).find((b) => b.id === blackboardId) : (bb.boards || [])[0];
  const boardId = board?.id;
  const inBoard = <T extends { blackboardId?: string }>(items: T[]): T[] =>
    boardId ? items.filter((item) => item.blackboardId === boardId) : items;
  const topics = inBoard(bb.topics || []);
  const messages = inBoard(bb.messages || []);
  const contexts = inBoard(bb.contexts || []);
  const artifacts = inBoard(bb.artifacts || []);
  const decisions = inBoard(bb.decisions || []);
  const summary = summarizeBlackboard(run, boardId);

  const topicRollups: BlackboardDigestEntry[] = topics
    .map((topic) => {
      const topicMessages = messages.filter((m) => m.topicId === topic.id);
      return {
        id: topic.id,
        label: `${topic.title} (${topicMessages.length} messages, ${topic.contextIds.length} contexts, ${topic.artifactRefIds.length} artifacts)`,
        status: topic.status,
        sourceIds: [topic.id, ...topicMessages.map((m) => m.id)],
        evidenceRefs: unique(topicMessages.flatMap((m) => m.linkedEvidenceRefs || [])),
        expansionCommand: `node scripts/cw.js blackboard message list ${run.id} --topic ${topic.id}`
      };
    })
    .sort(byId);

  const threadSummaries: BlackboardDigestEntry[] = topics
    .map((topic) => {
      const topicMessages = messages
        .filter((m) => m.topicId === topic.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const last = topicMessages[topicMessages.length - 1];
      return {
        id: `thread:${topic.id}`,
        label: `${topic.title}: ${topicMessages.length} messages${last ? `; latest by ${last.author.kind}:${last.author.id}` : ""}`,
        status: topic.status,
        sourceIds: topicMessages.map((m) => m.id),
        evidenceRefs: unique(topicMessages.flatMap((m) => m.linkedEvidenceRefs || [])),
        expansionCommand: `node scripts/cw.js blackboard message list ${run.id} --topic ${topic.id}`
      };
    })
    .filter((entry) => entry.sourceIds.length)
    .sort(byId);

  const unresolvedQuestions: BlackboardDigestEntry[] = contexts
    .filter((c) => c.kind === "question" && c.status === "open")
    .map((c) => ({
      id: c.id,
      label: `${c.key}: ${truncate(c.value)}`,
      status: c.status,
      sourceIds: [c.id],
      evidenceRefs: unique([...(c.evidenceRefs || []), ...(c.artifactRefIds || [])]),
      expansionCommand: `node scripts/cw.js blackboard message post ${run.id} --topic ${c.topicId} --body "<answer with evidence>"`
    }))
    .sort(byId);

  const conflicts: BlackboardDigestEntry[] = contexts
    .filter((c) => c.status === "conflicting" || (c.conflictingContextIds || []).length)
    .map((c) => ({
      id: c.id,
      label: `${c.key} conflicts with ${(c.conflictingContextIds || []).join(", ") || "another value"}`,
      status: c.status,
      sourceIds: [c.id, ...(c.conflictingContextIds || [])],
      evidenceRefs: unique([...(c.evidenceRefs || []), ...(c.artifactRefIds || [])]),
      expansionCommand: `node scripts/cw.js coordinator decision ${run.id} --kind conflict-resolution --outcome accepted --subject ${c.id} --reason "<reason>"`
    }))
    .sort(byId);

  const decisionEntries: BlackboardDigestEntry[] = decisions
    .map((d) => ({
      id: d.id,
      label: `${d.kind}:${d.outcome} ${truncate(d.reason)}`,
      status: d.status,
      sourceIds: [d.id, ...(d.subjectIds || [])],
      evidenceRefs: unique([...(d.evidenceRefs || []), ...(d.artifactRefIds || [])]),
      expansionCommand: `node scripts/cw.js node show ${run.id} ${run.id}:coordinator:decision:${d.id}`
    }))
    .sort(byId);

  const artifactEntries: BlackboardDigestEntry[] = artifacts
    .map((a) => ({
      id: a.id,
      label: `${a.kind} ${a.locator || a.path || a.id}`,
      status: a.status,
      sourceIds: [a.id],
      evidenceRefs: unique(a.evidenceRefs || []),
      expansionCommand: `node scripts/cw.js blackboard artifact list ${run.id}`
    }))
    .sort(byId);

  const adoptedEvidence: BlackboardDigestEntry[] = artifacts
    .filter((a) => a.status === "active")
    .map((a) => ({
      id: `evidence:${a.id}`,
      label: `${a.kind} ${a.locator || a.path || a.id}`,
      status: a.status,
      sourceIds: [a.id],
      evidenceRefs: unique([a.locator || a.path || a.id, ...(a.evidenceRefs || [])]),
      expansionCommand: `node scripts/cw.js audit blackboard ${run.id} --json`
    }))
    .sort(byId);

  const missingEvidence: BlackboardDigestEntry[] = (summary.missingEvidence || [])
    .map((reason, index) => ({
      id: `missing:${index}:${slug(reason)}`,
      label: reason,
      status: "missing",
      sourceIds: [],
      evidenceRefs: [],
      expansionCommand: `node scripts/cw.js multi-agent failures ${run.id}`
    }))
    .sort(byId);

  const policyViolations: BlackboardDigestEntry[] = decisions
    .filter((d) => d.outcome === "rejected" || d.outcome === "blocked" || d.outcome === "conflicting")
    .map((d) => ({
      id: `policy:${d.id}`,
      label: `${d.kind}:${d.outcome} ${truncate(d.reason)}`,
      status: d.status,
      sourceIds: [d.id],
      evidenceRefs: unique(d.evidenceRefs || []),
      expansionCommand: `node scripts/cw.js audit policy ${run.id} --json`
    }))
    .sort(byId);

  const judgeRationale: BlackboardDigestEntry[] = messages
    .filter((m) => (m.tags || []).includes("judge-rationale") || Boolean(m.metadata?.judgeRationale))
    .map((m) => ({
      id: `judge:${m.id}`,
      label: `${m.author.kind}:${m.author.id} ${truncate(m.body)}`,
      status: m.status,
      sourceIds: [m.id],
      evidenceRefs: unique(m.linkedEvidenceRefs || []),
      expansionCommand: `node scripts/cw.js audit judge ${run.id} --json`
    }))
    .sort(byId);

  const recentChanges: BlackboardDigestEntry[] = [...messages, ...contexts, ...artifacts, ...decisions]
    .map((record) => ({
      id: record.id,
      kind: (record as { kind?: string }).kind,
      updatedAt: record.updatedAt,
      status: record.status
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, 10)
    .map((record) => ({
      id: `recent:${record.id}`,
      label: `${record.id} (${record.status})`,
      status: record.status,
      sourceIds: [record.id],
      evidenceRefs: [],
      expansionCommand: `node scripts/cw.js node show ${run.id} ${record.id}`
    }))
    .sort(byId);

  const highSignal: BlackboardDigestEntry[] = [
    ...conflicts,
    ...unresolvedQuestions,
    ...policyViolations,
    ...missingEvidence
  ].sort(byId);

  const sourceRecordIds = unique([
    ...topics.map((t) => t.id),
    ...messages.map((m) => m.id),
    ...contexts.map((c) => c.id),
    ...artifacts.map((a) => a.id),
    ...decisions.map((d) => d.id)
  ]);
  const evidenceRefs = unique([
    ...messages.flatMap((m) => m.linkedEvidenceRefs || []),
    ...artifacts.flatMap((a) => [a.locator || a.path || a.id, ...(a.evidenceRefs || [])]),
    ...contexts.flatMap((c) => c.evidenceRefs || [])
  ]);
  const trustAuditEventRefs = unique([
    ...messages.flatMap((m) => m.linkedAuditEventIds || []),
    ...artifacts.flatMap((a) => a.trustAuditEventIds || [])
  ]);
  const fingerprint = fingerprintRecords([...topics, ...messages, ...contexts, ...artifacts, ...decisions]);

  return {
    schemaVersion: STATE_EXPLOSION_SCHEMA_VERSION,
    runId: run.id,
    id: `blackboard-digest${boardId ? `:${boardId}` : ""}`,
    scope: "blackboard",
    blackboardId: boardId,
    sourceRecordIds,
    sourceFingerprint: fingerprint,
    includedCount: topicRollups.length + conflicts.length + unresolvedQuestions.length + decisionEntries.length + artifactEntries.length,
    omittedCount: Math.max(0, messages.length - threadSummaries.length),
    importantRefs: unique([
      ...conflicts.map((c) => c.id),
      ...unresolvedQuestions.map((q) => q.id),
      ...policyViolations.map((p) => p.id)
    ]),
    evidenceRefs,
    trustAuditEventRefs,
    generatedAt: new Date().toISOString(),
    status: "valid",
    deterministic: true,
    nextAction: summary.nextAction || `node scripts/cw.js blackboard summary ${run.id}`,
    topicRollups,
    threadSummaries,
    unresolvedQuestions,
    conflicts,
    decisions: decisionEntries,
    artifacts: artifactEntries,
    adoptedEvidence,
    missingEvidence,
    policyViolations,
    judgeRationale,
    recentChanges,
    highSignal
  };
}

// ---------------------------------------------------------------------------
// Compact graph
// ---------------------------------------------------------------------------

interface CollapseRule {
  // Collapse nodes of these kinds into synthetic summary nodes.
  collapse: boolean;
  // A node is kept (never collapsed) when it matches the protected predicate
  // (failures, blocked, conflicts, critical path) — provenance is never hidden.
  bucketBy: (node: { id: string; kind: string }, parentOf: (id: string) => string | undefined) => string;
}

export function buildCompactGraph(
  run: WorkflowRun,
  view: GraphView = "compact",
  options: { focus?: string; depth?: number; thresholds?: StateExplosionThresholds } = {}
): GraphSummaryRecord {
  const thresholds = options.thresholds || DEFAULT_STATE_EXPLOSION_THRESHOLDS;
  const full = buildMultiAgentOperatorGraph(run);
  const operator = summarizeMultiAgentOperator(run);
  const critical = criticalPathNodeIds(run, operator);
  const protectedIds = new Set<string>(critical);
  // Failures, blocked, rejected, conflicting nodes are always preserved.
  for (const node of full.nodes) {
    if (isProtectedStatus(node.status)) protectedIds.add(node.id);
  }
  for (const failure of operator.failures) {
    if (failure.linked) protectedIds.add(failure.linked);
  }

  const parents = parentMap(full.edges);
  const parentOf = (id: string): string | undefined => parents.get(id);

  let scopeNodes = full.nodes;
  let scopeEdges = full.edges;

  if (view !== "full" && view !== "compact" && view !== "critical-path") {
    const filtered = filterByView(run, view, full, operator, protectedIds);
    scopeNodes = filtered.nodes;
    scopeEdges = filtered.edges;
  }

  // Focus + depth: keep nodes within BFS depth of focus; collapse the rest.
  let focusKeep: Set<string> | undefined;
  if (options.focus) {
    focusKeep = bfsNeighborhood(options.focus, scopeNodes, scopeEdges, options.depth ?? 1);
    for (const id of focusKeep) protectedIds.add(id);
  }

  const collapseEnabled = view === "compact" || view === "critical-path" || Boolean(options.focus);

  if (view === "full" || !collapseEnabled) {
    // No collapse: emit scoped graph verbatim (still records provenance + critical path).
    return finalizeGraphRecord(run, view, options, full, {
      nodes: scopeNodes.map((node) => ({ ...node })),
      edges: scopeEdges.map((edge) => ({ ...edge })),
      syntheticNodes: [],
      critical,
      operator
    });
  }

  // Determine collapse buckets per node.
  const rule = collapseRuleFor(view);
  const keep = new Set<string>();
  const buckets = new Map<string, string[]>();
  for (const node of scopeNodes) {
    if (protectedIds.has(node.id) || (focusKeep && focusKeep.has(node.id))) {
      keep.add(node.id);
      continue;
    }
    if (view === "critical-path") {
      // Collapse everything not on the critical path into one bucket per kind.
      const key = `critical-context:${node.kind}`;
      buckets.set(key, [...(buckets.get(key) || []), node.id]);
      continue;
    }
    if (!shouldCollapseKind(node.kind, rule)) {
      keep.add(node.id);
      continue;
    }
    const key = rule.bucketBy(node, parentOf);
    buckets.set(key, [...(buckets.get(key) || []), node.id]);
  }

  // Buckets smaller than the collapse threshold stay expanded (unless critical-path).
  const synthetic: SyntheticSummaryNode[] = [];
  const collapsedNodeIds = new Map<string, string>(); // sourceNodeId -> syntheticId
  for (const [key, ids] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (view !== "critical-path" && ids.length < thresholds.collapseBucket) {
      for (const id of ids) keep.add(id);
      continue;
    }
    const members = scopeNodes.filter((node) => ids.includes(node.id));
    const internalEdges = scopeEdges.filter((edge) => ids.includes(edge.from) && ids.includes(edge.to));
    const syntheticId = `${run.id}:summary:${slug(key)}`;
    const dominant = dominantStatus(members.map((m) => m.status));
    const blocked = members.find((m) => isProtectedStatus(m.status));
    synthetic.push({
      id: syntheticId,
      kind: "summary",
      label: `${key} (${ids.length} collapsed)`,
      status: dominant,
      collapsedNodeCount: ids.length,
      collapsedEdgeCount: internalEdges.length,
      sourceIds: [...ids].sort(),
      dominantStatus: dominant,
      blockedReason: blocked ? `${blocked.kind} ${blocked.id} is ${blocked.status}` : undefined,
      expansionCommand: expansionCommandFor(run, view, key)
    });
    for (const id of ids) collapsedNodeIds.set(id, syntheticId);
  }

  const redirect = (id: string): string => collapsedNodeIds.get(id) || id;

  const nodes: CompactGraphNode[] = [];
  for (const node of scopeNodes) {
    if (keep.has(node.id)) nodes.push({ ...node });
  }
  for (const syn of synthetic) {
    nodes.push({
      id: syn.id,
      kind: "summary",
      label: syn.label,
      status: syn.status,
      synthetic: syn
    });
  }

  const edgeSeen = new Set<string>();
  const edges: CompactGraphEdge[] = [];
  for (const edge of scopeEdges) {
    const from = redirect(edge.from);
    const to = redirect(edge.to);
    if (from === to) continue; // edge fully internal to a synthetic node
    const key = `${from}\0${to}\0${edge.label || ""}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push({ from, to, label: edge.label });
  }

  return finalizeGraphRecord(run, view, options, full, {
    nodes: nodes.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || (a.label || "").localeCompare(b.label || "")),
    syntheticNodes: synthetic.sort((a, b) => a.id.localeCompare(b.id)),
    critical,
    operator
  });
}

function finalizeGraphRecord(
  run: WorkflowRun,
  view: GraphView,
  options: { focus?: string; depth?: number },
  full: { nodes: Array<{ id: string; status: string }>; edges: unknown[] },
  built: {
    nodes: CompactGraphNode[];
    edges: CompactGraphEdge[];
    syntheticNodes: SyntheticSummaryNode[];
    critical: string[];
    operator: ReturnType<typeof summarizeMultiAgentOperator>;
  }
): GraphSummaryRecord {
  const collapsedNodeCount = built.syntheticNodes.reduce((acc, syn) => acc + syn.collapsedNodeCount, 0);
  const collapsedEdgeCount = built.syntheticNodes.reduce((acc, syn) => acc + syn.collapsedEdgeCount, 0);
  const blockedReasons = unique([
    ...built.operator.failures.map((f: MultiAgentOperatorFailure) => `${f.kind} ${f.id}: ${f.reason}`),
    ...built.syntheticNodes.filter((s) => s.blockedReason).map((s) => s.blockedReason as string)
  ]);
  return {
    schemaVersion: STATE_EXPLOSION_SCHEMA_VERSION,
    runId: run.id,
    id: `graph-${view}${options.focus ? `:focus:${slug(options.focus)}` : ""}`,
    scope: "run",
    view,
    focus: options.focus,
    depth: options.depth,
    fullNodeCount: full.nodes.length,
    fullEdgeCount: full.edges.length,
    compactNodeCount: built.nodes.length,
    compactEdgeCount: built.edges.length,
    collapsedNodeCount,
    collapsedEdgeCount,
    syntheticNodes: built.syntheticNodes,
    criticalPath: built.critical,
    blockedReasons,
    nodes: built.nodes,
    edges: built.edges,
    sourceRecordIds: full.nodes.map((n) => n.id).sort(),
    sourceFingerprint: fingerprintStrings(full.nodes.map((n) => `${n.id}:${n.status}`)),
    includedCount: built.nodes.length,
    omittedCount: collapsedNodeCount,
    importantRefs: built.critical,
    evidenceRefs: [],
    trustAuditEventRefs: [],
    generatedAt: new Date().toISOString(),
    status: "valid",
    deterministic: true,
    nextAction:
      collapsedNodeCount > 0
        ? `node scripts/cw.js multi-agent graph ${run.id} --view full --json`
        : `node scripts/cw.js multi-agent graph ${run.id} --view ${view} --json`
  };
}

function collapseRuleFor(view: GraphView): CollapseRule {
  return {
    collapse: true,
    bucketBy: (node, parentOf) => {
      switch (node.kind) {
        case "blackboard-message":
          return "messages";
        case "blackboard-context":
          return "contexts";
        case "agent-membership": {
          const parent = parentOf(node.id);
          return `memberships:${parent ? parent.split(":").pop() : "unscoped"}`;
        }
        case "worker":
          return "workers";
        case "score":
          return "scores";
        case "blackboard-snapshot":
          return "snapshots";
        default:
          return `${node.kind}`;
      }
    }
  };
}

function shouldCollapseKind(kind: string, _rule: CollapseRule): boolean {
  // Collapsible kinds (high-volume, low-individual-signal). Decisions, artifacts,
  // fanins, candidates, selections, commits and feedback are NEVER collapsed so
  // failures, evidence, policy and judge rationale stay visible.
  return [
    "blackboard-message",
    "blackboard-context",
    "agent-membership",
    "worker",
    "score",
    "blackboard-snapshot",
    "agent-role"
  ].includes(kind);
}

function filterByView(
  run: WorkflowRun,
  view: GraphView,
  full: ReturnType<typeof buildMultiAgentOperatorGraph>,
  operator: ReturnType<typeof summarizeMultiAgentOperator>,
  protectedIds: Set<string>
): { nodes: typeof full.nodes; edges: typeof full.edges } {
  const keepKinds = (kinds: string[]): Set<string> => {
    const ids = new Set<string>();
    for (const node of full.nodes) {
      if (kinds.includes(node.kind) || protectedIds.has(node.id)) ids.add(node.id);
    }
    return ids;
  };
  let ids: Set<string>;
  switch (view) {
    case "failures": {
      ids = new Set<string>();
      for (const failure of operator.failures) {
        if (failure.linked) ids.add(failure.linked);
      }
      for (const node of full.nodes) if (isProtectedStatus(node.status)) ids.add(node.id);
      ids.add(`${run.id}:run`);
      break;
    }
    case "evidence":
      ids = keepKinds([
        "multi-agent-run-root",
        "blackboard",
        "blackboard-topic",
        "blackboard-artifact",
        "blackboard-message",
        "agent-membership",
        "agent-fanin",
        "candidate",
        "selection",
        "commit"
      ]);
      break;
    case "trust":
      ids = keepKinds([
        "multi-agent-run-root",
        "blackboard",
        "coordinator-decision",
        "agent-fanin",
        "candidate",
        "selection",
        "commit"
      ]);
      break;
    case "topology":
      ids = keepKinds([
        "multi-agent-run-root",
        "topology",
        "multi-agent-run",
        "agent-group",
        "agent-role",
        "agent-fanout",
        "agent-fanin"
      ]);
      break;
    case "blackboard":
      ids = keepKinds([
        "multi-agent-run-root",
        "blackboard",
        "blackboard-topic",
        "blackboard-message",
        "blackboard-context",
        "blackboard-artifact",
        "blackboard-snapshot",
        "coordinator-decision"
      ]);
      break;
    case "candidate":
      ids = keepKinds(["multi-agent-run-root", "candidate", "score", "selection", "worker", "agent-fanin"]);
      break;
    case "commit-gate":
      ids = keepKinds(["multi-agent-run-root", "selection", "commit", "candidate", "agent-fanin"]);
      break;
    default:
      ids = new Set(full.nodes.map((n) => n.id));
  }
  const nodes = full.nodes.filter((node) => ids.has(node.id));
  const edges = full.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  return { nodes, edges };
}

function criticalPathNodeIds(run: WorkflowRun, operator: ReturnType<typeof summarizeMultiAgentOperator>): string[] {
  const ids: string[] = [`${run.id}:run`];
  const ma = run.multiAgent;
  for (const record of ma?.runs || []) ids.push(`${run.id}:multi-agent:${record.id}`);
  for (const group of ma?.groups || []) ids.push(`${run.id}:multi-agent:group:${group.id}`);
  for (const fanout of ma?.fanouts || []) ids.push(`${run.id}:multi-agent:fanout:${fanout.id}`);
  for (const fanin of ma?.fanins || []) ids.push(`${run.id}:multi-agent:fanin:${fanin.id}`);
  for (const selection of run.candidateSelections || []) {
    ids.push(`${run.id}:selection:${selection.id}`);
    ids.push(`${run.id}:candidate:${selection.candidateId}`);
  }
  for (const commit of run.commits || []) {
    if (commit.verifierGated) ids.push(commit.stateNodeId || `${run.id}:commit:${commit.id}`);
  }
  // Blocked dependencies live on the critical path because they gate completion.
  for (const failure of operator.failures) {
    if (failure.linked) ids.push(failure.linked);
  }
  return unique(ids);
}

function bfsNeighborhood(
  focus: string,
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string }>,
  depth: number
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }
  const keep = new Set<string>([focus]);
  let frontier = new Set<string>([focus]);
  for (let level = 0; level < Math.max(0, depth); level += 1) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) || []) {
        if (!keep.has(neighbor)) {
          keep.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
  }
  return keep;
}

function expansionCommandFor(run: WorkflowRun, view: GraphView, key: string): string {
  if (key === "messages" || key.startsWith("thread")) return `node scripts/cw.js blackboard message list ${run.id}`;
  if (key.startsWith("memberships")) return `node scripts/cw.js multi-agent graph ${run.id} --view full --json`;
  return `node scripts/cw.js multi-agent graph ${run.id} --view full --focus ${key} --json`;
}

// ---------------------------------------------------------------------------
// Operator digest
// ---------------------------------------------------------------------------

export function buildOperatorDigest(run: WorkflowRun, thresholds = DEFAULT_STATE_EXPLOSION_THRESHOLDS): OperatorDigest {
  const stateSize = computeStateSize(run, thresholds);
  const operator = summarizeMultiAgentOperator(run);
  const compact = buildCompactGraph(run, "compact", { thresholds });
  const blackboard = summarizeBlackboardDigest(run);
  const evidence = operator.evidence;
  const adopted = evidence.filter((e: MultiAgentOperatorEvidence) => e.status === "adopted");
  const missing = evidence.filter((e: MultiAgentOperatorEvidence) => e.status === "missing" || e.status === "pending" || e.status === "conflicting");
  const rejected = evidence.filter((e: MultiAgentOperatorEvidence) => e.status === "rejected");
  const trust = operator.summaries.trust as { totalEvents?: number } | undefined;

  const hiddenSourceRecords = compact.syntheticNodes.map((syn) => ({
    kind: syn.id.split(":summary:")[1] || syn.kind,
    count: syn.collapsedNodeCount,
    expansionCommand: syn.expansionCommand
  }));

  const expansionCommands = unique([
    `node scripts/cw.js multi-agent graph ${run.id} --view full --json`,
    `node scripts/cw.js blackboard message list ${run.id} --topic <topic-id>`,
    `node scripts/cw.js multi-agent graph ${run.id} --view critical-path`,
    `node scripts/cw.js multi-agent failures ${run.id} --json`,
    ...compact.syntheticNodes.map((syn) => syn.expansionCommand)
  ]);

  return {
    schemaVersion: STATE_EXPLOSION_SCHEMA_VERSION,
    runId: run.id,
    id: "operator-digest",
    scope: "run",
    sourceRecordIds: compact.sourceRecordIds,
    sourceFingerprint: fingerprintStrings([
      compact.sourceFingerprint,
      blackboard.sourceFingerprint,
      String(stateSize.total)
    ]),
    includedCount: compact.compactNodeCount,
    omittedCount: compact.collapsedNodeCount,
    importantRefs: compact.criticalPath,
    evidenceRefs: unique(adopted.map((e) => e.ref || e.id)),
    trustAuditEventRefs: [],
    generatedAt: new Date().toISOString(),
    status: "valid",
    deterministic: true,
    nextAction: operator.nextAction,
    stateSize,
    compactGraphRef: compact.id,
    blackboardDigestRef: blackboard.id,
    criticalPath: compact.criticalPath,
    failures: operator.failures.map((f: MultiAgentOperatorFailure) => ({
      id: f.id,
      kind: f.kind,
      status: f.status,
      reason: f.reason,
      nextCommand: f.nextCommand
    })),
    evidenceDigest: {
      adopted: adopted.length,
      missing: missing.length,
      rejected: rejected.length,
      entries: [...adopted, ...missing].slice(0, 40).map((e) => ({
        id: e.id,
        label: `${e.ref || e.id} (${e.status})`,
        status: e.status,
        sourceIds: [e.sourceId || e.id].filter(Boolean) as string[],
        evidenceRefs: [e.ref || e.id].filter(Boolean) as string[],
        expansionCommand: `node scripts/cw.js multi-agent evidence ${run.id} --json`
      }))
    },
    trustDigest: {
      events: trust?.totalEvents || 0,
      policyViolations: blackboard.policyViolations.length,
      judgeRationales: blackboard.judgeRationale.length,
      entries: unique([
        ...blackboard.policyViolations.map((p) => p.id),
        ...blackboard.judgeRationale.map((j) => j.id)
      ])
    },
    hiddenSourceRecords,
    expansionCommands
  };
}

// ---------------------------------------------------------------------------
// State explosion report (combines all derived indexes)
// ---------------------------------------------------------------------------

export function buildStateExplosionReport(
  run: WorkflowRun,
  options: { thresholds?: StateExplosionThresholds; index?: MultiAgentSummaryIndex } = {}
): StateExplosionReport {
  const thresholds = options.thresholds || DEFAULT_STATE_EXPLOSION_THRESHOLDS;
  const stateSize = computeStateSize(run, thresholds);
  const compactGraph = buildCompactGraph(run, "compact", { thresholds });
  const criticalPathGraph = buildCompactGraph(run, "critical-path", { thresholds });
  const blackboardDigest = summarizeBlackboardDigest(run);
  const operatorDigest = buildOperatorDigest(run, thresholds);
  const currentFingerprint = fingerprintStrings([
    compactGraph.sourceFingerprint,
    blackboardDigest.sourceFingerprint,
    operatorDigest.sourceFingerprint,
    String(stateSize.total)
  ]);

  const persisted = options.index;
  const staleScopes: string[] = [];
  let status: SummaryStatus = persisted ? "valid" : "absent";
  if (persisted) {
    if (persisted.sourceFingerprint !== currentFingerprint) status = "stale";
    for (const entry of persisted.entries) {
      const current = currentEntryFingerprint(run, entry, { compactGraph, blackboardDigest, operatorDigest });
      if (current && current !== entry.sourceFingerprint) staleScopes.push(`${entry.scope}:${entry.id}`);
    }
    if (staleScopes.length) status = "stale";
  }

  const nextAction =
    status === "stale" || status === "absent"
      ? `node scripts/cw.js summary refresh ${run.id}`
      : operatorDigest.nextAction;

  return {
    schemaVersion: STATE_EXPLOSION_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: new Date().toISOString(),
    stateSize,
    freshness: {
      status,
      persistedFingerprint: persisted?.sourceFingerprint,
      currentFingerprint,
      staleScopes: staleScopes.sort()
    },
    index: persisted,
    compactGraph,
    criticalPathGraph,
    blackboardDigest,
    operatorDigest,
    hiddenSourceRecords: operatorDigest.hiddenSourceRecords,
    expansionCommands: operatorDigest.expansionCommands,
    nextAction
  };
}

function currentEntryFingerprint(
  run: WorkflowRun,
  entry: MultiAgentSummaryIndexEntry,
  records: { compactGraph: GraphSummaryRecord; blackboardDigest: BlackboardSummaryRecord; operatorDigest: OperatorDigest }
): string | undefined {
  if (entry.scope === "blackboard") return records.blackboardDigest.sourceFingerprint;
  if (entry.id.startsWith("graph-")) {
    if (entry.id === records.compactGraph.id) return records.compactGraph.sourceFingerprint;
    return undefined;
  }
  if (entry.id === "operator-digest") return records.operatorDigest.sourceFingerprint;
  return undefined;
}

// ---------------------------------------------------------------------------
// Persistence + refresh
// ---------------------------------------------------------------------------

export function summariesDir(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "summaries");
}

export function refreshStateExplosionSummaries(
  run: WorkflowRun,
  options: { thresholds?: StateExplosionThresholds; views?: GraphView[] } = {}
): MultiAgentSummaryIndex {
  const thresholds = options.thresholds || DEFAULT_STATE_EXPLOSION_THRESHOLDS;
  const dir = summariesDir(run);
  fs.mkdirSync(dir, { recursive: true });
  const views = options.views || ["full", "compact", "critical-path", "failures", "evidence", "trust", "topology", "blackboard", "candidate", "commit-gate"];

  const blackboardDigest = summarizeBlackboardDigest(run);
  const operatorDigest = buildOperatorDigest(run, thresholds);
  const graphRecords = views.map((view) => buildCompactGraph(run, view, { thresholds }));

  const entries: MultiAgentSummaryIndexEntry[] = [];
  const writeRecord = (id: string, record: unknown, scope: StateExplosionScope, fingerprint: string, included: number, omitted: number) => {
    const file = path.join(dir, `${safeFileName(id)}.json`);
    writeJson(file, record);
    entries.push({ scope, id, path: file, sourceFingerprint: fingerprint, includedCount: included, omittedCount: omitted, status: "valid" });
  };

  writeRecord(blackboardDigest.id, blackboardDigest, "blackboard", blackboardDigest.sourceFingerprint, blackboardDigest.includedCount, blackboardDigest.omittedCount);
  writeRecord(operatorDigest.id, operatorDigest, "run", operatorDigest.sourceFingerprint, operatorDigest.includedCount, operatorDigest.omittedCount);
  for (const record of graphRecords) {
    writeRecord(record.id, record, "run", record.sourceFingerprint, record.compactNodeCount, record.collapsedNodeCount);
  }

  const stateSize = computeStateSize(run, thresholds);
  const indexFingerprint = fingerprintStrings([
    operatorDigest.sourceFingerprint,
    blackboardDigest.sourceFingerprint,
    ...graphRecords.map((r) => r.sourceFingerprint),
    String(stateSize.total)
  ]);
  const reportPath = path.join(dir, "state-explosion-report.json");
  const index: MultiAgentSummaryIndex = {
    schemaVersion: STATE_EXPLOSION_SCHEMA_VERSION,
    runId: run.id,
    id: "multi-agent-summary-index",
    scope: "run",
    sourceRecordIds: unique([...blackboardDigest.sourceRecordIds, ...operatorDigest.sourceRecordIds]),
    sourceFingerprint: fingerprintStrings([
      buildCompactGraph(run, "compact", { thresholds }).sourceFingerprint,
      blackboardDigest.sourceFingerprint,
      operatorDigest.sourceFingerprint,
      String(stateSize.total)
    ]),
    includedCount: entries.reduce((acc, e) => acc + e.includedCount, 0),
    omittedCount: entries.reduce((acc, e) => acc + e.omittedCount, 0),
    importantRefs: operatorDigest.criticalPath,
    evidenceRefs: operatorDigest.evidenceRefs,
    trustAuditEventRefs: blackboardDigest.trustAuditEventRefs,
    generatedAt: new Date().toISOString(),
    status: "valid",
    deterministic: true,
    nextAction: `node scripts/cw.js summary show ${run.id}`,
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    views,
    paths: {
      summariesDir: dir,
      indexPath: path.join(dir, "index.json"),
      reportPath
    }
  };
  void indexFingerprint;
  writeJson(index.paths.indexPath, index);
  const report = buildStateExplosionReport(run, { thresholds, index });
  writeJson(reportPath, report);

  recordTrustAuditEvent(run, {
    kind: "summary.refresh",
    decision: "recorded",
    source: "runtime-derived",
    actor: "cw",
    metadata: {
      deterministic: true,
      scopes: entries.map((e) => `${e.scope}:${e.id}`),
      includedRecords: index.includedCount,
      omittedRecords: index.omittedCount,
      compactionRecommended: stateSize.compactionRecommended,
      sourceFingerprint: index.sourceFingerprint,
      stale: false
    }
  });

  return index;
}

export function loadStateExplosionSummaryIndex(run: WorkflowRun): MultiAgentSummaryIndex | undefined {
  const indexPath = path.join(summariesDir(run), "index.json");
  if (!fs.existsSync(indexPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as MultiAgentSummaryIndex;
    if (!parsed || parsed.id !== "multi-agent-summary-index") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function showStateExplosionSummary(
  run: WorkflowRun,
  options: { thresholds?: StateExplosionThresholds } = {}
): StateExplosionReport {
  const index = loadStateExplosionSummaryIndex(run);
  const report = buildStateExplosionReport(run, { thresholds: options.thresholds, index });
  if (index && report.freshness.status === "stale") {
    recordTrustAuditEvent(run, {
      kind: "summary.stale",
      decision: "failed",
      source: "runtime-derived",
      actor: "cw",
      metadata: {
        persistedFingerprint: report.freshness.persistedFingerprint,
        currentFingerprint: report.freshness.currentFingerprint,
        staleScopes: report.freshness.staleScopes
      }
    });
  }
  return report;
}

// ---------------------------------------------------------------------------
// Human formatting
// ---------------------------------------------------------------------------

export function formatStateExplosionReport(report: StateExplosionReport): string {
  const lines: string[] = [];
  const size = report.stateSize;
  lines.push(`State Explosion Report: ${report.runId}`);
  lines.push(`Freshness: ${report.freshness.status}${report.freshness.staleScopes.length ? ` (stale: ${report.freshness.staleScopes.join(", ")})` : ""}`);
  lines.push("");
  lines.push("State Size");
  lines.push(`  records=${size.total}; graph nodes=${size.graphNodes}; graph edges=${size.graphEdges}; messages=${size.messages}; compaction=${size.compactionRecommended ? "recommended" : "not needed"}`);
  for (const reason of size.reasons) lines.push(`  - ${reason}`);
  lines.push("");
  lines.push("Compact Graph");
  lines.push(`  full=${report.compactGraph.fullNodeCount} nodes/${report.compactGraph.fullEdgeCount} edges -> compact=${report.compactGraph.compactNodeCount} nodes/${report.compactGraph.compactEdgeCount} edges`);
  if (report.compactGraph.collapsedNodeCount > 0) {
    lines.push(`  Graph compacted: ${report.compactGraph.collapsedNodeCount} nodes collapsed into ${report.compactGraph.syntheticNodes.length} summary nodes`);
  }
  for (const syn of report.compactGraph.syntheticNodes) {
    lines.push(`  [${syn.dominantStatus}] ${syn.id} collapses ${syn.collapsedNodeCount} nodes/${syn.collapsedEdgeCount} edges${syn.blockedReason ? ` blocked=${syn.blockedReason}` : ""}; expand: ${syn.expansionCommand}`);
  }
  lines.push("");
  lines.push("Blackboard Digest");
  lines.push(`  topics=${report.blackboardDigest.topicRollups.length}; threads=${report.blackboardDigest.threadSummaries.length}; unresolved=${report.blackboardDigest.unresolvedQuestions.length}; conflicts=${report.blackboardDigest.conflicts.length}; decisions=${report.blackboardDigest.decisions.length}; artifacts=${report.blackboardDigest.artifacts.length}`);
  for (const topic of report.blackboardDigest.topicRollups.slice(0, 20)) lines.push(`  - ${topic.label}; expand: ${topic.expansionCommand}`);
  lines.push("");
  lines.push("Critical Path");
  if (!report.criticalPathGraph.criticalPath.length) lines.push("  none");
  for (const id of report.criticalPathGraph.criticalPath.slice(0, 40)) lines.push(`  -> ${id}`);
  lines.push("");
  lines.push("Failures / Blockers");
  if (!report.operatorDigest.failures.length) lines.push("  none");
  for (const failure of report.operatorDigest.failures.slice(0, 30)) lines.push(`  [${failure.status}] ${failure.kind} ${failure.id}: ${failure.reason}; next=${failure.nextCommand}`);
  lines.push("");
  lines.push("Evidence Digest");
  lines.push(`  adopted=${report.operatorDigest.evidenceDigest.adopted}; missing=${report.operatorDigest.evidenceDigest.missing}; rejected=${report.operatorDigest.evidenceDigest.rejected}`);
  lines.push("");
  lines.push("Trust / Policy Digest");
  lines.push(`  events=${report.operatorDigest.trustDigest.events}; policyViolations=${report.operatorDigest.trustDigest.policyViolations}; judgeRationales=${report.operatorDigest.trustDigest.judgeRationales}`);
  for (const violation of report.blackboardDigest.policyViolations.slice(0, 20)) lines.push(`  [policy] ${violation.label}; expand: ${violation.expansionCommand}`);
  lines.push("");
  lines.push("Hidden Source Records");
  if (!report.hiddenSourceRecords.length) lines.push("  none (all records shown)");
  for (const hidden of report.hiddenSourceRecords) lines.push(`  ${hidden.kind}: ${hidden.count} records hidden; expand: ${hidden.expansionCommand}`);
  lines.push("");
  lines.push("Expansion Commands");
  for (const command of report.expansionCommands) lines.push(`  ${command}`);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${report.nextAction}`);
  return lines.join("\n");
}

export function formatCompactGraph(graph: GraphSummaryRecord): string {
  const lines: string[] = [];
  lines.push(`Compact Graph (${graph.view}): ${graph.runId}`);
  lines.push(`  full=${graph.fullNodeCount} nodes/${graph.fullEdgeCount} edges -> view=${graph.compactNodeCount} nodes/${graph.compactEdgeCount} edges`);
  if (graph.collapsedNodeCount > 0) {
    lines.push(`  Graph compacted: ${graph.collapsedNodeCount} nodes collapsed into ${graph.syntheticNodes.length} summary nodes`);
  }
  lines.push("");
  lines.push("Critical Path");
  if (!graph.criticalPath.length) lines.push("  none");
  for (const id of graph.criticalPath.slice(0, 40)) lines.push(`  -> ${id}`);
  lines.push("");
  lines.push("Summary Nodes");
  if (!graph.syntheticNodes.length) lines.push("  none");
  for (const syn of graph.syntheticNodes) {
    lines.push(`  [${syn.dominantStatus}] ${syn.id}: ${syn.collapsedNodeCount} nodes / ${syn.collapsedEdgeCount} edges${syn.blockedReason ? ` blocked=${syn.blockedReason}` : ""}`);
    lines.push(`    expand: ${syn.expansionCommand}`);
  }
  lines.push("");
  lines.push("Blockers");
  if (!graph.blockedReasons.length) lines.push("  none");
  for (const reason of graph.blockedReasons.slice(0, 20)) lines.push(`  ${reason}`);
  lines.push("");
  lines.push("Nodes");
  for (const node of graph.nodes.slice(0, 80)) {
    lines.push(`  [${node.status}] ${node.kind} ${node.id}${node.synthetic ? ` (summary of ${node.synthetic.collapsedNodeCount})` : ""}`);
  }
  if (graph.nodes.length > 80) lines.push(`  ... ${graph.nodes.length - 80} more`);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${graph.nextAction}`);
  return lines.join("\n");
}

export function formatBlackboardDigest(record: BlackboardSummaryRecord): string {
  const lines: string[] = [];
  lines.push(`Blackboard Digest: ${record.runId}${record.blackboardId ? ` (${record.blackboardId})` : ""}`);
  lines.push(`  freshness=${record.status}; included=${record.includedCount}; omitted=${record.omittedCount}`);
  const section = (title: string, entries: BlackboardDigestEntry[]) => {
    lines.push("");
    lines.push(title);
    if (!entries.length) {
      lines.push("  none");
      return;
    }
    for (const entry of entries.slice(0, 25)) lines.push(`  [${entry.status}] ${entry.label}; expand: ${entry.expansionCommand}`);
    if (entries.length > 25) lines.push(`  ... ${entries.length - 25} more`);
  };
  section("Topic Rollups", record.topicRollups);
  section("Thread Summaries", record.threadSummaries);
  section("Unresolved Questions", record.unresolvedQuestions);
  section("Conflicts", record.conflicts);
  section("Decisions", record.decisions);
  section("Artifacts", record.artifacts);
  section("Adopted Evidence", record.adoptedEvidence);
  section("Missing Evidence", record.missingEvidence);
  section("Policy Violations", record.policyViolations);
  section("Judge Rationale", record.judgeRationale);
  section("Recent Changes", record.recentChanges);
  section("High-Signal Records", record.highSignal);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${record.nextAction}`);
  return lines.join("\n");
}

export function stateExplosionReportLines(report: StateExplosionReport): string[] {
  // Markdown lines for inclusion in the run report.md State Size section.
  const size = report.stateSize;
  const lines = [
    `- Records: ${size.total}; graph nodes: ${size.graphNodes}; graph edges: ${size.graphEdges}; messages: ${size.messages}`,
    `- Compaction: ${size.compactionRecommended ? "recommended" : "not needed"}`,
    `- Summary freshness: ${report.freshness.status}`
  ];
  for (const reason of size.reasons) lines.push(`  - ${reason}`);
  if (report.compactGraph.collapsedNodeCount > 0) {
    lines.push(`- Graph compacted: ${report.compactGraph.collapsedNodeCount} nodes collapsed into ${report.compactGraph.syntheticNodes.length} summary nodes`);
    lines.push(`  - Use: \`node scripts/cw.js multi-agent graph ${report.runId} --view full --json\``);
  }
  if (report.hiddenSourceRecords.length) {
    for (const hidden of report.hiddenSourceRecords) {
      lines.push(`- Hidden ${hidden.kind}: ${hidden.count} records; expand: \`${hidden.expansionCommand}\``);
    }
  }
  lines.push(`- Next: \`${report.nextAction}\``);
  return lines;
}

// ---------------------------------------------------------------------------
// Eval normalization (deterministic, timestamp/path-free)
// ---------------------------------------------------------------------------

export interface StateExplosionEvalSections {
  summaryFreshness: string[];
  compactGraphShape: string[];
  blackboardDigest: string[];
  criticalPath: string[];
  evidenceDigest: string[];
  expansionRefs: string[];
}

export function normalizeStateExplosionForEval(run: WorkflowRun): StateExplosionEvalSections {
  const report = buildStateExplosionReport(run);
  const graph = report.compactGraph;
  return {
    summaryFreshness: [
      stableLine({
        compactionRecommended: report.stateSize.compactionRecommended,
        total: report.stateSize.total,
        deterministic: graph.deterministic
      })
    ],
    compactGraphShape: [
      stableLine({
        view: graph.view,
        fullNodeCount: graph.fullNodeCount,
        fullEdgeCount: graph.fullEdgeCount,
        compactNodeCount: graph.compactNodeCount,
        compactEdgeCount: graph.compactEdgeCount,
        collapsedNodeCount: graph.collapsedNodeCount,
        syntheticNodes: graph.syntheticNodes.map((s) => ({
          kind: s.id.split(":summary:")[1] || s.kind,
          collapsedNodeCount: s.collapsedNodeCount,
          collapsedEdgeCount: s.collapsedEdgeCount,
          dominantStatus: s.dominantStatus
        }))
      })
    ],
    blackboardDigest: [
      stableLine({
        topics: report.blackboardDigest.topicRollups.length,
        threads: report.blackboardDigest.threadSummaries.length,
        unresolved: report.blackboardDigest.unresolvedQuestions.map((q) => q.id),
        conflicts: report.blackboardDigest.conflicts.map((c) => c.id),
        decisions: report.blackboardDigest.decisions.length,
        artifacts: report.blackboardDigest.artifacts.length,
        policyViolations: report.blackboardDigest.policyViolations.map((p) => p.id),
        judgeRationale: report.blackboardDigest.judgeRationale.map((j) => j.id),
        missingEvidence: report.blackboardDigest.missingEvidence.map((m) => m.label)
      })
    ],
    criticalPath: graph.criticalPath.map((id) => stripRunId(run, id)).sort(),
    evidenceDigest: [
      stableLine({
        adopted: report.operatorDigest.evidenceDigest.adopted,
        missing: report.operatorDigest.evidenceDigest.missing,
        rejected: report.operatorDigest.evidenceDigest.rejected
      })
    ],
    expansionRefs: report.hiddenSourceRecords.map((h) => `${h.kind}=${h.count}`).sort()
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isProtectedStatus(status: string): boolean {
  return ["failed", "blocked", "rejected", "conflicting"].includes(status);
}

function dominantStatus(statuses: string[]): string {
  for (const priority of ["failed", "blocked", "rejected", "conflicting", "running", "pending"]) {
    if (statuses.includes(priority)) return priority;
  }
  return statuses[0] || "completed";
}

function parentMap(edges: Array<{ from: string; to: string }>): Map<string, string> {
  const parents = new Map<string, string>();
  for (const edge of edges) {
    if (!parents.has(edge.to)) parents.set(edge.to, edge.from);
  }
  return parents;
}

function fingerprintRecords(records: Array<{ id: string; status?: string; updatedAt?: string }>): string {
  return fingerprintStrings(records.map((r) => `${r.id}:${r.status || ""}`).sort());
}

function fingerprintStrings(values: string[]): string {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify([...values].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

function stableLine(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) result[key] = sortKeys(record[key]);
    return result;
  }
  return value;
}

function stripRunId(run: WorkflowRun, id: string): string {
  return id.startsWith(`${run.id}:`) ? id.slice(run.id.length + 1) : id;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

function truncate(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > 80 ? `${single.slice(0, 77)}...` : single;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "-");
}
