"use strict";
// core/multi-agent/topology.ts — OFFICIAL_TOPOLOGIES, applyTopology's
// decision half, role-width math, collector-exclusion, trust-authority.
//
// MILESTONE 9. Byte-exact port of the old build's topology module, minus
// the actual multi-agent/blackboard/coordinator record creation and audit
// writes (those are impure — see shell/topology-io.ts, which calls this
// file's pure helpers then wires createMultiAgentRun/createAgentRole/
// createBlackboardTopic/etc via shell/multi-agent-io.ts +
// shell/coordinator-io.ts, byte-identical to the old build's applyTopology
// call sequence).
//
// BYTE-COMPAT ITEM 3 [load-bearing, HIGH priority]: `unique` in THIS file
// does NOT sort (dedup only, insertion order preserved) — the opposite of
// core/multi-agent/runtime.ts's sorting `unique`. Never merge the two. See
// uniquedual-role-vs-candidate-order.case.js.
//
// Evidence: SPEC/multi-agent.md section B ("Topologies"), "Topology error
// strings and outputs"; the old build's topology module (byte-exact
// source).
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICIAL_TOPOLOGIES = exports.TOPOLOGY_SCHEMA_VERSION = void 0;
exports.unique = unique;
exports.registerTopology = registerTopology;
exports.listTopologyDefinitions = listTopologyDefinitions;
exports.getTopologyDefinition = getTopologyDefinition;
exports.validateTopologyDefinition = validateTopologyDefinition;
exports.withLegacyRoleCounts = withLegacyRoleCounts;
exports.materializedRoles = materializedRoles;
exports.fanoutRoleIds = fanoutRoleIds;
exports.selectedTaskIds = selectedTaskIds;
exports.topologyRunId = topologyRunId;
exports.nextActionsFor = nextActionsFor;
exports.statusToNodeStatus = statusToNodeStatus;
exports.buildTopologyGraphFromRuns = buildTopologyGraphFromRuns;
exports.TOPOLOGY_SCHEMA_VERSION = 1;
/** Dedup, insertion-order preserved (does NOT sort) — the topology-side
 *  `unique` twin. See file header byte-compat note. */
function unique(items) {
    return [...new Set(items.filter((item) => item !== undefined && item !== null))];
}
function roleSpec(id, title, responsibilities, expectedArtifacts, faninObligations, count) {
    return { id, title, responsibilities, requiredEvidence: expectedArtifacts, expectedArtifacts, faninObligations, ...(count !== undefined ? { count } : {}) };
}
function topicSpec(id, title, description) {
    return { id, title, description };
}
function phaseSpec(id, title, roleIds, fanout, fanin, requiredEvidence, coordinatorDecisionKinds) {
    return { id, title, roleIds, fanout, fanin, requiredEvidence, coordinatorDecisionKinds };
}
/** The three built-in topologies, in this exact order. Byte-exact
 *  transcription of the old build's topology module. */
