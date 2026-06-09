import fs from "node:fs";
import path from "node:path";
import {
  MultiAgentTopologyDefinition,
  MultiAgentTopologyId,
  MultiAgentTopologyRun,
  StateNodeStatus,
  TopologyState,
  TopologySummary,
  TopologyValidationResult,
  WorkflowRun
} from "./types";
import { safeFileName, writeJson } from "./state";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { appendRunNode, createStateNode } from "./state-node";
import { recordTrustAuditEvent } from "./trust-audit";
import {
  collectAgentFanin,
  createAgentFanout,
  createAgentGroup,
  createAgentRole,
  createMultiAgentRun,
  ensureMultiAgentState
} from "./multi-agent";
import {
  createBlackboardTopic,
  postBlackboardMessage,
  recordCoordinatorDecision,
  resolveBlackboard
} from "./coordinator";

export const TOPOLOGY_SCHEMA_VERSION = 1;

export interface ApplyTopologyInput {
  id?: string;
  title?: string;
  multiAgentRunId?: string;
  blackboardId?: string;
  taskIds?: string[];
  mapperCount?: number;
  judgeCount?: number;
  debateRounds?: number;
  collectInitialFanin?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TopologyGraph {
  nodes: Array<{ id: string; kind: string; status: string; label: string; path?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export const OFFICIAL_TOPOLOGIES: MultiAgentTopologyDefinition[] = [
  {
    schemaVersion: 1,
    id: "map-reduce",
    title: "Map-Reduce",
    summary: "Fan out mapper roles, index mapper evidence on the blackboard, then reduce only after required evidence is present.",
    roles: [
      roleSpec("mapper", "Mapper", ["Produce an independent shard result and cite evidence."], ["mapper output artifact"], ["indexed mapper artifact"]),
      roleSpec("reducer", "Reducer", ["Synthesize mapper outputs only after fanin is verifier-ready."], ["reducer synthesis"], ["all mapper evidence"])
    ],
    groups: [{ id: "map-reduce", title: "Map-Reduce Group", roleIds: ["mapper", "reducer"] }],
    blackboardTopics: [
      topicSpec("mapper-outputs", "Mapper Outputs", "Indexed mapper result artifacts and evidence."),
      topicSpec("reducer-synthesis", "Reducer Synthesis", "Reducer fanin readiness and synthesis provenance.")
    ],
    phases: [
      phaseSpec("map", "Map", ["mapper"], true, false, ["mapper output artifact"], ["artifact-index"]),
      phaseSpec("reduce", "Reduce", ["reducer"], false, true, ["all mapper evidence"], ["fanin-readiness", "candidate-synthesis"])
    ],
    fanoutStrategy: "one membership per mapper role over selected run tasks",
    faninStrategy: "required mapper roles must report result evidence and indexed blackboard artifacts",
    requiredEvidence: ["mapper output artifact", "blackboard artifact ref", "reducer synthesis"],
    coordinatorDecisions: ["artifact-index", "fanin-readiness", "candidate-synthesis"],
    candidateExpectations: ["Reducer result becomes a candidate only with mapper provenance."],
    verifierGates: ["Reducer fanin must be ready before completion or commit."]
  },
  {
    schemaVersion: 1,
    id: "debate",
    title: "Debate",
    summary: "Record opposing claims, rebuttal rounds, conflict context, coordinator decisions, and final synthesis on shared topics.",
    roles: [
      roleSpec("position-a", "Position A", ["Argue one supported position with evidence."], ["claim message"], ["round messages"]),
      roleSpec("position-b", "Position B", ["Argue a contrasting position with evidence."], ["counterclaim message"], ["round messages"]),
      roleSpec("synthesizer", "Synthesis", ["Resolve or preserve conflicts with citations."], ["debate synthesis"], ["coordinator decisions"])
    ],
    groups: [{ id: "debate", title: "Debate Group", roleIds: ["position-a", "position-b", "synthesizer"] }],
    blackboardTopics: [
      topicSpec("debate-rounds", "Debate Rounds", "Claim and rebuttal messages by round."),
      topicSpec("debate-conflicts", "Conflict Context", "Conflicting or unresolved claims."),
      topicSpec("debate-synthesis", "Final Synthesis", "Accepted, rejected, conflicting, and unresolved claims.")
    ],
    phases: [
      phaseSpec("opening", "Opening Claims", ["position-a", "position-b"], true, false, ["claim evidence"], ["message-moderation"]),
      phaseSpec("rebuttal", "Rebuttal Rounds", ["position-a", "position-b"], true, false, ["response evidence"], ["conflict-resolution"]),
      phaseSpec("synthesis", "Synthesis", ["synthesizer"], false, true, ["debate messages", "coordinator decisions"], ["candidate-synthesis"])
    ],
    fanoutStrategy: "opposing roles write blackboard messages for each round",
    faninStrategy: "synthesis requires debate messages and coordinator claim decisions",
    requiredEvidence: ["debate message", "conflict context", "coordinator decision", "final synthesis"],
    coordinatorDecisions: ["message-moderation", "conflict-resolution", "candidate-synthesis"],
    candidateExpectations: ["Final synthesis cites debate messages and decisions."],
    verifierGates: ["Required debate rounds and synthesis evidence must be present."]
  },
  {
    schemaVersion: 1,
    id: "judge-panel",
    title: "Judge Panel",
    summary: "Collect independent judge outputs, aggregate scores, and select a panel decision with linked evidence.",
    roles: [
      roleSpec("judge", "Judge", ["Score candidates independently and cite evidence."], ["judge score artifact"], ["judge verdict"]),
      roleSpec("panel-chair", "Panel Chair", ["Aggregate scores and write a panel decision."], ["panel decision"], ["judge evidence"])
    ],
    groups: [{ id: "judge-panel", title: "Judge Panel Group", roleIds: ["judge", "panel-chair"] }],
    blackboardTopics: [
      topicSpec("judge-verdicts", "Judge Verdicts", "Independent judge outputs and score evidence."),
      topicSpec("panel-decision", "Panel Decision", "Aggregated verdict and candidate selection rationale.")
    ],
    phases: [
      phaseSpec("judge", "Judge", ["judge"], true, false, ["judge score artifact"], ["artifact-index"]),
      phaseSpec("panel", "Panel", ["panel-chair"], false, true, ["judge evidence", "score records"], ["candidate-synthesis"])
    ],
    fanoutStrategy: "one membership per independent judge role",
    faninStrategy: "panel decision requires fanin over judge evidence and score records",
    requiredEvidence: ["judge output", "score record", "panel decision", "candidate selection rationale"],
    coordinatorDecisions: ["artifact-index", "candidate-synthesis"],
    candidateExpectations: ["No single judge is authoritative without aggregated fanin and score evidence."],
    verifierGates: ["Panel decision requires multiple judge outputs unless explicitly configured otherwise."]
  }
];

export function ensureTopologyState(run: WorkflowRun): TopologyState {
  run.paths.topologiesDir = topologyRoot(run);
  fs.mkdirSync(run.paths.topologiesDir, { recursive: true });
  fs.mkdirSync(path.join(run.paths.topologiesDir, "runs"), { recursive: true });
  if (!run.topologies) run.topologies = { schemaVersion: TOPOLOGY_SCHEMA_VERSION, runs: [] };
  run.topologies.schemaVersion = TOPOLOGY_SCHEMA_VERSION;
  run.topologies.runs = run.topologies.runs || [];
  return run.topologies;
}

export function persistTopologyState(run: WorkflowRun): void {
  const state = ensureTopologyState(run);
  writeJson(path.join(topologyRoot(run), "index.json"), {
    schemaVersion: TOPOLOGY_SCHEMA_VERSION,
    runId: run.id,
    counts: { runs: state.runs.length },
    runs: state.runs.map((record) => ({
      id: record.id,
      topologyId: record.topologyId,
      status: record.status,
      updatedAt: record.updatedAt
    }))
  });
  for (const record of state.runs) writeJson(topologyRunPath(run, record.id), record);
}

// ---- Topology registry (v0.1.53) — MECHANISM, not policy ------------------
// SEPARATE MECHANISM FROM POLICY. The Map is mechanism; OFFICIAL_TOPOLOGIES and
// any registerTopology() calls are policy. listTopologyDefinitions() composes
// them — consumers see one merged set, never two.
const _topologyRegistry = new Map<string, MultiAgentTopologyDefinition>();

/** Register a topology definition. Later registrations with the same id
 *  overwrite earlier ones (last-write-wins dedup). */
export function registerTopology(definition: MultiAgentTopologyDefinition): void {
  _topologyRegistry.set(definition.id, clone(definition));
}

export function listTopologyDefinitions(): MultiAgentTopologyDefinition[] {
  const merged = OFFICIAL_TOPOLOGIES.map((definition) => clone(definition));
  for (const registered of _topologyRegistry.values()) {
    const idx = merged.findIndex((d) => d.id === registered.id);
    if (idx >= 0) merged[idx] = clone(registered);
    else merged.push(clone(registered));
  }
  return merged;
}

export function getTopologyDefinition(topologyId: string): MultiAgentTopologyDefinition | undefined {
  const registered = _topologyRegistry.get(topologyId);
  if (registered) return clone(registered);
  return OFFICIAL_TOPOLOGIES.find((definition) => definition.id === topologyId);
}

export function validateTopologyDefinition(topologyId: string): TopologyValidationResult {
  const definition = getTopologyDefinition(topologyId);
  if (!definition) return { valid: false, topologyId, issues: [{ code: "unknown-topology", message: `Unknown topology id: ${topologyId}` }] };
  const issues: TopologyValidationResult["issues"] = [];
  if (!definition.roles.length) issues.push(issue("missing-roles", "Topology must declare at least one role.", "roles"));
  if (!definition.groups.length) issues.push(issue("missing-groups", "Topology must declare at least one group.", "groups"));
  if (!definition.blackboardTopics.length) issues.push(issue("missing-topics", "Topology must declare blackboard topics.", "blackboardTopics"));
  if (!definition.requiredEvidence.length) issues.push(issue("missing-evidence", "Topology must declare required evidence.", "requiredEvidence"));
  const roleIds = new Set(definition.roles.map((role) => role.id));
  for (const phase of definition.phases) {
    for (const roleId of phase.roleIds) {
      if (!roleIds.has(roleId)) issues.push(issue("unknown-phase-role", `Phase ${phase.id} references unknown role ${roleId}.`, `phases.${phase.id}`));
    }
  }
  return { valid: issues.length === 0, topologyId, issues, definition };
}

export function applyTopology(run: WorkflowRun, topologyId: string, input: ApplyTopologyInput = {}): MultiAgentTopologyRun {
  const validation = validateTopologyDefinition(topologyId);
  if (!validation.valid || !validation.definition) {
    throw new Error(`Invalid topology ${topologyId}: ${validation.issues.map((entry) => entry.message).join("; ")}`);
  }
  const definition = validation.definition;
  const state = ensureTopologyState(run);
  ensureMultiAgentState(run);
  const id = input.id || `${definition.id}-${timestampId()}`;
  if (state.runs.some((record) => record.id === id)) throw new Error(`Duplicate MultiAgentTopologyRun id: ${id}`);
  const taskIds = selectedTaskIds(run, input.taskIds);
  const board = resolveBlackboard(run, {
    id: input.blackboardId || `${id}-blackboard`,
    title: `${definition.title} Blackboard`,
    tags: ["topology", definition.id]
  });
  const topics = definition.blackboardTopics.map((topic) => createBlackboardTopic(run, {
    id: `${id}-${topic.id}`,
    title: topic.title,
    description: topic.description,
    blackboardId: board.id,
    tags: ["topology", definition.id]
  }));
  const multiAgentRun = createMultiAgentRun(run, {
    id: input.multiAgentRunId || `${id}-ma`,
    title: input.title || definition.title,
    objective: definition.summary,
    blackboardId: board.id,
    topicIds: topics.map((topic) => topic.id),
    metadata: { topologyId: definition.id, topologyRunId: id }
  });
  const roleIds: string[] = [];
  for (const role of materializedRoles(definition, input)) {
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
      metadata: { topologyId: definition.id, topologyRunId: id, topologyRoleId: role.id }
    });
    roleIds.push(record.id);
  }
  const group = createAgentGroup(run, {
    id: `${id}-group`,
    multiAgentRunId: multiAgentRun.id,
    title: `${definition.title} Group`,
    phase: definition.title,
    taskIds,
    blackboardId: board.id,
    topicIds: topics.map((topic) => topic.id),
    metadata: { topologyId: definition.id, topologyRunId: id }
  });
  const fanoutRoleIds = roleIds.filter((roleId) => !roleId.endsWith("-reducer") && !roleId.endsWith("-synthesizer") && !roleId.endsWith("-panel-chair"));
  const fanout = createAgentFanout(run, {
    id: `${id}-fanout`,
    multiAgentRunId: multiAgentRun.id,
    groupId: group.id,
    reason: `${definition.id} topology fanout`,
    roleIds: fanoutRoleIds.length ? fanoutRoleIds : roleIds,
    taskIds,
    concurrencyLimit: fanoutRoleIds.length || roleIds.length,
    expectedReturnShape: `${definition.title} worker output must include cw:result evidence and blackboard-indexable artifacts/messages.`,
    blackboardId: board.id,
    topicIds: topics.map((topic) => topic.id),
    metadata: { topologyId: definition.id, topologyRunId: id, fanoutStrategy: definition.fanoutStrategy }
  });
  const message = postBlackboardMessage(run, {
    topicId: topics[0].id,
    blackboardId: board.id,
    body: `${definition.title} topology applied. Roles=${roleIds.join(", ")} fanout=${fanout.id}.`,
    tags: ["topology", definition.id],
    metadata: { topologyRunId: id }
  });
  const decision = recordCoordinatorDecision(run, {
    blackboardId: board.id,
    topicId: topics[0].id,
    kind: "context-update",
    outcome: "accepted",
    reason: `${definition.title} topology materialized on multi-agent runtime and blackboard.`,
    subjectIds: [multiAgentRun.id, group.id, fanout.id],
    messageIds: [message.id],
    tags: ["topology", definition.id],
    metadata: { topologyRunId: id }
  });
  const fanin = input.collectInitialFanin ? collectAgentFanin(run, {
    id: `${id}-fanin-initial`,
    multiAgentRunId: multiAgentRun.id,
    groupId: group.id,
    fanoutId: fanout.id,
    requiredRoleIds: fanout.roleIds,
    strategy: definition.faninStrategy,
    blackboardId: board.id,
    topicIds: topics.map((topic) => topic.id),
    metadata: { topologyId: definition.id, topologyRunId: id }
  }) : undefined;
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
    metadata: { fanoutStrategy: definition.fanoutStrategy, faninStrategy: definition.faninStrategy }
  });
  const now = new Date().toISOString();
  const record: MultiAgentTopologyRun = {
    schemaVersion: TOPOLOGY_SCHEMA_VERSION,
    id,
    runId: run.id,
    topologyId: definition.id,
    createdAt: now,
    updatedAt: now,
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
    nextActions: nextActionsFor(definition.id, run.id, id, fanout.id),
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
      auditEventIds: [audit.id]
    },
    metadata: compact({ ...input.metadata, topology: definition })
  };
  state.runs.push(record);
  appendTopologyNode(run, record, statusToNodeStatus(record.status));
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
    metadata: { status: record.status, missingEvidence: record.missingEvidence }
  });
  persistTopologyState(run);
  return record;
}

