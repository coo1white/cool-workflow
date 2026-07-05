"use strict";
// core/state/state-explosion/graph.ts — buildCompactGraph + collapse rules.
//
// MILESTONE 4. Byte-exact port of the collapse-rule MACHINERY in the old
// build's src/state-explosion.ts (buildCompactGraph and everything it
// calls: collapseRuleFor, shouldCollapseKind, criticalPathNodeIds,
// bfsNeighborhood, filterByView, finalizeGraphRecord), PLUS a faithful
// port of `buildMultiAgentOperatorGraph`'s (src/multi-agent-operator-ux.ts)
// node/edge construction for every run-level array this milestone's state
// kernel actually carries: `tasks`, `dispatches`, `workers`,
// `candidates`/`candidateSelections`, `commits`, `feedback` (real fields
// on `WorkflowRun`, per core/state/types.ts — `candidates`/
// `candidateSelections`/`feedback`/`workers` are `unknown[]` there, so
// `runToGraphView` below defines the same minimal structural types for
// them that digest.ts uses for blackboard records: matching the old
// build's field usage exactly, degrading to empty when no milestone has
// written a record yet).
//
// DELIBERATE SCOPE CUT: the old build's `full` graph ALSO folds in
// `buildTopologyGraph`/`buildMultiAgentGraph`/`buildBlackboardGraph` (the
// topology/multi-agent/blackboard sub-graphs) and `deriveDependencies`'s
// edges — both are built entirely from `run.topologies`/`run.multiAgent`
// RECORD shapes that do not exist yet (milestone 9). `runToGraphView`
// leaves an explicit extension point (see its own comment) so milestone 9
// adds those sub-graphs and dependency edges additively, without this
// file's collapse-rule machinery changing at all.
//
// Evidence: SPEC/state-core.md "buildCompactGraph(...)", "State-explosion
// collapse rules"; docs/rebuild/PLAN.md byte-compat item 9;
// src/multi-agent-operator-ux.ts:153-227 (buildMultiAgentOperatorGraph).
Object.defineProperty(exports, "__esModule", { value: true });
exports.byId = exports.GRAPH_VIEWS = void 0;
exports.runToGraphView = runToGraphView;
exports.buildCompactGraph = buildCompactGraph;
exports.runToGraphViewFromWorkflowRun = runToGraphViewFromWorkflowRun;
exports.buildCompactGraphFromView = buildCompactGraphFromView;
const size_1 = require("./size");
const helpers_1 = require("./helpers");
Object.defineProperty(exports, "byId", { enumerable: true, get: function () { return helpers_1.byId; } });
const runtime_1 = require("../../multi-agent/runtime");
const coordinator_1 = require("../../multi-agent/coordinator");
const topology_1 = require("../../multi-agent/topology");
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
    "commit-gate",
];
/** Local re-import of `fingerprintStrings` kept file-scoped (not
 *  re-exported) since callers should import it from core/hash.ts or
 *  helpers.ts directly. */
const hash_1 = require("../../hash");
function scorePath(runId, candidateId, scoreId) {
    return `${runId}/candidates/${candidateId}/scores/${scoreId}.json`;
}
/** Faithful port of `buildMultiAgentOperatorGraph`'s node/edge
 *  construction (src/multi-agent-operator-ux.ts:153-227), scoped to the
 *  run-level arrays this milestone's state kernel carries: `tasks`,
 *  `dispatches`, `workers`, `candidates`/`candidateSelections`, `commits`,
 *  `feedback`. The topology/multi-agent/blackboard sub-graphs
 *  (`buildTopologyGraph`/`buildMultiAgentGraph`/`buildBlackboardGraph`)
 *  and `deriveDependencies`'s edges are a milestone-9 concern (built
 *  entirely from `run.topologies`/`run.multiAgent` record shapes that do
 *  not exist yet) — a later milestone adds those nodes/edges into the
 *  same `addNode`/`addEdge` accumulators additively, without any other
 *  part of this file changing. */
