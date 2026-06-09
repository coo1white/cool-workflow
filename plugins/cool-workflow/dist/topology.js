"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICIAL_TOPOLOGIES = exports.TOPOLOGY_SCHEMA_VERSION = void 0;
exports.ensureTopologyState = ensureTopologyState;
exports.persistTopologyState = persistTopologyState;
exports.registerTopology = registerTopology;
exports.listTopologyDefinitions = listTopologyDefinitions;
exports.getTopologyDefinition = getTopologyDefinition;
exports.validateTopologyDefinition = validateTopologyDefinition;
exports.applyTopology = applyTopology;
exports.summarizeTopologies = summarizeTopologies;
exports.buildTopologyGraph = buildTopologyGraph;
exports.showTopologyRun = showTopologyRun;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const state_node_1 = require("./state-node");
const trust_audit_1 = require("./trust-audit");
const multi_agent_1 = require("./multi-agent");
const coordinator_1 = require("./coordinator");
exports.TOPOLOGY_SCHEMA_VERSION = 1;
exports.OFFICIAL_TOPOLOGIES = [
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
function ensureTopologyState(run) {
    run.paths.topologiesDir = topologyRoot(run);
    node_fs_1.default.mkdirSync(run.paths.topologiesDir, { recursive: true });
    node_fs_1.default.mkdirSync(node_path_1.default.join(run.paths.topologiesDir, "runs"), { recursive: true });
    if (!run.topologies)
        run.topologies = { schemaVersion: exports.TOPOLOGY_SCHEMA_VERSION, runs: [] };
    run.topologies.schemaVersion = exports.TOPOLOGY_SCHEMA_VERSION;
    run.topologies.runs = run.topologies.runs || [];
    return run.topologies;
}
function persistTopologyState(run) {
    const state = ensureTopologyState(run);
    (0, state_1.writeJson)(node_path_1.default.join(topologyRoot(run), "index.json"), {
        schemaVersion: exports.TOPOLOGY_SCHEMA_VERSION,
        runId: run.id,
        counts: { runs: state.runs.length },
        runs: state.runs.map((record) => ({
            id: record.id,
            topologyId: record.topologyId,
            status: record.status,
            updatedAt: record.updatedAt
        }))
    });
    for (const record of state.runs)
        (0, state_1.writeJson)(topologyRunPath(run, record.id), record);
}
// ---- Topology registry (v0.1.53) — MECHANISM, not policy ------------------
// SEPARATE MECHANISM FROM POLICY. The Map is mechanism; OFFICIAL_TOPOLOGIES and
// any registerTopology() calls are policy. listTopologyDefinitions() composes
// them — consumers see one merged set, never two.
const _topologyRegistry = new Map();
/** Register a topology definition. Later registrations with the same id
 *  overwrite earlier ones (last-write-wins dedup). */
function registerTopology(definition) {
    _topologyRegistry.set(definition.id, clone(definition));
}
function listTopologyDefinitions() {
    const merged = exports.OFFICIAL_TOPOLOGIES.map((definition) => clone(definition));
    for (const registered of _topologyRegistry.values()) {
        const idx = merged.findIndex((d) => d.id === registered.id);
        if (idx >= 0)
            merged[idx] = clone(registered);
        else
            merged.push(clone(registered));
    }
    return merged;
}
function getTopologyDefinition(topologyId) {
    const registered = _topologyRegistry.get(topologyId);
    if (registered)
        return clone(registered);
    return exports.OFFICIAL_TOPOLOGIES.find((definition) => definition.id === topologyId);
}
function validateTopologyDefinition(topologyId) {
    const definition = getTopologyDefinition(topologyId);
    if (!definition)
        return { valid: false, topologyId, issues: [{ code: "unknown-topology", message: `Unknown topology id: ${topologyId}` }] };
    const issues = [];
    if (!definition.roles.length)
        issues.push(issue("missing-roles", "Topology must declare at least one role.", "roles"));
    if (!definition.groups.length)
        issues.push(issue("missing-groups", "Topology must declare at least one group.", "groups"));
    if (!definition.blackboardTopics.length)
        issues.push(issue("missing-topics", "Topology must declare blackboard topics.", "blackboardTopics"));
    if (!definition.requiredEvidence.length)
        issues.push(issue("missing-evidence", "Topology must declare required evidence.", "requiredEvidence"));
    const roleIds = new Set(definition.roles.map((role) => role.id));
    for (const phase of definition.phases) {
        for (const roleId of phase.roleIds) {
            if (!roleIds.has(roleId))
                issues.push(issue("unknown-phase-role", `Phase ${phase.id} references unknown role ${roleId}.`, `phases.${phase.id}`));
        }
    }
    return { valid: issues.length === 0, topologyId, issues, definition };
}
function applyTopology(run, topologyId, input = {}) {
    const validation = validateTopologyDefinition(topologyId);
    if (!validation.valid || !validation.definition) {
        throw new Error(`Invalid topology ${topologyId}: ${validation.issues.map((entry) => entry.message).join("; ")}`);
    }
    const definition = validation.definition;
    const state = ensureTopologyState(run);
    (0, multi_agent_1.ensureMultiAgentState)(run);
    const id = input.id || `${definition.id}-${timestampId()}`;
    if (state.runs.some((record) => record.id === id))
        throw new Error(`Duplicate MultiAgentTopologyRun id: ${id}`);
    const taskIds = selectedTaskIds(run, input.taskIds);
    const board = (0, coordinator_1.resolveBlackboard)(run, {
        id: input.blackboardId || `${id}-blackboard`,
        title: `${definition.title} Blackboard`,
        tags: ["topology", definition.id]
    });
    const topics = definition.blackboardTopics.map((topic) => (0, coordinator_1.createBlackboardTopic)(run, {
        id: `${id}-${topic.id}`,
        title: topic.title,
        description: topic.description,
        blackboardId: board.id,
        tags: ["topology", definition.id]
    }));
    const multiAgentRun = (0, multi_agent_1.createMultiAgentRun)(run, {
        id: input.multiAgentRunId || `${id}-ma`,
        title: input.title || definition.title,
        objective: definition.summary,
        blackboardId: board.id,
        topicIds: topics.map((topic) => topic.id),
        metadata: { topologyId: definition.id, topologyRunId: id }
    });
    const roleIds = [];
    for (const role of materializedRoles(definition, input)) {
        const record = (0, multi_agent_1.createAgentRole)(run, {
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
    const group = (0, multi_agent_1.createAgentGroup)(run, {
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
    const fanout = (0, multi_agent_1.createAgentFanout)(run, {
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
    const message = (0, coordinator_1.postBlackboardMessage)(run, {
        topicId: topics[0].id,
        blackboardId: board.id,
        body: `${definition.title} topology applied. Roles=${roleIds.join(", ")} fanout=${fanout.id}.`,
        tags: ["topology", definition.id],
        metadata: { topologyRunId: id }
    });
    const decision = (0, coordinator_1.recordCoordinatorDecision)(run, {
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
    const fanin = input.collectInitialFanin ? (0, multi_agent_1.collectAgentFanin)(run, {
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
        metadata: { fanoutStrategy: definition.fanoutStrategy, faninStrategy: definition.faninStrategy }
    });
    const now = new Date().toISOString();
    const record = {
        schemaVersion: exports.TOPOLOGY_SCHEMA_VERSION,
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
        metadata: { status: record.status, missingEvidence: record.missingEvidence }
    });
    persistTopologyState(run);
    return record;
}
function summarizeTopologies(run) {
    const state = ensureTopologyState(run);
    const multi = (0, multi_agent_1.ensureMultiAgentState)(run);
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
            nextActions: ready ? [`node scripts/cw.js candidate register ${run.id} --result-node <reducer-or-panel-result>`] : record.nextActions
        };
    });
    return {
        runId: run.id,
        totalRuns: state.runs.length,
        runsByStatus: countBy(active, (record) => record.status),
        officialTopologies: exports.OFFICIAL_TOPOLOGIES.map((definition) => definition.id),
        active,
        nextAction: active.find((record) => record.nextActions.length)?.nextActions[0] || `node scripts/cw.js topology apply ${run.id} map-reduce --task <task-id>`
    };
}
function buildTopologyGraph(run) {
    const state = ensureTopologyState(run);
    const nodes = [];
    const edges = [];
    for (const record of state.runs) {
        nodes.push({ id: `${run.id}:topology:${record.id}`, kind: "topology-run", status: record.status, label: `${record.topologyId}:${record.id}`, path: topologyRunPath(run, record.id) });
        edges.push({ from: `${run.id}:run`, to: `${run.id}:topology:${record.id}` });
        edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:${record.multiAgentRunId}`, label: "multi-agent" });
        edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
        for (const topicId of record.topicIds)
            edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:blackboard:topic:${topicId}`, label: "topic" });
        for (const roleId of record.roleIds)
            edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:role:${roleId}`, label: "role" });
        for (const groupId of record.groupIds)
            edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:group:${groupId}`, label: "group" });
        for (const fanoutId of record.fanoutIds)
            edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:fanout:${fanoutId}`, label: "fanout" });
        for (const faninId of record.faninIds)
            edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:multi-agent:fanin:${faninId}`, label: "fanin" });
        for (const decisionId of record.coordinatorDecisionIds)
            edges.push({ from: `${run.id}:topology:${record.id}`, to: `${run.id}:blackboard:decision:${decisionId}`, label: "decision" });
    }
    return { nodes, edges: uniqueEdges(edges) };
}
function showTopologyRun(run, topologyRunId) {
    const record = ensureTopologyState(run).runs.find((entry) => entry.id === topologyRunId);
    if (!record)
        throw new Error(`Unknown topology run id: ${topologyRunId}`);
    return record;
}
function materializedRoles(definition, input) {
    const count = definition.id === "map-reduce" ? Math.max(1, input.mapperCount || 2) : definition.id === "judge-panel" ? Math.max(2, input.judgeCount || 3) : 1;
    const roles = [];
    for (const role of definition.roles) {
        const roleCount = role.count ?? (role.id === "mapper" || role.id === "judge" ? count : 1);
        if (roleCount > 1) {
            for (let index = 1; index <= roleCount; index += 1)
                roles.push(expandRole(role, `${role.id}-${index}`, `${role.title} ${index}`));
        }
        else {
            roles.push(expandRole(role, role.id, role.title));
        }
    }
    return roles;
}
function selectedTaskIds(run, taskIds) {
    const ids = taskIds?.length ? taskIds : [run.tasks.find((task) => task.status === "pending")?.id || run.tasks[0]?.id].filter(Boolean);
    for (const id of ids) {
        if (!run.tasks.some((task) => task.id === id))
            throw new Error(`Unknown task id for topology: ${id}`);
    }
    return ids;
}
function appendTopologyNode(run, record, status) {
    (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:topology:${record.id}`,
        kind: "topology-run",
        status,
        loopStage: run.loopStage,
        outputs: { topologyId: record.topologyId, status: record.status },
        artifacts: [{ id: "topology-run", kind: "json", path: topologyRunPath(run, record.id) }],
        parents: [`${run.id}:multi-agent:${record.multiAgentRunId}`, `${run.id}:blackboard:${record.blackboardId}`],
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { topologyId: record.topologyId, topologyRunId: record.id }
    }));
}
function roleSpec(id, title, responsibilities, expectedArtifacts, faninObligations) {
    return { id, title, responsibilities, requiredEvidence: expectedArtifacts, expectedArtifacts, faninObligations };
}
function topicSpec(id, title, description) {
    return { id, title, description };
}
function phaseSpec(id, title, roleIds, fanout, fanin, requiredEvidence, coordinatorDecisionKinds) {
    return { id, title, roleIds, fanout, fanin, requiredEvidence, coordinatorDecisionKinds };
}
function expandRole(role, id, title) {
    return { ...role, id, title };
}
function topologyRoot(run) {
    return run.paths.topologiesDir || node_path_1.default.join(run.paths.runDir, "topologies");
}
function topologyRunPath(run, id) {
    return node_path_1.default.join(topologyRoot(run), "runs", `${(0, state_1.safeFileName)(id)}.json`);
}
function nextActionsFor(topologyId, runId, topologyRunId, fanoutId) {
    return [
        `node scripts/cw.js dispatch ${runId} --multi-agent-fanout ${fanoutId}`,
        `node scripts/cw.js multi-agent fanin ${runId} ${topologyRunId}-fanin --fanout ${fanoutId}`,
        `node scripts/cw.js topology summary ${runId}`
    ];
}
function statusToNodeStatus(status) {
    if (status === "completed" || status === "ready")
        return "completed";
    if (status === "blocked")
        return "blocked";
    if (status === "failed")
        return "failed";
    if (status === "running")
        return "running";
    return "pending";
}
function issue(code, message, path) {
    return { code, message, path };
}
function timestampId() {
    return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15).toLowerCase();
}
function countBy(items, pick) {
    const counts = {};
    for (const item of items)
        counts[pick(item)] = (counts[pick(item)] || 0) + 1;
    return counts;
}
function unique(items) {
    return [...new Set(items.filter((item) => item !== undefined && item !== null))];
}
function uniqueEdges(edges) {
    const seen = new Set();
    return edges.filter((edge) => {
        const key = `${edge.from}->${edge.to}:${edge.label || ""}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
