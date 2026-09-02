"use strict";
// shell/topology-io.ts — applyTopology's IO wiring: materializes the
// blackboard + multi-agent state a topology needs, then persists the
// topology-run record.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// topology module's applyTopology + summarizeTopologies/buildTopologyGraph/
// showTopologyRun/persistTopologyState.
//
// Evidence: SPEC/multi-agent.md section B; the old build's topology
// module (byte-exact source for the wiring sequence).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureTopologyState = ensureTopologyState;
exports.persistTopologyState = persistTopologyState;
exports.applyTopology = applyTopology;
exports.showTopologyRun = showTopologyRun;
exports.summarizeTopologies = summarizeTopologies;
exports.buildTopologyGraph = buildTopologyGraph;
exports.formatTopologySummaryText = formatTopologySummaryText;
exports.formatTopologyGraphText = formatTopologyGraphText;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const node_store_1 = require("./node-store");
const state_node_1 = require("../core/state/state-node");
const contract_1 = require("../core/pipeline/contract");
const trust_audit_1 = require("./trust-audit");
const hash_1 = require("../core/hash");
const hash_2 = require("../core/hash");
const topo = __importStar(require("../core/multi-agent/topology"));
const multi_agent_io_1 = require("./multi-agent-io");
const coordinator_io_1 = require("./coordinator-io");
const collate_1 = require("../core/util/collate");
function topologyRoot(run) {
    return run.paths.topologiesDir || path.join(run.paths.runDir, "topologies");
}
function topologyRunPath(run, id) {
    const safe = id.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
    return path.join(topologyRoot(run), "runs", `${safe}.json`);
}
// Dirty-id tracking for persistTopologyState, mirroring coordinator-io.ts's
// blackboard dirty tracking: without it, every persist call rewrote every
// topology run's OWN file (topologyRunPath), even ones untouched this call —
// O(N) writes per call, O(N^2) across N applyTopology calls. Kept off the
// serialized TopologyState itself (a WeakMap keyed by the state object) so it
// can never leak into state.json's bytes. applyTopology is the only place
// state.runs is pushed to or an existing record mutated, so it is the only
// call site that needs to mark a run id dirty.
const topologyDirtyIds = new WeakMap();
function dirtyTopologyIds(state) {
    let ids = topologyDirtyIds.get(state);
    if (!ids) {
        ids = new Set();
        topologyDirtyIds.set(state, ids);
    }
    return ids;
}
function ensureTopologyState(run) {
    run.paths.topologiesDir = topologyRoot(run);
    fs.mkdirSync(run.paths.topologiesDir, { recursive: true });
    fs.mkdirSync(path.join(run.paths.topologiesDir, "runs"), { recursive: true });
    const existing = run.topologies;
    const state = existing || { schemaVersion: topo.TOPOLOGY_SCHEMA_VERSION, runs: [] };
    state.schemaVersion = topo.TOPOLOGY_SCHEMA_VERSION;
    state.runs = state.runs || [];
    run.topologies = state;
    return state;
}
function persistTopologyState(run) {
    const state = ensureTopologyState(run);
    (0, fs_atomic_1.writeJson)(path.join(topologyRoot(run), "index.json"), {
        schemaVersion: topo.TOPOLOGY_SCHEMA_VERSION,
        runId: run.id,
        counts: { runs: state.runs.length },
        runs: state.runs.map((record) => ({ id: record.id, topologyId: record.topologyId, status: record.status, updatedAt: record.updatedAt })),
    });
    const dirty = dirtyTopologyIds(state);
    for (const id of dirty) {
        const record = state.runs.find((entry) => entry.id === id);
        if (record)
            (0, fs_atomic_1.writeJson)(topologyRunPath(run, id), record);
    }
    dirty.clear();
}
function now() {
    return new Date().toISOString();
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function appendTopologyNode(run, record, status) {
    (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:topology:${record.id}`,
        kind: "topology-run",
        status,
        loopStage: run.loopStage,
        outputs: { topologyId: record.topologyId, status: record.status },
        artifacts: [{ id: "topology-run", kind: "json", path: topologyRunPath(run, record.id) }],
        parents: [`${run.id}:multi-agent:${record.multiAgentRunId}`, `${run.id}:blackboard:${record.blackboardId}`],
        contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { topologyId: record.topologyId, topologyRunId: record.id },
    }));
}
function applyTopology(run, topologyId, input = {}) {
    const validation = topo.validateTopologyDefinition(topologyId);
    if (!validation.valid || !validation.definition) {
        throw new Error(`Invalid topology ${topologyId}: ${validation.issues.map((entry) => entry.message).join("; ")}`);
    }
    const definition = validation.definition;
    const state = ensureTopologyState(run);
    const taskIds = topo.selectedTaskIds(run.tasks, input.taskIds);
    const id = input.id || topo.topologyRunId(definition, taskIds, run.id, state.runs.length, (value) => (0, hash_1.sha256)((0, hash_2.stableStringify)(value)));
    if (state.runs.some((record) => record.id === id))
        throw new Error(`Duplicate MultiAgentTopologyRun id: ${id}`);
    const board = (0, coordinator_io_1.resolveBlackboard)(run, { id: input.blackboardId || `${id}-blackboard`, title: `${definition.title} Blackboard`, tags: ["topology", definition.id] });
    const topics = definition.blackboardTopics.map((topic) => (0, coordinator_io_1.createBlackboardTopic)(run, { id: `${id}-${topic.id}`, title: topic.title, description: topic.description, blackboardId: board.id, tags: ["topology", definition.id] }));
    const multiAgentRun = (0, multi_agent_io_1.createMultiAgentRun)(run, {
        id: input.multiAgentRunId || `${id}-ma`,
        title: input.title || definition.title,
        objective: definition.summary,
        blackboardId: board.id,
        topicIds: topics.map((topic) => topic.id),
        metadata: { topologyId: definition.id, topologyRunId: id },
    });
    const roleIds = [];
    for (const role of topo.materializedRoles(definition, topo.withLegacyRoleCounts(input))) {
        const record = (0, multi_agent_io_1.createAgentRole)(run, {
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
    const group = (0, multi_agent_io_1.createAgentGroup)(run, { id: `${id}-group`, multiAgentRunId: multiAgentRun.id, title: `${definition.title} Group`, phase: definition.title, taskIds, blackboardId: board.id, topicIds: topics.map((topic) => topic.id), metadata: { topologyId: definition.id, topologyRunId: id } });
    const fanoutRoles = topo.fanoutRoleIds(roleIds);
    const fanout = (0, multi_agent_io_1.createAgentFanout)(run, {
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
    const message = (0, coordinator_io_1.postBlackboardMessage)(run, { topicId: topics[0].id, blackboardId: board.id, body: `${definition.title} topology applied. Roles=${roleIds.join(", ")} fanout=${fanout.id}.`, tags: ["topology", definition.id], metadata: { topologyRunId: id } });
    const decision = (0, coordinator_io_1.recordCoordinatorDecision)(run, {
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
    let fanin;
    if (input.collectInitialFanin) {
        fanin = (0, multi_agent_io_1.collectAgentFanin)(run, { id: `${id}-fanin-initial`, multiAgentRunId: multiAgentRun.id, groupId: group.id, fanoutId: fanout.id, requiredRoleIds: fanout.roleIds, strategy: definition.faninStrategy, blackboardId: board.id, topicIds: topics.map((topic) => topic.id), metadata: { topologyId: definition.id, topologyRunId: id } });
    }
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
    const record = {
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
        metadata: compact({ ...(input.metadata || {}), topology: definition }),
    };
    state.runs.push(record);
    dirtyTopologyIds(state).add(record.id);
    appendTopologyNode(run, record, topo.statusToNodeStatus(record.status));
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function showTopologyRun(run, topologyRunId) {
    const record = ensureTopologyState(run).runs.find((entry) => entry.id === topologyRunId);
    if (!record)
        throw new Error(`Unknown topology run id: ${topologyRunId}`);
    return record;
}
function countBy(items, pick) {
    const counts = {};
    for (const item of items)
        counts[pick(item)] = (counts[pick(item)] || 0) + 1;
    return counts;
}
function summarizeTopologies(run) {
    const state = ensureTopologyState(run);
    const multi = run.multiAgent || {};
    const fanins = multi.fanins || [];
    const active = state.runs.map((record) => {
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
            nextActions: ready ? [`cw candidate register ${run.id} --result-node <reducer-or-panel-result>`] : record.nextActions,
        };
    });
    return {
        runId: run.id,
        totalRuns: state.runs.length,
        runsByStatus: countBy(active, (record) => record.status),
        officialTopologies: topo.listTopologyDefinitions().map((definition) => definition.id),
        active,
        nextAction: active.find((record) => record.nextActions.length)?.nextActions[0] || `cw topology apply ${run.id} map-reduce --task <task-id>`,
    };
}
function buildTopologyGraph(run) {
    const state = ensureTopologyState(run);
    return topo.buildTopologyGraphFromRuns(run.id, state.runs, (id) => topologyRunPath(run, id));
}
function formatTopologyCounts(counts) {
    const entries = Object.entries(counts).sort(([a], [b]) => (0, collate_1.stableCompare)(a, b));
    if (!entries.length)
        return "none";
    return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}
/** `cw topology summary <run>` human text — port of the old build's
 *  formatTopologyPanel (operator-ux/format.ts): a `Topologies` rollup with
 *  per-run roles/topics/fanout/fanin/readiness. */
function formatTopologySummaryText(summary) {
    const lines = [
        "Topologies",
        `  runs=${summary.totalRuns}; status=${formatTopologyCounts(summary.runsByStatus)}; official=${summary.officialTopologies.join(", ")}`,
    ];
    for (const record of summary.active.slice(0, 6)) {
        lines.push(`  ${record.id}: ${record.topologyId}, status=${record.status}, readiness=${record.readiness}`);
        lines.push(`    run=${record.multiAgentRunId} board=${record.blackboardId}`);
        lines.push(`    roles=${record.roles.join(", ") || "none"} topics=${record.topics.join(", ") || "none"}`);
        lines.push(`    fanout=${record.fanouts.join(", ") || "none"} fanin=${record.fanins.join(", ") || "none"}`);
        for (const missing of record.missingEvidence.slice(0, 4))
            lines.push(`    missing=${missing}`);
        for (const conflict of record.conflicts.slice(0, 4))
            lines.push(`    conflict=${conflict}`);
        if (record.nextActions[0])
            lines.push(`    next=${record.nextActions[0]}`);
    }
    if (summary.nextAction)
        lines.push(`  next=${summary.nextAction}`);
    return lines.join("\n");
}
/** `cw topology graph <run>` human text — the same `Run Graph:` render
 *  `cw graph` uses, over the topology graph's nodes/edges (old build:
 *  formatOperatorGraph({ runId, nodes, edges })). */
function formatTopologyGraphText(runId, graph) {
    const lines = [`Run Graph: ${runId}`, "", "Nodes"];
    const groups = {};
    for (const node of graph.nodes)
        (groups[node.kind] ||= []).push(node);
    for (const kind of Object.keys(groups).sort()) {
        lines.push(`  ${kind}`);
        for (const node of groups[kind]) {
            const suffix = node.path ? ` -> ${node.path}` : "";
            lines.push(`    [${node.status}] ${node.id} (${node.label})${suffix}`);
        }
    }
    lines.push("", "Edges");
    if (!graph.edges.length)
        lines.push("  none");
    for (const edge of graph.edges) {
        lines.push(`  ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`);
    }
    return lines.join("\n");
}