function runToGraphView(run) {
    const nodes = new Map();
    const edges = [];
    const addNode = (id, kind, status, label, pathValue) => {
        if (!id)
            return;
        nodes.set(id, { id, kind, status, label, path: pathValue });
    };
    const addEdge = (from, to, label) => {
        if (!from || !to)
            return;
        edges.push({ from, to, label });
    };
    addNode(`${run.id}:run`, "multi-agent-run-root", run.loopStage, run.id, run.paths.state);
    for (const task of run.tasks || []) {
        addNode(`${run.id}:task:${task.id}`, "task", task.status, task.id, task.taskPath);
        addEdge(`${run.id}:run`, `${run.id}:task:${task.id}`, "owns");
        addEdge(`${run.id}:task:${task.id}`, task.dispatchId ? `${run.id}:dispatch:${task.dispatchId}` : undefined, "dispatches");
        addEdge(`${run.id}:task:${task.id}`, task.resultNodeId, "reports");
        addEdge(`${run.id}:task:${task.id}`, task.verifierNodeId, "gates");
    }
    for (const dispatch of run.dispatches || []) {
        addNode(`${run.id}:dispatch:${dispatch.id}`, "dispatch", "completed", dispatch.id, dispatch.manifestPath);
        for (const workerId of dispatch.workerIds || [])
            addEdge(`${run.id}:dispatch:${dispatch.id}`, `${run.id}:worker:${workerId}`, "dispatches");
    }
    for (const worker of run.workers || []) {
        addNode(`${run.id}:worker:${worker.id}`, "worker", worker.status, worker.id, worker.inputPath);
        addEdge(`${run.id}:worker:${worker.id}`, worker.resultNodeId, "reports");
        addEdge(`${run.id}:worker:${worker.id}`, worker.output?.verifierNodeId, "gates");
        for (const feedbackId of worker.feedbackIds || [])
            addEdge(`${run.id}:worker:${worker.id}`, `${run.id}:feedback:${feedbackId}`, "blocks");
    }
    for (const candidate of run.candidates || []) {
        const candidateId = `${run.id}:candidate:${candidate.id}`;
        addNode(candidateId, "candidate", candidate.status, candidate.id, candidate.resultPath);
        addEdge(candidate.workerId ? `${run.id}:worker:${candidate.workerId}` : candidate.resultNodeId, candidateId, "reports");
        addEdge(candidate.verifierNodeId, candidateId, "gates");
        for (const scoreId of candidate.scores || []) {
            const nodeId = `${run.id}:score:${scoreId}`;
            addNode(nodeId, "score", "completed", scoreId, scorePath(run.id, candidate.id, scoreId));
            addEdge(candidateId, nodeId, "scores");
        }
        for (const feedbackId of candidate.feedbackIds || [])
            addEdge(candidateId, `${run.id}:feedback:${feedbackId}`, "blocks");
    }
    for (const selection of run.candidateSelections || []) {
        const nodeId = `${run.id}:selection:${selection.id}`;
        addNode(nodeId, "selection", "accepted", selection.id, selection.rankingPath);
        addEdge(`${run.id}:candidate:${selection.candidateId}`, nodeId, "selects");
        if (selection.scoreId)
            addEdge(`${run.id}:score:${selection.scoreId}`, nodeId, "selects");
        addEdge(selection.verifierNodeId, nodeId, "gates");
    }
    for (const commit of run.commits || []) {
        const nodeId = commit.stateNodeId || `${run.id}:commit:${commit.id}`;
        addNode(nodeId, "commit", commit.verifierGated ? "committed" : "checkpoint", commit.id, commit.snapshotPath);
        addEdge(commit.selectionId ? `${run.id}:selection:${commit.selectionId}` : undefined, nodeId, "commits");
        addEdge(commit.verifierNodeId, nodeId, "gates");
    }
    for (const feedback of run.feedback || []) {
        addNode(`${run.id}:feedback:${feedback.id}`, "feedback", feedback.status, `${feedback.severity} ${feedback.classification}`);
        addEdge(feedback.nodeId, `${run.id}:feedback:${feedback.id}`, "blocks");
        addEdge(feedback.taskId ? `${run.id}:task:${feedback.taskId}` : undefined, `${run.id}:feedback:${feedback.id}`, "blocks");
    }
    const edgeSeen = new Set();
    const dedupedEdges = edges.filter((edge) => {
        const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
        if (edgeSeen.has(key))
            return false;
        edgeSeen.add(key);
        return true;
    });
    return {
        nodes: [...nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
        edges: dedupedEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || (a.label || "").localeCompare(b.label || "")),
    };
}
/** `buildCompactGraph(run, view, options)` — builds the graph view via
 *  `runToGraphView`, then delegates to `buildCompactGraphFromView`. */