export function summarizeTopologies(run: WorkflowRun): TopologySummary {
  const state = ensureTopologyState(run);
  const multi = ensureMultiAgentState(run);
  const active = state.runs.map((record) => {
    const inferredFanins = multi.fanins.filter((fanin) => record.groupIds.includes(fanin.groupId) || record.fanoutIds.includes(fanin.fanoutId || ""));
    const allFaninIds = unique([...record.faninIds, ...inferredFanins.map((fanin) => fanin.id)]);
    const blocked = inferredFanins.filter((fanin) => fanin.status === "blocked" || !fanin.verifierReady);
    const ready = inferredFanins.some((fanin) => fanin.verifierReady);
    const missingEvidence = unique([
      ...record.missingEvidence,
      ...blocked.flatMap((fanin) => fanin.blockedReasons)
    ]);
    return {
      id: record.id,
      topologyId: record.topologyId,
      status: ready ? "ready" as const : blocked.length ? "blocked" as const : record.status,
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
      nextActions: ready ? [`node scripts/cw.js candidate register ${run.id} --result-node <reducer-or-panel-result>`] : record.nextActions
    };
  });
  return {
    runId: run.id,
    totalRuns: state.runs.length,
    runsByStatus: countBy(active, (record) => record.status),
    officialTopologies: OFFICIAL_TOPOLOGIES.map((definition) => definition.id),
    active,
    nextAction: active.find((record) => record.nextActions.length)?.nextActions[0] || `node scripts/cw.js topology apply ${run.id} map-reduce --task <task-id>`
  };
}

