// shell/topology-io.ts — applyTopology's IO wiring: materializes the
// blackboard + multi-agent state a topology needs, then persists the
// topology-run record.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// src/topology.ts's applyTopology + summarizeTopologies/buildTopologyGraph/
// showTopologyRun/persistTopologyState.
//
// Evidence: SPEC/multi-agent.md section B; plugins/cool-workflow/src/
// topology.ts:139-455 (byte-exact source for the wiring sequence).

import * as fs from "node:fs";
import * as path from "node:path";
import { writeJson } from "./fs-atomic";
import { WorkflowRun } from "../core/state/types";
import { appendRunNode } from "./node-store";
import { createStateNode } from "../core/state/state-node";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "../core/pipeline/contract";
import { recordTrustAuditEvent } from "./trust-audit";
import { sha256 } from "../core/hash";
import { stableStringify } from "../core/hash";
import * as topo from "../core/multi-agent/topology";
import { createAgentFanout, createAgentGroup, createAgentRole, createMultiAgentRun, collectAgentFanin } from "./multi-agent-io";
import { createBlackboardTopic, postBlackboardMessage, recordCoordinatorDecision, resolveBlackboard } from "./coordinator-io";
import { AgentFanin } from "../core/multi-agent/runtime";
import { stableCompare } from "../core/util/collate";

export interface TopologyState {
  schemaVersion: 1;
  runs: MultiAgentTopologyRun[];
}

export interface MultiAgentTopologyRunLinks {
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
}

export interface MultiAgentTopologyRun {
  schemaVersion: 1;
  id: string;
  runId: string;
  topologyId: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "blocked" | "running" | "completed" | "failed";
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
  links: MultiAgentTopologyRunLinks;
  metadata?: Record<string, unknown>;
}

function topologyRoot(run: WorkflowRun): string {
  return run.paths.topologiesDir || path.join(run.paths.runDir, "topologies");
}
function topologyRunPath(run: WorkflowRun, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
  return path.join(topologyRoot(run), "runs", `${safe}.json`);
}

export function ensureTopologyState(run: WorkflowRun): TopologyState {
  run.paths.topologiesDir = topologyRoot(run);
  fs.mkdirSync(run.paths.topologiesDir, { recursive: true });
  fs.mkdirSync(path.join(run.paths.topologiesDir, "runs"), { recursive: true });
  const existing = run.topologies as unknown as TopologyState | undefined;
  const state: TopologyState = existing || { schemaVersion: topo.TOPOLOGY_SCHEMA_VERSION, runs: [] };
  state.schemaVersion = topo.TOPOLOGY_SCHEMA_VERSION;
  state.runs = state.runs || [];
  run.topologies = state as unknown as WorkflowRun["topologies"];
  return state;
}

export function persistTopologyState(run: WorkflowRun): void {
  const state = ensureTopologyState(run);
  writeJson(path.join(topologyRoot(run), "index.json"), {
    schemaVersion: topo.TOPOLOGY_SCHEMA_VERSION,
    runId: run.id,
    counts: { runs: state.runs.length },
    runs: state.runs.map((record) => ({ id: record.id, topologyId: record.topologyId, status: record.status, updatedAt: record.updatedAt })),
  });
  for (const record of state.runs) writeJson(topologyRunPath(run, record.id), record);
}