function buildCompactGraph(run, view = "compact", options = {}) {
    return buildCompactGraphFromView(run.id, runToGraphView(run), view, options);
}
/** Adapts a real `WorkflowRun` (whose `workers`/`candidates`/
 *  `candidateSelections`/`feedback` are `unknown[]`-typed at this
 *  milestone — see core/state/types.ts's header note) into
 *  `RunToGraphViewInput`'s typed shape. The ONE cast point every shell/
 *  cli caller goes through, instead of repeating the cast at each call
 *  site; degrades to empty arrays today (genuinely the only value those
 *  fields can hold before their owning milestone writes real records) and
 *  needs no change once real records exist. */
function runToGraphViewFromWorkflowRun(run) {
    const base = runToGraphView(run);
    // Fold in the multi-agent, blackboard, and topology sub-graphs (the
    // milestone-9 extension point promised in this file's header note). These
    // add the high-volume, low-signal node kinds the collapse rules exist for
    // (blackboard-message/context/snapshot, agent-membership/role) plus the
    // multi-agent-run/group/fanout/fanin roots the critical path is keyed on.
    // Byte-behavior port of the old build's runToGraphView, which merged the
    // same three sub-graphs via summarizeMultiAgentOperator. Node `path` values
    // are display-only (never affect counts/collapse), so the blackboard graph
    // gets lightweight path stubs here.
    const multiAgent = (0, runtime_1.buildMultiAgentGraph)(run);
    const blackboardState = run.blackboard || (0, coordinator_1.emptyBlackboardState)();
    const blackboard = (0, coordinator_1.buildBlackboardGraph)(run.id, blackboardState, (kind, id) => `${run.paths.runDir}/blackboard/${kind}/${id}.json`, `${run.paths.runDir}/blackboard/messages.jsonl`);
    const topologyRuns = (run.topologies?.runs || []);
    const topology = (0, topology_1.buildTopologyGraphFromRuns)(run.id, topologyRuns, (id) => `${run.paths.runDir}/topologies/${id}.json`);
    const nodes = new Map();
    for (const node of [...base.nodes, ...multiAgent.nodes, ...blackboard.nodes, ...topology.nodes]) {
        if (!nodes.has(node.id))
            nodes.set(node.id, node);
    }
    const edges = [];
    const edgeSeen = new Set();
    for (const edge of [...base.edges, ...multiAgent.edges, ...blackboard.edges, ...topology.edges]) {
        const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
        if (edgeSeen.has(key))
            continue;
        edgeSeen.add(key);
        edges.push(edge);
    }
    return {
        nodes: [...nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
        edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || (a.label || "").localeCompare(b.label || "")),
    };
}
function collapseRuleFor() {
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
        },
    };
}
/** Collapsible kinds ONLY (docs/rebuild/PLAN.md byte-compat item 9): high-volume,
 *  low-individual-signal. `decisions, artifacts, fanins, candidates,
 *  selections, commits, feedback` are NEVER collapsed so failures,
 *  evidence, policy, and judge rationale stay visible. */
