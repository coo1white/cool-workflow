"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stateExplosionReportLines = exports.formatBlackboardDigest = exports.formatCompactGraph = exports.formatStateExplosionReport = exports.fingerprintStrings = exports.GRAPH_VIEWS = exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS = exports.STATE_EXPLOSION_SCHEMA_VERSION = void 0;
exports.computeStateSize = computeStateSize;
exports.summarizeBlackboardDigest = summarizeBlackboardDigest;
exports.buildCompactGraph = buildCompactGraph;
exports.buildStateExplosionReport = buildStateExplosionReport;
exports.maybeCompactRun = maybeCompactRun;
exports.refreshStateExplosionSummaries = refreshStateExplosionSummaries;
exports.loadStateExplosionSummaryIndex = loadStateExplosionSummaryIndex;
exports.showStateExplosionSummary = showStateExplosionSummary;
exports.normalizeStateExplosionForEval = normalizeStateExplosionForEval;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const coordinator_1 = require("./coordinator");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const trust_audit_1 = require("./trust-audit");
const evidence_reasoning_1 = require("./evidence-reasoning");
const helpers_1 = require("./state-explosion/helpers");
exports.STATE_EXPLOSION_SCHEMA_VERSION = 1;
exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS = {
    graphNodes: 40,
    graphEdges: 60,
    blackboardMessages: 25,
    blackboardRecords: 40,
    collapseBucket: 6,
    totalRecords: 80
};
exports.GRAPH_VIEWS = [
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
function createStateExplosionBuildContext() {
    return {
        stateSizes: new Map(),
        blackboardDigests: new Map(),
        graphRecords: new Map()
    };
}
function fullGraphFor(run, context) {
    if (!context.fullGraph)
        context.fullGraph = (0, multi_agent_operator_ux_1.buildMultiAgentOperatorGraph)(run);
    return context.fullGraph;
}
function operatorFor(run, context) {
    if (!context.operator)
        context.operator = (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run);
    return context.operator;
}
function reasoningCriticalIdsFor(run, context) {
    if (!context.reasoningCriticalIds)
        context.reasoningCriticalIds = (0, evidence_reasoning_1.reasoningCriticalNodeIds)(run, operatorFor(run, context));
    return context.reasoningCriticalIds;
}
function thresholdsKey(thresholds) {
    return [
        thresholds.graphNodes,
        thresholds.graphEdges,
        thresholds.blackboardMessages,
        thresholds.blackboardRecords,
        thresholds.collapseBucket,
        thresholds.totalRecords
    ].join(":");
}
function graphKey(view, options) {
    return [
        view,
        options.focus || "",
        options.depth === undefined ? "" : String(options.depth),
        thresholdsKey(options.thresholds || exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS)
    ].join("\0");
}
// ---------------------------------------------------------------------------
// State size
// ---------------------------------------------------------------------------
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
function stateSizeFor(run, thresholds, context) {
    const key = thresholdsKey(thresholds);
    let size = context.stateSizes.get(key);
    if (!size) {
        size = computeStateSizeWithGraph(run, thresholds, fullGraphFor(run, context));
        context.stateSizes.set(key, size);
    }
    return size;
}
// ---------------------------------------------------------------------------
// Blackboard digest (deterministic structural summary)
// ---------------------------------------------------------------------------
function summarizeBlackboardDigest(run, blackboardId) {
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
    const inBoard = (items) => boardId ? items.filter((item) => item.blackboardId === boardId) : items;
    const topics = inBoard(bb.topics || []);
    const messages = inBoard(bb.messages || []);
    const contexts = inBoard(bb.contexts || []);
    const artifacts = inBoard(bb.artifacts || []);
    const decisions = inBoard(bb.decisions || []);
    const summary = (0, coordinator_1.summarizeBlackboard)(run, boardId);
    const topicRollups = topics
        .map((topic) => {
        const topicMessages = messages.filter((m) => m.topicId === topic.id);
        return {
            id: topic.id,
            label: `${topic.title} (${topicMessages.length} messages, ${topic.contextIds.length} contexts, ${topic.artifactRefIds.length} artifacts)`,
            status: topic.status,
            sourceIds: [topic.id, ...topicMessages.map((m) => m.id)],
            evidenceRefs: (0, helpers_1.unique)(topicMessages.flatMap((m) => m.linkedEvidenceRefs || [])),
            expansionCommand: `node scripts/cw.js blackboard message list ${run.id} --topic ${topic.id}`
        };
    })
        .sort(helpers_1.byId);
    const threadSummaries = topics
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
            evidenceRefs: (0, helpers_1.unique)(topicMessages.flatMap((m) => m.linkedEvidenceRefs || [])),
            expansionCommand: `node scripts/cw.js blackboard message list ${run.id} --topic ${topic.id}`
        };
    })
        .filter((entry) => entry.sourceIds.length)
        .sort(helpers_1.byId);
    const unresolvedQuestions = contexts
        .filter((c) => c.kind === "question" && c.status === "open")
        .map((c) => ({
        id: c.id,
        label: `${c.key}: ${(0, helpers_1.truncate)(c.value)}`,
        status: c.status,
        sourceIds: [c.id],
        evidenceRefs: (0, helpers_1.unique)([...(c.evidenceRefs || []), ...(c.artifactRefIds || [])]),
        expansionCommand: `node scripts/cw.js blackboard message post ${run.id} --topic ${c.topicId} --body "<answer with evidence>"`
    }))
        .sort(helpers_1.byId);
    const conflicts = contexts
        .filter((c) => c.status === "conflicting" || (c.conflictingContextIds || []).length)
        .map((c) => ({
        id: c.id,
        label: `${c.key} conflicts with ${(c.conflictingContextIds || []).join(", ") || "another value"}`,
        status: c.status,
        sourceIds: [c.id, ...(c.conflictingContextIds || [])],
        evidenceRefs: (0, helpers_1.unique)([...(c.evidenceRefs || []), ...(c.artifactRefIds || [])]),
        expansionCommand: `node scripts/cw.js coordinator decision ${run.id} --kind conflict-resolution --outcome accepted --subject ${c.id} --reason "<reason>"`
    }))
        .sort(helpers_1.byId);
    const decisionEntries = decisions
        .map((d) => ({
        id: d.id,
        label: `${d.kind}:${d.outcome} ${(0, helpers_1.truncate)(d.reason)}`,
        status: d.status,
        sourceIds: [d.id, ...(d.subjectIds || [])],
        evidenceRefs: (0, helpers_1.unique)([...(d.evidenceRefs || []), ...(d.artifactRefIds || [])]),
        expansionCommand: `node scripts/cw.js node show ${run.id} ${run.id}:coordinator:decision:${d.id}`
    }))
        .sort(helpers_1.byId);
    const artifactEntries = artifacts
        .map((a) => ({
        id: a.id,
        label: `${a.kind} ${a.locator || a.path || a.id}`,
        status: a.status,
        sourceIds: [a.id],
        evidenceRefs: (0, helpers_1.unique)(a.evidenceRefs || []),
        expansionCommand: `node scripts/cw.js blackboard artifact list ${run.id}`
    }))
        .sort(helpers_1.byId);
    const adoptedEvidence = artifacts
        .filter((a) => a.status === "active")
        .map((a) => ({
        id: `evidence:${a.id}`,
        label: `${a.kind} ${a.locator || a.path || a.id}`,
        status: a.status,
        sourceIds: [a.id],
        evidenceRefs: (0, helpers_1.unique)([a.locator || a.path || a.id, ...(a.evidenceRefs || [])]),
        expansionCommand: `node scripts/cw.js audit blackboard ${run.id} --json`
    }))
        .sort(helpers_1.byId);
    const missingEvidence = (summary.missingEvidence || [])
        .map((reason, index) => ({
        id: `missing:${index}:${(0, helpers_1.slug)(reason)}`,
        label: reason,
        status: "missing",
        sourceIds: [],
        evidenceRefs: [],
        expansionCommand: `node scripts/cw.js multi-agent failures ${run.id}`
    }))
        .sort(helpers_1.byId);
    const policyViolations = decisions
        .filter((d) => d.outcome === "rejected" || d.outcome === "blocked" || d.outcome === "conflicting")
        .map((d) => ({
        id: `policy:${d.id}`,
        label: `${d.kind}:${d.outcome} ${(0, helpers_1.truncate)(d.reason)}`,
        status: d.status,
        sourceIds: [d.id],
        evidenceRefs: (0, helpers_1.unique)(d.evidenceRefs || []),
        expansionCommand: `node scripts/cw.js audit policy ${run.id} --json`
    }))
        .sort(helpers_1.byId);
    const judgeRationale = messages
        .filter((m) => (m.tags || []).includes("judge-rationale") || Boolean(m.metadata?.judgeRationale))
        .map((m) => ({
        id: `judge:${m.id}`,
        label: `${m.author.kind}:${m.author.id} ${(0, helpers_1.truncate)(m.body)}`,
        status: m.status,
        sourceIds: [m.id],
        evidenceRefs: (0, helpers_1.unique)(m.linkedEvidenceRefs || []),
        expansionCommand: `node scripts/cw.js audit judge ${run.id} --json`
    }))
        .sort(helpers_1.byId);
    const recentChanges = [...messages, ...contexts, ...artifacts, ...decisions]
        .map((record) => ({
        id: record.id,
        kind: record.kind,
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
        .sort(helpers_1.byId);
    const highSignal = [
        ...conflicts,
        ...unresolvedQuestions,
        ...policyViolations,
        ...missingEvidence
    ].sort(helpers_1.byId);
    const sourceRecordIds = (0, helpers_1.unique)([
        ...topics.map((t) => t.id),
        ...messages.map((m) => m.id),
        ...contexts.map((c) => c.id),
        ...artifacts.map((a) => a.id),
        ...decisions.map((d) => d.id)
    ]);
    const evidenceRefs = (0, helpers_1.unique)([
        ...messages.flatMap((m) => m.linkedEvidenceRefs || []),
        ...artifacts.flatMap((a) => [a.locator || a.path || a.id, ...(a.evidenceRefs || [])]),
        ...contexts.flatMap((c) => c.evidenceRefs || [])
    ]);
    const trustAuditEventRefs = (0, helpers_1.unique)([
        ...messages.flatMap((m) => m.linkedAuditEventIds || []),
        ...artifacts.flatMap((a) => a.trustAuditEventIds || [])
    ]);
    const fingerprint = (0, helpers_1.fingerprintRecords)([...topics, ...messages, ...contexts, ...artifacts, ...decisions]);
    return {
        schemaVersion: exports.STATE_EXPLOSION_SCHEMA_VERSION,
        runId: run.id,
        id: `blackboard-digest${boardId ? `:${boardId}` : ""}`,
        scope: "blackboard",
        blackboardId: boardId,
        sourceRecordIds,
        sourceFingerprint: fingerprint,
        includedCount: topicRollups.length + conflicts.length + unresolvedQuestions.length + decisionEntries.length + artifactEntries.length,
        omittedCount: Math.max(0, messages.length - threadSummaries.length),
        importantRefs: (0, helpers_1.unique)([
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
function blackboardDigestFor(run, context, blackboardId) {
    const key = blackboardId || "";
    let digest = context.blackboardDigests.get(key);
    if (!digest) {
        digest = summarizeBlackboardDigest(run, blackboardId);
        context.blackboardDigests.set(key, digest);
    }
    return digest;
}
function buildCompactGraph(run, view = "compact", options = {}) {
    return buildCompactGraphWithContext(run, view, options, createStateExplosionBuildContext());
}
function buildCompactGraphWithContext(run, view, options, context) {
    const thresholds = options.thresholds || exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS;
    const key = graphKey(view, { ...options, thresholds });
    const cached = context.graphRecords.get(key);
    if (cached)
        return cached;
    const full = fullGraphFor(run, context);
    const operator = operatorFor(run, context);
    const critical = criticalPathNodeIds(run, operator);
    const protectedIds = new Set(critical);
    // Failures, blocked, rejected, conflicting nodes are always preserved.
    for (const node of full.nodes) {
        if ((0, helpers_1.isProtectedStatus)(node.status))
            protectedIds.add(node.id);
    }
    // v0.1.26: reasoning steps are on the critical path and must never be collapsed
    // into a synthetic summary node — protect every decision-gate node backing an
    // adopted reasoning chain (notably score nodes, which are otherwise collapsed).
    for (const id of reasoningCriticalIdsFor(run, context))
        protectedIds.add(id);
    for (const failure of operator.failures) {
        if (failure.linked)
            protectedIds.add(failure.linked);
    }
    const parents = (0, helpers_1.parentMap)(full.edges);
    const parentOf = (id) => parents.get(id);
    let scopeNodes = full.nodes;
    let scopeEdges = full.edges;
    if (view !== "full" && view !== "compact" && view !== "critical-path") {
        const filtered = filterByView(run, view, full, operator, protectedIds);
        scopeNodes = filtered.nodes;
        scopeEdges = filtered.edges;
    }
    // Focus + depth: keep nodes within BFS depth of focus; collapse the rest.
    let focusKeep;
    if (options.focus) {
        focusKeep = bfsNeighborhood(options.focus, scopeNodes, scopeEdges, options.depth ?? 1);
        for (const id of focusKeep)
            protectedIds.add(id);
    }
    const collapseEnabled = view === "compact" || view === "critical-path" || Boolean(options.focus);
    if (view === "full" || !collapseEnabled) {
        // No collapse: emit scoped graph verbatim (still records provenance + critical path).
        const record = finalizeGraphRecord(run, view, options, full, {
            nodes: scopeNodes.map((node) => ({ ...node })),
            edges: scopeEdges.map((edge) => ({ ...edge })),
            syntheticNodes: [],
            critical,
            operator
        });
        context.graphRecords.set(key, record);
        return record;
    }
    // Determine collapse buckets per node.
    const rule = collapseRuleFor(view);
    const keep = new Set();
    const buckets = new Map();
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
    const synthetic = [];
    const collapsedNodeIds = new Map(); // sourceNodeId -> syntheticId
    for (const [key, ids] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (view !== "critical-path" && ids.length < thresholds.collapseBucket) {
            for (const id of ids)
                keep.add(id);
            continue;
        }
        const members = scopeNodes.filter((node) => ids.includes(node.id));
        const internalEdges = scopeEdges.filter((edge) => ids.includes(edge.from) && ids.includes(edge.to));
        const syntheticId = `${run.id}:summary:${(0, helpers_1.slug)(key)}`;
        const dominant = (0, helpers_1.dominantStatus)(members.map((m) => m.status));
        const blocked = members.find((m) => (0, helpers_1.isProtectedStatus)(m.status));
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
        for (const id of ids)
            collapsedNodeIds.set(id, syntheticId);
    }
    const redirect = (id) => collapsedNodeIds.get(id) || id;
    const nodes = [];
    for (const node of scopeNodes) {
        if (keep.has(node.id))
            nodes.push({ ...node });
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
    const edgeSeen = new Set();
    const edges = [];
    for (const edge of scopeEdges) {
        const from = redirect(edge.from);
        const to = redirect(edge.to);
        if (from === to)
            continue; // edge fully internal to a synthetic node
        const key = `${from}\0${to}\0${edge.label || ""}`;
        if (edgeSeen.has(key))
            continue;
        edgeSeen.add(key);
        edges.push({ from, to, label: edge.label });
    }
    const record = finalizeGraphRecord(run, view, options, full, {
        nodes: nodes.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
        edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || (a.label || "").localeCompare(b.label || "")),
        syntheticNodes: synthetic.sort((a, b) => a.id.localeCompare(b.id)),
        critical,
        operator
    });
    context.graphRecords.set(key, record);
    return record;
}
function finalizeGraphRecord(run, view, options, full, built) {
    const collapsedNodeCount = built.syntheticNodes.reduce((acc, syn) => acc + syn.collapsedNodeCount, 0);
    const collapsedEdgeCount = built.syntheticNodes.reduce((acc, syn) => acc + syn.collapsedEdgeCount, 0);
    const blockedReasons = (0, helpers_1.unique)([
        ...built.operator.failures.map((f) => `${f.kind} ${f.id}: ${f.reason}`),
        ...built.syntheticNodes.filter((s) => s.blockedReason).map((s) => s.blockedReason)
    ]);
    return {
        schemaVersion: exports.STATE_EXPLOSION_SCHEMA_VERSION,
        runId: run.id,
        id: `graph-${view}${options.focus ? `:focus:${(0, helpers_1.slug)(options.focus)}` : ""}`,
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
        sourceFingerprint: (0, helpers_1.fingerprintStrings)(full.nodes.map((n) => `${n.id}:${n.status}`)),
        includedCount: built.nodes.length,
        omittedCount: collapsedNodeCount,
        importantRefs: built.critical,
        evidenceRefs: [],
        trustAuditEventRefs: [],
        generatedAt: new Date().toISOString(),
        status: "valid",
        deterministic: true,
        nextAction: collapsedNodeCount > 0
            ? `node scripts/cw.js multi-agent graph ${run.id} --view full --json`
            : `node scripts/cw.js multi-agent graph ${run.id} --view ${view} --json`
    };
}
function collapseRuleFor(view) {
    return {
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
function shouldCollapseKind(kind, _rule) {
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
function filterByView(run, view, full, operator, protectedIds) {
    const keepKinds = (kinds) => {
        const ids = new Set();
        for (const node of full.nodes) {
            if (kinds.includes(node.kind) || protectedIds.has(node.id))
                ids.add(node.id);
        }
        return ids;
    };
    let ids;
    switch (view) {
        case "failures": {
            ids = new Set();
            for (const failure of operator.failures) {
                if (failure.linked)
                    ids.add(failure.linked);
            }
            for (const node of full.nodes)
                if ((0, helpers_1.isProtectedStatus)(node.status))
                    ids.add(node.id);
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
function criticalPathNodeIds(run, operator) {
    const ids = [`${run.id}:run`];
    const ma = run.multiAgent;
    for (const record of ma?.runs || [])
        ids.push(`${run.id}:multi-agent:${record.id}`);
    for (const group of ma?.groups || [])
        ids.push(`${run.id}:multi-agent:group:${group.id}`);
    for (const fanout of ma?.fanouts || [])
        ids.push(`${run.id}:multi-agent:fanout:${fanout.id}`);
    for (const fanin of ma?.fanins || [])
        ids.push(`${run.id}:multi-agent:fanin:${fanin.id}`);
    for (const selection of run.candidateSelections || []) {
        ids.push(`${run.id}:selection:${selection.id}`);
        ids.push(`${run.id}:candidate:${selection.candidateId}`);
    }
    for (const commit of run.commits || []) {
        if (commit.verifierGated)
            ids.push(commit.stateNodeId || `${run.id}:commit:${commit.id}`);
    }
    // Blocked dependencies live on the critical path because they gate completion.
    for (const failure of operator.failures) {
        if (failure.linked)
            ids.push(failure.linked);
    }
    return (0, helpers_1.unique)(ids);
}
function bfsNeighborhood(focus, nodes, edges, depth) {
    const adjacency = new Map();
    for (const edge of edges) {
        if (!adjacency.has(edge.from))
            adjacency.set(edge.from, new Set());
        if (!adjacency.has(edge.to))
            adjacency.set(edge.to, new Set());
        adjacency.get(edge.from).add(edge.to);
        adjacency.get(edge.to).add(edge.from);
    }
    const keep = new Set([focus]);
    let frontier = new Set([focus]);
    for (let level = 0; level < Math.max(0, depth); level += 1) {
        const next = new Set();
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
function expansionCommandFor(run, view, key) {
    if (key === "messages" || key.startsWith("thread"))
        return `node scripts/cw.js blackboard message list ${run.id}`;
    if (key.startsWith("memberships"))
        return `node scripts/cw.js multi-agent graph ${run.id} --view full --json`;
    return `node scripts/cw.js multi-agent graph ${run.id} --view full --focus ${key} --json`;
}
function buildOperatorDigestWithContext(run, thresholds, context) {
    const stateSize = stateSizeFor(run, thresholds, context);
    const operator = operatorFor(run, context);
    const compact = buildCompactGraphWithContext(run, "compact", { thresholds }, context);
    const blackboard = blackboardDigestFor(run, context);
    const evidence = operator.evidence;
    const adopted = evidence.filter((e) => e.status === "adopted");
    const missing = evidence.filter((e) => e.status === "missing" || e.status === "pending" || e.status === "conflicting");
    const rejected = evidence.filter((e) => e.status === "rejected");
    const trust = operator.summaries.trust;
    const hiddenSourceRecords = compact.syntheticNodes.map((syn) => ({
        kind: syn.id.split(":summary:")[1] || syn.kind,
        count: syn.collapsedNodeCount,
        expansionCommand: syn.expansionCommand
    }));
    const expansionCommands = (0, helpers_1.unique)([
        `node scripts/cw.js multi-agent graph ${run.id} --view full --json`,
        `node scripts/cw.js blackboard message list ${run.id} --topic <topic-id>`,
        `node scripts/cw.js multi-agent graph ${run.id} --view critical-path`,
        `node scripts/cw.js multi-agent failures ${run.id} --json`,
        ...compact.syntheticNodes.map((syn) => syn.expansionCommand)
    ]);
    return {
        schemaVersion: exports.STATE_EXPLOSION_SCHEMA_VERSION,
        runId: run.id,
        id: "operator-digest",
        scope: "run",
        sourceRecordIds: compact.sourceRecordIds,
        sourceFingerprint: (0, helpers_1.fingerprintStrings)([
            compact.sourceFingerprint,
            blackboard.sourceFingerprint,
            String(stateSize.total)
        ]),
        includedCount: compact.compactNodeCount,
        omittedCount: compact.collapsedNodeCount,
        importantRefs: compact.criticalPath,
        evidenceRefs: (0, helpers_1.unique)(adopted.map((e) => e.ref || e.id)),
        trustAuditEventRefs: (0, helpers_1.unique)(blackboard.trustAuditEventRefs),
        generatedAt: new Date().toISOString(),
        status: "valid",
        deterministic: true,
        nextAction: operator.nextAction,
        stateSize,
        compactGraphRef: compact.id,
        blackboardDigestRef: blackboard.id,
        criticalPath: compact.criticalPath,
        failures: operator.failures.map((f) => ({
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
                sourceIds: [e.sourceId || e.id].filter(Boolean),
                evidenceRefs: [e.ref || e.id].filter(Boolean),
                expansionCommand: `node scripts/cw.js multi-agent evidence ${run.id} --json`
            }))
        },
        trustDigest: {
            events: trust?.totalEvents || 0,
            policyViolations: blackboard.policyViolations.length,
            judgeRationales: blackboard.judgeRationale.length,
            entries: (0, helpers_1.unique)([
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
function buildStateExplosionReport(run, options = {}) {
    return buildStateExplosionReportWithContext(run, options, createStateExplosionBuildContext());
}
function buildStateExplosionReportWithContext(run, options, context) {
    const thresholds = options.thresholds || exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS;
    const stateSize = stateSizeFor(run, thresholds, context);
    const compactGraph = buildCompactGraphWithContext(run, "compact", { thresholds }, context);
    const criticalPathGraph = buildCompactGraphWithContext(run, "critical-path", { thresholds }, context);
    const blackboardDigest = blackboardDigestFor(run, context);
    const operatorDigest = buildOperatorDigestWithContext(run, thresholds, context);
    const currentFingerprint = (0, helpers_1.fingerprintStrings)([
        compactGraph.sourceFingerprint,
        blackboardDigest.sourceFingerprint,
        operatorDigest.sourceFingerprint,
        String(stateSize.total)
    ]);
    const persisted = options.index;
    const staleScopes = [];
    let status = persisted ? "valid" : "absent";
    if (persisted) {
        if (persisted.sourceFingerprint !== currentFingerprint)
            status = "stale";
        for (const entry of persisted.entries) {
            const current = currentEntryFingerprint(run, entry, { compactGraph, blackboardDigest, operatorDigest });
            if (current && current !== entry.sourceFingerprint)
                staleScopes.push(`${entry.scope}:${entry.id}`);
        }
        if (staleScopes.length)
            status = "stale";
    }
    const nextAction = status === "stale" || status === "absent"
        ? `node scripts/cw.js summary refresh ${run.id}`
        : operatorDigest.nextAction;
    return {
        schemaVersion: exports.STATE_EXPLOSION_SCHEMA_VERSION,
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
function currentEntryFingerprint(run, entry, records) {
    if (entry.scope === "blackboard")
        return records.blackboardDigest.sourceFingerprint;
    if (entry.id.startsWith("graph-")) {
        if (entry.id === records.compactGraph.id)
            return records.compactGraph.sourceFingerprint;
        return undefined;
    }
    if (entry.id === "operator-digest")
        return records.operatorDigest.sourceFingerprint;
    return undefined;
}
// ---------------------------------------------------------------------------
// Persistence + refresh
// ---------------------------------------------------------------------------
/** Check state size and auto-compact if thresholds exceeded. Best-effort —
 *  errors are silently caught; never fail a state mutation for compaction.
 *  BSD: mechanism (check + refresh); policy (when to call) is at the call site. */
function maybeCompactRun(run) {
    try {
        const size = computeStateSize(run);
        if (size.compactionRecommended) {
            refreshStateExplosionSummaries(run);
        }
    }
    catch {
        // Best-effort optimization only.
    }
}
function summariesDir(run) {
    return node_path_1.default.join(run.paths.runDir, "summaries");
}
function refreshStateExplosionSummaries(run, options = {}) {
    const thresholds = options.thresholds || exports.DEFAULT_STATE_EXPLOSION_THRESHOLDS;
    const context = createStateExplosionBuildContext();
    const dir = summariesDir(run);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const views = options.views || ["full", "compact", "critical-path", "failures", "evidence", "trust", "topology", "blackboard", "candidate", "commit-gate"];
    const blackboardDigest = blackboardDigestFor(run, context);
    const operatorDigest = buildOperatorDigestWithContext(run, thresholds, context);
    const graphRecords = views.map((view) => buildCompactGraphWithContext(run, view, { thresholds }, context));
    const entries = [];
    const writeRecord = (id, record, scope, fingerprint, included, omitted) => {
        const file = node_path_1.default.join(dir, `${(0, state_1.safeFileName)(id)}.json`);
        (0, state_1.writeJson)(file, record);
        entries.push({ scope, id, path: file, sourceFingerprint: fingerprint, includedCount: included, omittedCount: omitted, status: "valid" });
    };
    writeRecord(blackboardDigest.id, blackboardDigest, "blackboard", blackboardDigest.sourceFingerprint, blackboardDigest.includedCount, blackboardDigest.omittedCount);
    writeRecord(operatorDigest.id, operatorDigest, "run", operatorDigest.sourceFingerprint, operatorDigest.includedCount, operatorDigest.omittedCount);
    for (const record of graphRecords) {
        writeRecord(record.id, record, "run", record.sourceFingerprint, record.compactNodeCount, record.collapsedNodeCount);
    }
    const stateSize = stateSizeFor(run, thresholds, context);
    const compactGraph = buildCompactGraphWithContext(run, "compact", { thresholds }, context);
    const reportPath = node_path_1.default.join(dir, "state-explosion-report.json");
    const index = {
        schemaVersion: exports.STATE_EXPLOSION_SCHEMA_VERSION,
        runId: run.id,
        id: "multi-agent-summary-index",
        scope: "run",
        sourceRecordIds: (0, helpers_1.unique)([...blackboardDigest.sourceRecordIds, ...operatorDigest.sourceRecordIds]),
        sourceFingerprint: (0, helpers_1.fingerprintStrings)([
            compactGraph.sourceFingerprint,
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
            indexPath: node_path_1.default.join(dir, "index.json"),
            reportPath
        }
    };
    (0, state_1.writeJson)(index.paths.indexPath, index);
    const report = buildStateExplosionReportWithContext(run, { thresholds, index }, context);
    (0, state_1.writeJson)(reportPath, report);
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function loadStateExplosionSummaryIndex(run) {
    const indexPath = node_path_1.default.join(summariesDir(run), "index.json");
    if (!node_fs_1.default.existsSync(indexPath))
        return undefined;
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(indexPath, "utf8"));
        if (!parsed || parsed.id !== "multi-agent-summary-index")
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
function showStateExplosionSummary(run, options = {}) {
    const index = loadStateExplosionSummaryIndex(run);
    const report = buildStateExplosionReport(run, { thresholds: options.thresholds, index });
    if (index && report.freshness.status === "stale") {
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function normalizeStateExplosionForEval(run) {
    const report = buildStateExplosionReport(run);
    const graph = report.compactGraph;
    return {
        summaryFreshness: [
            (0, helpers_1.stableLine)({
                compactionRecommended: report.stateSize.compactionRecommended,
                total: report.stateSize.total,
                deterministic: graph.deterministic
            })
        ],
        compactGraphShape: [
            (0, helpers_1.stableLine)({
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
            (0, helpers_1.stableLine)({
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
        criticalPath: graph.criticalPath.map((id) => (0, helpers_1.stripRunId)(run, id)).sort(),
        evidenceDigest: [
            (0, helpers_1.stableLine)({
                adopted: report.operatorDigest.evidenceDigest.adopted,
                missing: report.operatorDigest.evidenceDigest.missing,
                rejected: report.operatorDigest.evidenceDigest.rejected
            })
        ],
        expansionRefs: report.hiddenSourceRecords.map((h) => `${h.kind}=${h.count}`).sort()
    };
}
// ---------------------------------------------------------------------------
// Helpers + human formatting now live in sibling modules (FreeBSD-audit carve).
// Re-exported below so every importer of this module stays byte-unchanged.
// ---------------------------------------------------------------------------
var helpers_2 = require("./state-explosion/helpers");
Object.defineProperty(exports, "fingerprintStrings", { enumerable: true, get: function () { return helpers_2.fingerprintStrings; } });
var format_1 = require("./state-explosion/format");
Object.defineProperty(exports, "formatStateExplosionReport", { enumerable: true, get: function () { return format_1.formatStateExplosionReport; } });
Object.defineProperty(exports, "formatCompactGraph", { enumerable: true, get: function () { return format_1.formatCompactGraph; } });
Object.defineProperty(exports, "formatBlackboardDigest", { enumerable: true, get: function () { return format_1.formatBlackboardDigest; } });
Object.defineProperty(exports, "stateExplosionReportLines", { enumerable: true, get: function () { return format_1.stateExplosionReportLines; } });