exports.OFFICIAL_TOPOLOGIES = [
    {
        schemaVersion: 1,
        id: "map-reduce",
        title: "Map-Reduce",
        summary: "Fan out mapper roles, index mapper evidence on the blackboard, then reduce only after required evidence is present.",
        roles: [
            roleSpec("mapper", "Mapper", ["Produce an independent shard result and cite evidence."], ["mapper output artifact"], ["indexed mapper artifact"], 2),
            roleSpec("reducer", "Reducer", ["Synthesize mapper outputs only after fanin is verifier-ready."], ["reducer synthesis"], ["all mapper evidence"]),
        ],
        groups: [{ id: "map-reduce", title: "Map-Reduce Group", roleIds: ["mapper", "reducer"] }],
        blackboardTopics: [
            topicSpec("mapper-outputs", "Mapper Outputs", "Indexed mapper result artifacts and evidence."),
            topicSpec("reducer-synthesis", "Reducer Synthesis", "Reducer fanin readiness and synthesis provenance."),
        ],
        phases: [
            phaseSpec("map", "Map", ["mapper"], true, false, ["mapper output artifact"], ["artifact-index"]),
            phaseSpec("reduce", "Reduce", ["reducer"], false, true, ["all mapper evidence"], ["fanin-readiness", "candidate-synthesis"]),
        ],
        fanoutStrategy: "one membership per mapper role over selected run tasks",
        faninStrategy: "required mapper roles must report result evidence and indexed blackboard artifacts",
        requiredEvidence: ["mapper output artifact", "blackboard artifact ref", "reducer synthesis"],
        coordinatorDecisions: ["artifact-index", "fanin-readiness", "candidate-synthesis"],
        candidateExpectations: ["Reducer result becomes a candidate only with mapper provenance."],
        verifierGates: ["Reducer fanin must be ready before completion or commit."],
    },
    {
        schemaVersion: 1,
        id: "debate",
        title: "Debate",
        summary: "Record opposing claims, rebuttal rounds, conflict context, coordinator decisions, and final synthesis on shared topics.",
        roles: [
            roleSpec("position-a", "Position A", ["Argue one supported position with evidence."], ["claim message"], ["round messages"]),
            roleSpec("position-b", "Position B", ["Argue a contrasting position with evidence."], ["counterclaim message"], ["round messages"]),
            roleSpec("synthesizer", "Synthesis", ["Resolve or preserve conflicts with citations."], ["debate synthesis"], ["coordinator decisions"]),
        ],
        groups: [{ id: "debate", title: "Debate Group", roleIds: ["position-a", "position-b", "synthesizer"] }],
        blackboardTopics: [
            topicSpec("debate-rounds", "Debate Rounds", "Claim and rebuttal messages by round."),
            topicSpec("debate-conflicts", "Conflict Context", "Conflicting or unresolved claims."),
            topicSpec("debate-synthesis", "Final Synthesis", "Accepted, rejected, conflicting, and unresolved claims."),
        ],
        phases: [
            phaseSpec("opening", "Opening Claims", ["position-a", "position-b"], true, false, ["claim evidence"], ["message-moderation"]),
            phaseSpec("rebuttal", "Rebuttal Rounds", ["position-a", "position-b"], true, false, ["response evidence"], ["conflict-resolution"]),
            phaseSpec("synthesis", "Synthesis", ["synthesizer"], false, true, ["debate messages", "coordinator decisions"], ["candidate-synthesis"]),
        ],
        fanoutStrategy: "opposing roles write blackboard messages for each round",
        faninStrategy: "synthesis requires debate messages and coordinator claim decisions",
        requiredEvidence: ["debate message", "conflict context", "coordinator decision", "final synthesis"],
        coordinatorDecisions: ["message-moderation", "conflict-resolution", "candidate-synthesis"],
        candidateExpectations: ["Final synthesis cites debate messages and decisions."],
        verifierGates: ["Required debate rounds and synthesis evidence must be present."],
    },
    {
        schemaVersion: 1,
        id: "judge-panel",
        title: "Judge Panel",
        summary: "Collect independent judge outputs, aggregate scores, and select a panel decision with linked evidence.",
        roles: [
            roleSpec("judge", "Judge", ["Score candidates independently and cite evidence."], ["judge score artifact"], ["judge verdict"], 3),
            roleSpec("panel-chair", "Panel Chair", ["Aggregate scores and write a panel decision."], ["panel decision"], ["judge evidence"]),
        ],
        groups: [{ id: "judge-panel", title: "Judge Panel Group", roleIds: ["judge", "panel-chair"] }],
        blackboardTopics: [
            topicSpec("judge-verdicts", "Judge Verdicts", "Independent judge outputs and score evidence."),
            topicSpec("panel-decision", "Panel Decision", "Aggregated verdict and candidate selection rationale."),
        ],
        phases: [
            phaseSpec("judge", "Judge", ["judge"], true, false, ["judge score artifact"], ["artifact-index"]),
            phaseSpec("panel", "Panel", ["panel-chair"], false, true, ["judge evidence", "score records"], ["candidate-synthesis"]),
        ],
        fanoutStrategy: "one membership per independent judge role",
        faninStrategy: "panel decision requires fanin over judge evidence and score records",
        requiredEvidence: ["judge output", "score record", "panel decision", "candidate selection rationale"],
        coordinatorDecisions: ["artifact-index", "candidate-synthesis"],
        candidateExpectations: ["No single judge is authoritative without aggregated fanin and score evidence."],
        verifierGates: ["Panel decision requires multiple judge outputs unless explicitly configured otherwise."],
    },
];
/** Module-level registry (mechanism); OFFICIAL_TOPOLOGIES + registrations
 *  are policy. `listTopologyDefinitions()` composes them — registered
 *  wins on id clash, last-write-wins. */
const topologyRegistry = new Map();
function registerTopology(definition) {
    topologyRegistry.set(definition.id, clone(definition));
}
function listTopologyDefinitions() {
    const merged = exports.OFFICIAL_TOPOLOGIES.map((definition) => clone(definition));
    for (const registered of topologyRegistry.values()) {
        const idx = merged.findIndex((d) => d.id === registered.id);
        if (idx >= 0)
            merged[idx] = clone(registered);
        else
            merged.push(clone(registered));
    }
    return merged;
}
function getTopologyDefinition(topologyId) {
    const registered = topologyRegistry.get(topologyId);
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
        issues.push({ code: "missing-roles", message: "Topology must declare at least one role.", path: "roles" });
    if (!definition.groups.length)
        issues.push({ code: "missing-groups", message: "Topology must declare at least one group.", path: "groups" });
    if (!definition.blackboardTopics.length)
        issues.push({ code: "missing-topics", message: "Topology must declare blackboard topics.", path: "blackboardTopics" });
    if (!definition.requiredEvidence.length)
        issues.push({ code: "missing-evidence", message: "Topology must declare required evidence.", path: "requiredEvidence" });
    const roleIds = new Set(definition.roles.map((role) => role.id));
    for (const phase of definition.phases) {
        for (const roleId of phase.roleIds) {
            if (!roleIds.has(roleId))
                issues.push({ code: "unknown-phase-role", message: `Phase ${phase.id} references unknown role ${roleId}.`, path: `phases.${phase.id}` });
        }
    }
    return { valid: issues.length === 0, topologyId, issues, definition };
}
/** Fold the legacy id-keyed mapperCount/judgeCount flags into the uniform
 *  roleCounts map. An explicit roleCounts entry always wins; judgeCount
 *  floors at 2 (a panel never collapses to one judge via the legacy
 *  flag), mapperCount floors at 1. */
