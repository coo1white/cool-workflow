"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMultiAgentGraphFromState = buildMultiAgentGraphFromState;
// Multi-agent provenance-graph builder (god-module carve, FreeBSD router pattern
// — cf. orchestrator/topology-operations.ts and run-registry/derive.ts). This is
// the largest cohesive renderer in the module: it walks the resolved
// MultiAgentState and emits the nodes/edges that the operator-UX and orchestrator
// graph surfaces consume. BEHAVIOR-PRESERVING — pure code movement, zero logic
// change. multi-agent.ts keeps the public buildMultiAgentGraph(run) entry point
// as a thin delegator (it resolves the state via ensureMultiAgentState, then
// calls buildMultiAgentGraphFromState) so the state is still ensured exactly
// once, in the same order, with the same side effects.
const node_fs_1 = __importDefault(require("node:fs"));
const paths_1 = require("./paths");
const helpers_1 = require("./helpers");
function buildMultiAgentGraphFromState(run, state) {
    const root = (0, paths_1.multiAgentRoot)(run);
    const nodes = [];
    const edges = [];
    for (const record of state.runs) {
        nodes.push({ id: `${run.id}:multi-agent:${record.id}`, kind: "multi-agent-run", status: record.status, label: record.title || record.id, path: (0, paths_1.recordPath)(run, "runs", record.id) });
        edges.push({ from: `${run.id}:run`, to: `${run.id}:multi-agent:${record.id}` });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
        if (record.parentMultiAgentRunId)
            edges.push({ from: `${run.id}:multi-agent:${record.parentMultiAgentRunId}`, to: `${run.id}:multi-agent:${record.id}`, label: "child" });
    }
    for (const record of state.roles) {
        nodes.push({ id: `${run.id}:multi-agent:role:${record.id}`, kind: "agent-role", status: record.status, label: record.title, path: (0, paths_1.recordPath)(run, "roles", record.id) });
        edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:role:${record.id}` });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:role:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
    }
    for (const record of state.groups) {
        nodes.push({ id: `${run.id}:multi-agent:group:${record.id}`, kind: "agent-group", status: record.status, label: record.title || record.id, path: (0, paths_1.recordPath)(run, "groups", record.id) });
        edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:group:${record.id}` });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:group:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
        for (const taskId of record.taskIds)
            edges.push({ from: `${run.id}:multi-agent:group:${record.id}`, to: `${run.id}:task:${taskId}`, label: "task" });
    }
    for (const record of state.fanouts) {
        nodes.push({ id: `${run.id}:multi-agent:fanout:${record.id}`, kind: "agent-fanout", status: record.status, label: record.reason, path: (0, paths_1.recordPath)(run, "fanouts", record.id) });
        edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:fanout:${record.id}` });
        for (const dispatchId of record.dispatchIds)
            edges.push({ from: `${run.id}:multi-agent:fanout:${record.id}`, to: `${run.id}:dispatch:${dispatchId}`, label: "dispatch" });
    }
    for (const record of state.memberships) {
        nodes.push({ id: `${run.id}:multi-agent:membership:${record.id}`, kind: "agent-membership", status: record.status, label: `${record.roleId}/${record.taskId}`, path: (0, paths_1.recordPath)(run, "memberships", record.id) });
        edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:membership:${record.id}` });
        edges.push({ from: `${run.id}:multi-agent:role:${record.roleId}`, to: `${run.id}:multi-agent:membership:${record.id}` });
        edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:task:${record.taskId}`, label: "task" });
        if (record.workerId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:worker:${record.workerId}`, label: "worker" });
        if (record.resultNodeId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: record.resultNodeId, label: "result" });
        if (record.verifierNodeId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: record.verifierNodeId, label: "verifier" });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
        for (const artifactId of record.blackboardArtifactRefIds || [])
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:artifact:${artifactId}`, label: "evidence" });
        for (const messageId of record.blackboardMessageIds || [])
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:message:${messageId}`, label: "message" });
    }
    for (const record of state.fanins) {
        nodes.push({ id: `${run.id}:multi-agent:fanin:${record.id}`, kind: "agent-fanin", status: record.status, label: record.strategy, path: (0, paths_1.recordPath)(run, "fanins", record.id) });
        edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
        if (record.fanoutId)
            edges.push({ from: `${run.id}:multi-agent:fanout:${record.fanoutId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
        for (const membershipId of record.reportedMembershipIds)
            edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "reported" });
        for (const membershipId of record.missingMembershipIds)
            edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "missing" });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:fanin:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
    }
    if (!node_fs_1.default.existsSync(root))
        node_fs_1.default.mkdirSync(root, { recursive: true });
    return { nodes, edges: (0, helpers_1.uniqueEdges)(edges) };
}
