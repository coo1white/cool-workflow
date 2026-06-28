"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS = exports.STATE_EXPLOSION_SCHEMA_VERSION = void 0;
exports.computeStateSize = computeStateSize;
exports.computeStateSizeWithGraph = computeStateSizeWithGraph;
const multi_agent_operator_ux_1 = require("../multi-agent-operator-ux");
exports.STATE_EXPLOSION_SCHEMA_VERSION = 1;
exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS = {
    graphNodes: 40,
    graphEdges: 60,
    blackboardMessages: 25,
    blackboardRecords: 40,
    collapseBucket: 6,
    totalRecords: 80
};
function computeStateSize(run, thresholds = exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS) {
    return computeStateSizeWithGraph(run, thresholds, (0, multi_agent_operator_ux_1.buildMultiAgentOperatorGraph)(run));
}
function computeStateSizeWithGraph(run, thresholds, graph) {
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
    const total = counts.multiAgentRuns +
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
    const reasons = [];
    if (counts.graphNodes > thresholds.graphNodes)
        reasons.push(`graph has ${counts.graphNodes} nodes (> ${thresholds.graphNodes})`);
    if (counts.graphEdges > thresholds.graphEdges)
        reasons.push(`graph has ${counts.graphEdges} edges (> ${thresholds.graphEdges})`);
    if (counts.messages > thresholds.blackboardMessages)
        reasons.push(`blackboard has ${counts.messages} messages (> ${thresholds.blackboardMessages})`);
    const bbRecords = counts.topics + counts.messages + counts.contexts + counts.artifacts + counts.snapshots + counts.decisions;
    if (bbRecords > thresholds.blackboardRecords)
        reasons.push(`blackboard has ${bbRecords} records (> ${thresholds.blackboardRecords})`);
    if (total > thresholds.totalRecords)
        reasons.push(`run has ${total} multi-agent records (> ${thresholds.totalRecords})`);
    return { ...counts, total, compactionRecommended: reasons.length > 0, reasons: reasons.sort() };
}