function withLegacyRoleCounts(input) {
    const legacy = {
        mapper: input.mapperCount === undefined ? undefined : Math.max(1, input.mapperCount),
        judge: input.judgeCount === undefined ? undefined : Math.max(2, input.judgeCount),
    };
    const roleCounts = { ...input.roleCounts };
    for (const [roleId, value] of Object.entries(legacy)) {
        if (value !== undefined && roleCounts[roleId] === undefined)
            roleCounts[roleId] = value;
    }
    return Object.keys(roleCounts).length ? { ...input, roleCounts } : input;
}
/** Width = `max(1, roleCounts[role.id] ?? role.count ?? 1)`; when width >
 *  1, instances get ids `${role.id}-${index}` and titles `${role.title}
 *  ${index}` for index 1..N. Data-driven — no topology-id/role-id
 *  branching. */
function materializedRoles(definition, input) {
    const roles = [];
    for (const role of definition.roles) {
        const roleCount = Math.max(1, input.roleCounts?.[role.id] ?? role.count ?? 1);
        if (roleCount > 1) {
            for (let index = 1; index <= roleCount; index += 1) {
                roles.push({ ...role, id: `${role.id}-${index}`, title: `${role.title} ${index}` });
            }
        }
        else {
            roles.push({ ...role, id: role.id, title: role.title });
        }
    }
    return roles;
}
/** Collector roles are excluded from fanout by id suffix
 *  (-reducer/-synthesizer/-panel-chair) — NOT by a flag or role position.
 *  If the filter empties the list, ALL roles fan out. */
function fanoutRoleIds(roleIds) {
    const filtered = roleIds.filter((roleId) => !roleId.endsWith("-reducer") && !roleId.endsWith("-synthesizer") && !roleId.endsWith("-panel-chair"));
    return filtered.length ? filtered : roleIds;
}
function selectedTaskIds(tasks, taskIds) {
    const ids = taskIds?.length ? taskIds : [tasks.find((task) => task.status === "pending")?.id || tasks[0]?.id].filter(Boolean);
    for (const id of ids) {
        if (!tasks.some((task) => task.id === id))
            throw new Error(`Unknown task id for topology: ${id}`);
    }
    return ids;
}
/** Deterministic default topology-run id: `${definition.id}-${hex16}`
 *  where `hex16` is the first 16 hex chars of a content-hash over
 *  `{definitionId, roleIds sorted, taskIds sorted, runId, sequence}`.
 *  `sha256`/`stableStringify` are injected so this file stays free of a
 *  direct core/hash.ts import cycle risk (matches the old build's own
 *  use of the shared hash module). */
function topologyRunId(definition, taskIds, runId, sequence, hash) {
    const digest = hash({
        definitionId: definition.id,
        roleIds: [...definition.roles.map((role) => role.id)].sort(),
        taskIds: [...taskIds].sort(),
        runId,
        sequence,
    });
    return `${definition.id}-${digest.replace("sha256:", "").slice(0, 16)}`;
}
function nextActionsFor(runId, topologyRunId, fanoutId) {
    return [
        `cw dispatch ${runId} --multi-agent-fanout ${fanoutId}`,
        `cw multi-agent fanin ${runId} ${topologyRunId}-fanin --fanout ${fanoutId}`,
        `cw topology summary ${runId}`,
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
function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
function buildTopologyGraphFromRuns(runId, records, runPath) {
    const nodes = [];
    const edges = [];
    for (const record of records) {
        nodes.push({ id: `${runId}:topology:${record.id}`, kind: "topology-run", status: record.status, label: `${record.topologyId}:${record.id}`, path: runPath(record.id) });
        edges.push({ from: `${runId}:run`, to: `${runId}:topology:${record.id}` });
        edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:multi-agent:${record.multiAgentRunId}`, label: "multi-agent" });
        edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:blackboard:${record.blackboardId}`, label: "blackboard" });
        for (const topicId of record.topicIds)
            edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:blackboard:topic:${topicId}`, label: "topic" });
        for (const roleId of record.roleIds)
            edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:multi-agent:role:${roleId}`, label: "role" });
        for (const groupId of record.groupIds)
            edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:multi-agent:group:${groupId}`, label: "group" });
        for (const fanoutId of record.fanoutIds)
            edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:multi-agent:fanout:${fanoutId}`, label: "fanout" });
        for (const faninId of record.faninIds)
            edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:multi-agent:fanin:${faninId}`, label: "fanin" });
        for (const decisionId of record.coordinatorDecisionIds)
            edges.push({ from: `${runId}:topology:${record.id}`, to: `${runId}:blackboard:decision:${decisionId}`, label: "decision" });
    }
    return { nodes, edges: uniqueEdges(edges) };
}
