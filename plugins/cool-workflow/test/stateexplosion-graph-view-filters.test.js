#!/usr/bin/env node
// stateexplosion-graph-view-filters — pins buildCompactGraphFromView's
// per-view scoping (filterByView): failures/evidence/trust/topology/
// blackboard/candidate/commit-gate each keep only their own named kinds
// (plus protected-status nodes), while full/compact/critical-path see
// every node.
//
// Evidence: SPEC/state-core.md "GRAPH_VIEWS = full, compact, critical-path,
// failures, evidence, trust, topology, blackboard, candidate, commit-gate";
// graph.ts's filterByView.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView, GRAPH_VIEWS } = require("../dist/core/state/state-explosion/graph");

// GRAPH_VIEWS is the exact 10-view list, in order.
{
  assert.deepEqual(
    GRAPH_VIEWS,
    ["full", "compact", "critical-path", "failures", "evidence", "trust", "topology", "blackboard", "candidate", "commit-gate"],
    "GRAPH_VIEWS must be the exact 10 views in this exact order"
  );
}

function mixedGraph() {
  return {
    nodes: [
      { id: "task1", kind: "task", status: "completed", label: "task1" },
      { id: "candidate1", kind: "candidate", status: "scored", label: "candidate1" },
      { id: "commit1", kind: "commit", status: "committed", label: "commit1" },
      { id: "worker1", kind: "worker", status: "running", label: "worker1" },
      { id: "topic1", kind: "blackboard-topic", status: "open", label: "topic1" },
    ],
    edges: [],
  };
}

// "failures" view keeps only nodes with a protected status. With no
// protected-status node present, it keeps nothing (no run-root NODE object
// exists in this fixture's input either, so the internally-tracked
// run-root id has nothing to attach to).
{
  const record = buildCompactGraphFromView("run-1", mixedGraph(), "failures", { now: "x" });
  assert.deepEqual(record.nodes, [], "failures view keeps nothing when no node has a protected status");
}

// "failures" view: a protected-status node (regardless of kind) DOES
// survive, and a run-root NODE present in the input also survives.
{
  const graphWithFailureAndRoot = mixedGraph();
  graphWithFailureAndRoot.nodes.push({ id: "worker-bad", kind: "worker", status: "failed", label: "worker-bad" });
  graphWithFailureAndRoot.nodes.push({ id: "run-1:run", kind: "multi-agent-run-root", status: "interpret", label: "run-1" });
  const record = buildCompactGraphFromView("run-1", graphWithFailureAndRoot, "failures", { now: "x" });
  const ids = record.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["run-1:run", "worker-bad"], "failures view keeps the protected-status node AND the run-root node, nothing else");
}

// "candidate" view keeps only its named kinds (candidate/score/selection/worker/agent-fanin/root),
// PLUS any node on the critical path — candidate/selection kinds and committed
// commits are unconditionally critical-path-protected across every view, so
// commit1 (status: committed) survives here too even though "commit" is not
// itself in this view's keep-kind list.
{
  const record = buildCompactGraphFromView("run-1", mixedGraph(), "candidate", { now: "x" });
  const ids = record.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["candidate1", "commit1", "worker1"], "candidate view keeps candidate and worker kinds, plus the critical-path-protected committed commit1, excludes task/topic");
}

// "commit-gate" view keeps only selection/commit/candidate/agent-fanin/root.
{
  const record = buildCompactGraphFromView("run-1", mixedGraph(), "commit-gate", { now: "x" });
  const ids = record.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["candidate1", "commit1"], "commit-gate view keeps candidate and commit kinds, excludes task/worker/topic");
}

// "blackboard" view keeps only blackboard-* kinds (+ root/coordinator-decision),
// plus the critical-path-protected candidate1/commit1 (see above).
{
  const record = buildCompactGraphFromView("run-1", mixedGraph(), "blackboard", { now: "x" });
  const ids = record.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["candidate1", "commit1", "topic1"], "blackboard view keeps blackboard-topic plus the critical-path-protected candidate1/commit1, excludes task/worker");
}

// "topology" view: none of the mixedGraph kinds match its own keep-list, but
// candidate1/commit1 still survive as critical-path-protected nodes (no root
// injected here, unlike failures).
{
  const record = buildCompactGraphFromView("run-1", mixedGraph(), "topology", { now: "x" });
  const ids = record.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["candidate1", "commit1"], "topology view with no topology-kind nodes present still keeps the critical-path-protected candidate1/commit1");
}

// "full"/"compact"/"critical-path" (the three non-filterByView views) see every node (compact may still collapse; verify count via a bucket too small to collapse).
{
  for (const view of ["full", "compact"]) {
    const record = buildCompactGraphFromView("run-1", mixedGraph(), view, { now: "x" });
    assert.equal(record.nodes.length, 5, `"${view}" view is not scoped by filterByView — all 5 input nodes are visible (bucket of 1 worker stays expanded)`);
  }
}

// Edges are filtered consistently with the node scope (an edge is dropped
// unless BOTH endpoints survive the view filter).
{
  const graph = {
    nodes: [
      { id: "candidate1", kind: "candidate", status: "scored", label: "candidate1" },
      { id: "task1", kind: "task", status: "completed", label: "task1" },
    ],
    edges: [{ from: "task1", to: "candidate1", label: "reports" }],
  };
  const record = buildCompactGraphFromView("run-1", graph, "candidate", { now: "x" });
  assert.deepEqual(record.edges, [], "an edge whose 'from' endpoint is scoped out (task1 not in candidate view) must be dropped entirely");
}

process.stdout.write("stateexplosion-graph-view-filters: ok\n");