function now(): string {
  return new Date().toISOString();
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function appendTopologyNode(run: WorkflowRun, record: MultiAgentTopologyRun, status: "pending" | "running" | "completed" | "blocked" | "failed"): void {
  appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:topology:${record.id}`,
      kind: "topology-run",
      status,
      loopStage: run.loopStage,
      outputs: { topologyId: record.topologyId, status: record.status },
      artifacts: [{ id: "topology-run", kind: "json", path: topologyRunPath(run, record.id) }],
      parents: [`${run.id}:multi-agent:${record.multiAgentRunId}`, `${run.id}:blackboard:${record.blackboardId}`],
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: { topologyId: record.topologyId, topologyRunId: record.id },
    })
  );
}

export function applyTopology(run: WorkflowRun, topologyId: string, input: topo.ApplyTopologyInput = {}): MultiAgentTopologyRun {
  const validation = topo.validateTopologyDefinition(topologyId);
  if (!validation.valid || !validation.definition) {
    throw new Error(`Invalid topology ${topologyId}: ${validation.issues.map((entry) => entry.message).join("; ")}`);
  }
  const definition = validation.definition;
  const state = ensureTopologyState(run);
  const taskIds = topo.selectedTaskIds(run.tasks, input.taskIds);
  const id = input.id || topo.topologyRunId(definition, taskIds, run.id, state.runs.length, (value) => sha256(stableStringify(value)));
  if (state.runs.some((record) => record.id === id)) throw new Error(`Duplicate MultiAgentTopologyRun id: ${id}`);

  const board = resolveBlackboard(run, { id: input.blackboardId || `${id}-blackboard`, title: `${definition.title} Blackboard`, tags: ["topology", definition.id] });
  const topics = definition.blackboardTopics.map((topic) => createBlackboardTopic(run, { id: `${id}-${topic.id}`, title: topic.title, description: topic.description, blackboardId: board.id, tags: ["topology", definition.id] }));
  const multiAgentRun = createMultiAgentRun(run, {
    id: input.multiAgentRunId || `${id}-ma`,
    title: input.title || definition.title,
    objective: definition.summary,
    blackboardId: board.id,
    topicIds: topics.map((topic) => topic.id),
    metadata: { topologyId: definition.id, topologyRunId: id },
  });

  const roleIds: string[] = [];
  for (const role of topo.materializedRoles(definition, topo.withLegacyRoleCounts(input))) {
    const record = createAgentRole(run, {
      id: `${id}-${role.id}`,
      multiAgentRunId: multiAgentRun.id,
      title: role.title,
      responsibilities: role.responsibilities,
      requiredEvidence: role.requiredEvidence,
      expectedArtifacts: role.expectedArtifacts,
      faninObligations: role.faninObligations,
      blackboardId: board.id,
      topicIds: topics.map((topic) => topic.id),
      metadata: { topologyId: definition.id, topologyRunId: id, topologyRoleId: role.id },
    });
    roleIds.push(record.id);
  }

  const group = createAgentGroup(run, { id: `${id}-group`, multiAgentRunId: multiAgentRun.id, title: `${definition.title} Group`, phase: definition.title, taskIds, blackboardId: board.id, topicIds: topics.map((topic) => topic.id), metadata: { topologyId: definition.id, topologyRunId: id } });

  const fanoutRoles = topo.fanoutRoleIds(roleIds);
  const fanout = createAgentFanout(run, {
    id: `${id}-fanout`,
    multiAgentRunId: multiAgentRun.id,
    groupId: group.id,
    reason: `${definition.id} topology fanout`,
    roleIds: fanoutRoles,
    taskIds,
    concurrencyLimit: fanoutRoles.length,
    expectedReturnShape: `${definition.title} worker output must include cw:result evidence and blackboard-indexable artifacts/messages.`,
    blackboardId: board.id,
    topicIds: topics.map((topic) => topic.id),
    metadata: { topologyId: definition.id, topologyRunId: id, fanoutStrategy: definition.fanoutStrategy },
  });

  const message = postBlackboardMessage(run, { topicId: topics[0].id, blackboardId: board.id, body: `${definition.title} topology applied. Roles=${roleIds.join(", ")} fanout=${fanout.id}.`, tags: ["topology", definition.id], metadata: { topologyRunId: id } });

  const decision = recordCoordinatorDecision(run, {
    blackboardId: board.id,
    topicId: topics[0].id,
    kind: "context-update",
    outcome: "accepted",
    reason: `${definition.title} topology materialized on multi-agent runtime and blackboard.`,
    subjectIds: [multiAgentRun.id, group.id, fanout.id],
    messageIds: [message.id],
    tags: ["topology", definition.id],
    metadata: { topologyRunId: id },
  });

  let fanin: AgentFanin | undefined;
  if (input.collectInitialFanin) {
    fanin = collectAgentFanin(run, { id: `${id}-fanin-initial`, multiAgentRunId: multiAgentRun.id, groupId: group.id, fanoutId: fanout.id, requiredRoleIds: fanout.roleIds, strategy: definition.faninStrategy, blackboardId: board.id, topicIds: topics.map((topic) => topic.id), metadata: { topologyId: definition.id, topologyRunId: id } });
  }

  const audit = recordTrustAuditEvent(run, {
    kind: "topology.create",
    decision: "recorded",
    source: "runtime-derived",
    topologyId: definition.id,
    topologyRunId: id,
    multiAgentRunId: multiAgentRun.id,
    agentGroupId: group.id,
    agentFanoutId: fanout.id,
    blackboardId: board.id,
    blackboardMessageId: message.id,
    coordinatorDecisionId: decision.id,
    metadata: { fanoutStrategy: definition.fanoutStrategy, faninStrategy: definition.faninStrategy },
  });

  const stamp = now();
  const record: MultiAgentTopologyRun = {
    schemaVersion: topo.TOPOLOGY_SCHEMA_VERSION,
    id,
    runId: run.id,
    topologyId: definition.id,
    createdAt: stamp,
    updatedAt: stamp,
    status: fanin?.status === "blocked" ? "blocked" : "planned",
    title: input.title || definition.title,
    multiAgentRunId: multiAgentRun.id,
    blackboardId: board.id,
    topicIds: topics.map((topic) => topic.id),
    roleIds,
    groupIds: [group.id],
    fanoutIds: [fanout.id],
    faninIds: fanin ? [fanin.id] : [],
    messageIds: [message.id],
    artifactRefIds: [],
    coordinatorDecisionIds: [decision.id],
    candidateIds: [],
    selectionIds: [],
    commitIds: [],
    missingEvidence: fanin?.blockedReasons || definition.requiredEvidence,
    conflicts: [],
    nextActions: topo.nextActionsFor(run.id, id, fanout.id),
    links: {
      workflowRunId: run.id,
      multiAgentRunId: multiAgentRun.id,
      blackboardId: board.id,
      blackboardTopicIds: topics.map((topic) => topic.id),
      agentRoleIds: roleIds,
      agentGroupIds: [group.id],
      agentFanoutIds: [fanout.id],
      agentFaninIds: fanin ? [fanin.id] : [],
      coordinatorDecisionIds: [decision.id],
      candidateIds: [],
      selectionIds: [],
      commitIds: [],
      auditEventIds: [audit.id],
    },
    metadata: compact({ ...(input.metadata || {}), topology: definition as unknown as Record<string, unknown> }),
  };
  state.runs.push(record);
  appendTopologyNode(run, record, topo.statusToNodeStatus(record.status));
  recordTrustAuditEvent(run, {
    kind: "topology.verdict",
    decision: record.status === "blocked" ? "failed" : "recorded",
    source: "cw-validated",
    topologyId: definition.id,
    topologyRunId: id,
    multiAgentRunId: multiAgentRun.id,
    agentFanoutId: fanout.id,
    agentFaninId: fanin?.id,
    blackboardId: board.id,
    coordinatorDecisionId: decision.id,
    metadata: { status: record.status, missingEvidence: record.missingEvidence },
  });
  persistTopologyState(run);
  return record;
}

export function showTopologyRun(run: WorkflowRun, topologyRunId: string): MultiAgentTopologyRun {
  const record = ensureTopologyState(run).runs.find((entry) => entry.id === topologyRunId);
  if (!record) throw new Error(`Unknown topology run id: ${topologyRunId}`);
  return record;
}

function countBy<T>(items: T[], pick: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[pick(item)] = (counts[pick(item)] || 0) + 1;
  return counts;
}

export interface TopologyActiveSummary {
  id: string;
  topologyId: string;
  status: string;
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
}

export interface TopologySummary {
  runId: string;
  totalRuns: number;
  runsByStatus: Record<string, number>;
  officialTopologies: string[];
  active: TopologyActiveSummary[];
  nextAction: string;
}

export function summarizeTopologies(run: WorkflowRun): TopologySummary {
  const state = ensureTopologyState(run);
  const multi = (run.multiAgent as unknown as { fanins?: AgentFanin[] } | undefined) || {};
  const fanins = multi.fanins || [];
  const active: TopologyActiveSummary[] = state.runs.map((record) => {
    // `fanins` (multi.fanins) grows with total fan-in activity across the
    // whole run, re-scanned here once per topology record -- Sets built
    // from each record's own small groupIds/fanoutIds replace an
    // O(fanins) `.includes()` scan per fanin with an O(1) lookup (the
    // same array-scan-per-item shape 024b007 fixed for phase/task
    // selection).
    const groupIdSet = new Set(record.groupIds);
    const fanoutIdSet = new Set(record.fanoutIds);
    const inferredFanins = fanins.filter((fanin) => groupIdSet.has(fanin.groupId) || fanoutIdSet.has(fanin.fanoutId || ""));
    const allFaninIds = topo.unique([...record.faninIds, ...inferredFanins.map((fanin) => fanin.id)]);
    const blocked = inferredFanins.filter((fanin) => fanin.status === "blocked" || !fanin.verifierReady);
    const ready = inferredFanins.some((fanin) => fanin.verifierReady);
    const missingEvidence = topo.unique([...record.missingEvidence, ...blocked.flatMap((fanin) => fanin.blockedReasons)]);
    return {
      id: record.id,
      topologyId: record.topologyId,
      status: ready ? "ready" : blocked.length ? "blocked" : record.status,
      multiAgentRunId: record.multiAgentRunId,
      blackboardId: record.blackboardId,
      roles: record.roleIds,
      groups: record.groupIds,
      topics: record.topicIds,
      fanouts: record.fanoutIds,
      fanins: allFaninIds,
      missingEvidence,
      conflicts: record.conflicts,
      readiness: ready ? "fanin ready" : missingEvidence.length ? "missing evidence" : "awaiting worker output",
      nextActions: ready ? [`node scripts/cw.js candidate register ${run.id} --result-node <reducer-or-panel-result>`] : record.nextActions,
    };
  });
  return {
    runId: run.id,
    totalRuns: state.runs.length,
    runsByStatus: countBy(active, (record) => record.status),
    officialTopologies: topo.listTopologyDefinitions().map((definition) => definition.id),
    active,
    nextAction: active.find((record) => record.nextActions.length)?.nextActions[0] || `node scripts/cw.js topology apply ${run.id} map-reduce --task <task-id>`,
  };
}

export function buildTopologyGraph(run: WorkflowRun): topo.TopologyGraph {
  const state = ensureTopologyState(run);
  return topo.buildTopologyGraphFromRuns(run.id, state.runs, (id) => topologyRunPath(run, id));
}

function formatTopologyCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => stableCompare(a, b));
  if (!entries.length) return "none";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

/** `cw topology summary <run>` human text — port of the old build's
 *  formatTopologyPanel (operator-ux/format.ts): a `Topologies` rollup with
 *  per-run roles/topics/fanout/fanin/readiness. */
export function formatTopologySummaryText(summary: TopologySummary): string {
  const lines = [
    "Topologies",
    `  runs=${summary.totalRuns}; status=${formatTopologyCounts(summary.runsByStatus)}; official=${summary.officialTopologies.join(", ")}`,
  ];
  for (const record of summary.active.slice(0, 6)) {
    lines.push(`  ${record.id}: ${record.topologyId}, status=${record.status}, readiness=${record.readiness}`);
    lines.push(`    run=${record.multiAgentRunId} board=${record.blackboardId}`);
    lines.push(`    roles=${record.roles.join(", ") || "none"} topics=${record.topics.join(", ") || "none"}`);
    lines.push(`    fanout=${record.fanouts.join(", ") || "none"} fanin=${record.fanins.join(", ") || "none"}`);
    for (const missing of record.missingEvidence.slice(0, 4)) lines.push(`    missing=${missing}`);
    for (const conflict of record.conflicts.slice(0, 4)) lines.push(`    conflict=${conflict}`);
    if (record.nextActions[0]) lines.push(`    next=${record.nextActions[0]}`);
  }
  if (summary.nextAction) lines.push(`  next=${summary.nextAction}`);
  return lines.join("\n");
}

/** `cw topology graph <run>` human text — the same `Run Graph:` render
 *  `cw graph` uses, over the topology graph's nodes/edges (old build:
 *  formatOperatorGraph({ runId, nodes, edges })). */
export function formatTopologyGraphText(runId: string, graph: topo.TopologyGraph): string {
  const lines = [`Run Graph: ${runId}`, "", "Nodes"];
  const groups: Record<string, topo.TopologyGraph["nodes"]> = {};
  for (const node of graph.nodes) (groups[node.kind] ||= []).push(node);
  for (const kind of Object.keys(groups).sort()) {
    lines.push(`  ${kind}`);
    for (const node of groups[kind]) {
      const suffix = node.path ? ` -> ${node.path}` : "";
      lines.push(`    [${node.status}] ${node.id} (${node.label})${suffix}`);
    }
  }
  lines.push("", "Edges");
  if (!graph.edges.length) lines.push("  none");
  for (const edge of graph.edges) {
    lines.push(`  ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`);
  }
  return lines.join("\n");
}