export function buildTopologyGraph(run: WorkflowRun): TopologyGraph {
  const state = ensureTopologyState(run);
  const nodes: TopologyGraph["nodes"] = [];
  const edges: TopologyGraph["edges"] = [];
  for (const record of state.runs) {
    nodes.push({ id: `${run.id}:topology:${record.id}`, kind: "topology-run", status: record.status, label: `${record.topologyId}:${record.id}`, path: topologyRunPath(run, record.id) });
    edges.push({ from: `${run.id}:run`, to: `${run.id}:topology:${record.id}` });
    edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:${record.multiAgentRunId}`, label: "multi-agent" });
    edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
    for (const topicId of record.topicIds) edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:blackboard:topic:${topicId}`, label: "topic" });
    for (const roleId of record.roleIds) edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:role:${roleId}`, label: "role" });
    for (const groupId of record.groupIds) edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:group:${groupId}`, label: "group" });
    for (const fanoutId of record.fanoutIds) edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:fanout:${fanoutId}`, label: "fanout" });
    for (const faninId of record.faninIds) edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:fanin:${faninId}`, label: "fanin" });
    for (const decisionId of record.coordinatorDecisionIds) edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:blackboard:decision:${decisionId}`, label: "decision" });
  }
  return { nodes, edges: uniqueEdges(edges) };
}

export function showTopologyRun(run: WorkflowRun, topologyRunId: string): MultiAgentTopologyRun {
  const record = ensureTopologyState(run).runs.find((entry) => entry.id === topologyRunId);
  if (!record) throw new Error(`Unknown topology run id: ${topologyRunId}`);
  return record;
}

function materializedRoles(definition: MultiAgentTopologyDefinition, input: ApplyTopologyInput) {
  const count = definition.id === "map-reduce" ? Math.max(1, input.mapperCount || 2) : definition.id === "judge-panel" ? Math.max(2, input.judgeCount || 3) : 1;
  const roles: Array<{ id: string; title: string; responsibilities: string[]; requiredEvidence: string[]; expectedArtifacts: string[]; faninObligations: string[] }> = [];
  for (const role of definition.roles) {
    const roleCount = role.count ?? (role.id === "mapper" || role.id === "judge" ? count : 1);
    if (roleCount > 1) {
      for (let index = 1; index <= roleCount; index += 1) roles.push(expandRole(role, `${role.id}-${index}`, `${role.title} ${index}`));
    } else {
      roles.push(expandRole(role, role.id, role.title));
    }
  }
  return roles;
}

function selectedTaskIds(run: WorkflowRun, taskIds?: string[]): string[] {
  const ids = taskIds?.length ? taskIds : [run.tasks.find((task) => task.status === "pending")?.id || run.tasks[0]?.id].filter(Boolean) as string[];
  for (const id of ids) {
    if (!run.tasks.some((task) => task.id === id)) throw new Error(`Unknown task id for topology: ${id}`);
  }
  return ids;
}

function appendTopologyNode(run: WorkflowRun, record: MultiAgentTopologyRun, status: StateNodeStatus): void {
  appendRunNode(run, createStateNode({
    id: `${run.id}:topology:${record.id}`,
    kind: "topology-run",
    status,
    loopStage: run.loopStage,
    outputs: { topologyId: record.topologyId, status: record.status },
    artifacts: [{ id: "topology-run", kind: "json", path: topologyRunPath(run, record.id) }],
    parents: [`${run.id}:multi-agent:${record.multiAgentRunId}`, `${run.id}:blackboard:${record.blackboardId}`],
    contractId: DEFAULT_PIPELINE_CONTRACT_ID,
    metadata: { topologyId: record.topologyId, topologyRunId: record.id }
  }));
}

function roleSpec(id: string, title: string, responsibilities: string[], expectedArtifacts: string[], faninObligations: string[]) {
  return { id, title, responsibilities, requiredEvidence: expectedArtifacts, expectedArtifacts, faninObligations };
}

function topicSpec(id: string, title: string, description: string) {
  return { id, title, description };
}

function phaseSpec(id: string, title: string, roleIds: string[], fanout: boolean, fanin: boolean, requiredEvidence: string[], coordinatorDecisionKinds: MultiAgentTopologyDefinition["coordinatorDecisions"]) {
  return { id, title, roleIds, fanout, fanin, requiredEvidence, coordinatorDecisionKinds };
}

function expandRole(role: MultiAgentTopologyDefinition["roles"][number], id: string, title: string) {
  return { ...role, id, title };
}

function topologyRoot(run: WorkflowRun): string {
  return run.paths.topologiesDir || path.join(run.paths.runDir, "topologies");
}

function topologyRunPath(run: WorkflowRun, id: string): string {
  return path.join(topologyRoot(run), "runs", `${safeFileName(id)}.json`);
}

function nextActionsFor(topologyId: string, runId: string, topologyRunId: string, fanoutId: string): string[] {
  return [
    `node scripts/cw.js dispatch ${runId} --multi-agent-fanout ${fanoutId}`,
    `node scripts/cw.js multi-agent fanin ${runId} ${topologyRunId}-fanin --fanout ${fanoutId}`,
    `node scripts/cw.js topology summary ${runId}`
  ];
}

function statusToNodeStatus(status: string): StateNodeStatus {
  if (status === "completed" || status === "ready") return "completed";
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "pending";
}

function issue(code: string, message: string, path?: string) {
  return { code, message, path };
}

function timestampId(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15).toLowerCase();
}

function countBy<T>(items: T[], pick: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[pick(item)] = (counts[pick(item)] || 0) + 1;
  return counts;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))];
}

function uniqueEdges(edges: TopologyGraph["edges"]): TopologyGraph["edges"] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}->${edge.to}:${edge.label || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