function shouldCollapseKind(kind) {
    return [
        "blackboard-message",
        "blackboard-context",
        "agent-membership",
        "worker",
        "score",
        "blackboard-snapshot",
        "agent-role",
    ].includes(kind);
}
/** Critical-path node ids. The run root, plus the multi-agent-run/group/
 *  fanout/fanin roots, the candidate/selection reasoning chain, and every
 *  verifier-gated commit — derived from the merged graph's own node kinds
 *  (the sub-graphs `runToGraphViewFromWorkflowRun` now folds in). Byte-
 *  behavior port of the old build's criticalPathNodeIds. The two extension
 *  points (`reasoningCriticalIds`, `linkedFailureIds`) still feed in extra
 *  ids without reshaping this function. */
function criticalPathNodeIds(runId, options, nodes = []) {
    const ids = [`${runId}:run`, ...(options.linkedFailureIds || [])];
    for (const node of nodes) {
        switch (node.kind) {
            case "multi-agent-run":
            case "agent-group":
            case "agent-fanout":
            case "agent-fanin":
            case "candidate":
            case "selection":
                ids.push(node.id);
                break;
            case "commit":
                if (node.status === "committed")
                    ids.push(node.id);
                break;
            default:
                break;
        }
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
function expansionCommandFor(runId, key) {
    if (key === "messages" || key.startsWith("thread"))
        return `node scripts/cw.js blackboard message list ${runId}`;
    if (key.startsWith("memberships"))
        return `node scripts/cw.js multi-agent graph ${runId} --view full --json`;
    return `node scripts/cw.js multi-agent graph ${runId} --view full --focus ${key} --json`;
}
function filterByView(runId, view, full, protectedIds) {
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
            for (const node of full.nodes)
                if ((0, helpers_1.isProtectedStatus)(node.status))
                    ids.add(node.id);
            ids.add(`${runId}:run`);
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
                "commit",
            ]);
            break;
        case "trust":
            ids = keepKinds(["multi-agent-run-root", "blackboard", "coordinator-decision", "agent-fanin", "candidate", "selection", "commit"]);
            break;
        case "topology":
            ids = keepKinds(["multi-agent-run-root", "topology", "multi-agent-run", "agent-group", "agent-role", "agent-fanout", "agent-fanin"]);
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
                "coordinator-decision",
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
function finalizeGraphRecord(runId, view, options, full, built) {
    const collapsedNodeCount = built.syntheticNodes.reduce((acc, syn) => acc + syn.collapsedNodeCount, 0);
    const collapsedEdgeCount = built.syntheticNodes.reduce((acc, syn) => acc + syn.collapsedEdgeCount, 0);
    const blockedReasons = (0, helpers_1.unique)(built.syntheticNodes.filter((s) => s.blockedReason).map((s) => s.blockedReason));
    return {
        schemaVersion: 1,
        runId,
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
        sourceFingerprint: (0, hash_1.fingerprintStrings)(full.nodes.map((n) => `${n.id}:${n.status}`)),
        includedCount: built.nodes.length,
        omittedCount: collapsedNodeCount,
        importantRefs: built.critical,
        evidenceRefs: [],
        trustAuditEventRefs: [],
        generatedAt: options.now || new Date().toISOString(),
        status: "valid",
        deterministic: true,
        nextAction: collapsedNodeCount > 0
            ? `node scripts/cw.js multi-agent graph ${runId} --view full --json`
            : `node scripts/cw.js multi-agent graph ${runId} --view ${view} --json`,
    };
}
/** The collapse-rule core, generic over any `{ nodes, edges }` graph view
 *  (see the file header on why this milestone feeds it the run's task/
 *  dispatch/worker/candidate/commit/feedback graph via `runToGraphView`,
 *  and why a later milestone's fuller graph — with topology/multi-agent/
 *  blackboard sub-graphs folded in — can reuse this unchanged). */
function buildCompactGraphFromView(runId, full, view = "compact", options = {}) {
    const thresholds = options.thresholds || size_1.DEFAULT_STATE_EXPLOSION_THRESHOLDS;
    const critical = criticalPathNodeIds(runId, options, full.nodes);
    const protectedIds = new Set(critical);
    // Failures, blocked, rejected, conflicting nodes are always preserved.
    for (const node of full.nodes) {
        if ((0, helpers_1.isProtectedStatus)(node.status))
            protectedIds.add(node.id);
    }
    // Reasoning-critical nodes are on the critical path and must never be
    // collapsed into a synthetic summary node (docs/rebuild/PLAN.md byte-compat item 9).
    for (const id of options.reasoningCriticalIds || [])
        protectedIds.add(id);
    const parents = (0, helpers_1.parentMap)(full.edges);
    const parentOf = (id) => parents.get(id);
    let scopeNodes = full.nodes;
    let scopeEdges = full.edges;
    if (view !== "full" && view !== "compact" && view !== "critical-path") {
        const filtered = filterByView(runId, view, full, protectedIds);
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
        // No collapse: emit scoped graph verbatim (still records provenance +
        // critical path).
        return finalizeGraphRecord(runId, view, options, full, {
            nodes: scopeNodes.map((node) => ({ ...node })),
            edges: scopeEdges.map((edge) => ({ ...edge })),
            syntheticNodes: [],
            critical,
        });
    }
    // Determine collapse buckets per node.
    const rule = collapseRuleFor();
    const keep = new Set();
    const buckets = new Map();
    for (const node of scopeNodes) {
        if (protectedIds.has(node.id) || (focusKeep && focusKeep.has(node.id))) {
            keep.add(node.id);
            continue;
        }
        if (view === "critical-path") {
            // Collapse everything not on the critical path into one bucket per kind.
            const bucketKey = `critical-context:${node.kind}`;
            buckets.set(bucketKey, [...(buckets.get(bucketKey) || []), node.id]);
            continue;
        }
        if (!shouldCollapseKind(node.kind)) {
            keep.add(node.id);
            continue;
        }
        const bucketKey = rule.bucketBy(node, parentOf);
        buckets.set(bucketKey, [...(buckets.get(bucketKey) || []), node.id]);
    }
    // Buckets smaller than the collapse threshold stay expanded (unless
    // critical-path — docs/rebuild/PLAN.md byte-compat item 9).
    const synthetic = [];
    const collapsedNodeIds = new Map(); // sourceNodeId -> syntheticId
    for (const [bucketKey, ids] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (view !== "critical-path" && ids.length < thresholds.collapseBucket) {
            for (const id of ids)
                keep.add(id);
            continue;
        }
        const members = scopeNodes.filter((node) => ids.includes(node.id));
        const internalEdges = scopeEdges.filter((edge) => ids.includes(edge.from) && ids.includes(edge.to));
        const syntheticId = `${runId}:summary:${(0, helpers_1.slug)(bucketKey)}`;
        const dominant = (0, helpers_1.dominantStatus)(members.map((m) => m.status));
        const blocked = members.find((m) => (0, helpers_1.isProtectedStatus)(m.status));
        synthetic.push({
            id: syntheticId,
            kind: "summary",
            label: `${bucketKey} (${ids.length} collapsed)`,
            status: dominant,
            collapsedNodeCount: ids.length,
            collapsedEdgeCount: internalEdges.length,
            sourceIds: [...ids].sort(),
            dominantStatus: dominant,
            blockedReason: blocked ? `${blocked.kind} ${blocked.id} is ${blocked.status}` : undefined,
            expansionCommand: expansionCommandFor(runId, bucketKey),
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
        nodes.push({ id: syn.id, kind: "summary", label: syn.label, status: syn.status, synthetic: syn });
    }
    const edgeSeen = new Set();
    const edges = [];
    for (const edge of scopeEdges) {
        const from = redirect(edge.from);
        const to = redirect(edge.to);
        if (from === to)
            continue; // edge fully internal to a synthetic node
        const edgeKey = `${from}\0${to}\0${edge.label || ""}`;
        if (edgeSeen.has(edgeKey))
            continue;
        edgeSeen.add(edgeKey);
        edges.push({ from, to, label: edge.label });
    }
    return finalizeGraphRecord(runId, view, options, full, {
        nodes: nodes.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
        edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || (a.label || "").localeCompare(b.label || "")),
        syntheticNodes: synthetic.sort((a, b) => a.id.localeCompare(b.id)),
        critical,
    });
}
