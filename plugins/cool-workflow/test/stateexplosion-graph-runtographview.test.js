#!/usr/bin/env node
// stateexplosion-graph-runtographview — pins runToGraphView's node/edge
// construction from a run's task/dispatch/worker/candidate/commit/feedback
// arrays: id formats, edge labels, dedup, and sort order.
//
// Evidence: SPEC/state-core.md "buildCompactGraph(...)"; src/multi-agent-
// operator-ux.ts:153-227 (buildMultiAgentOperatorGraph, ported).

const assert = require("node:assert/strict");
const { runToGraphView } = require("../dist/core/state/state-explosion/graph");

function baseRun(overrides) {
  return {
    id: "run-1",
    loopStage: "interpret",
    paths: { state: "/run-1/state.json" },
    ...overrides,
  };
}

// Minimal run: only the run-root node exists.
{
  const view = runToGraphView(baseRun({}));
  assert.equal(view.nodes.length, 1, "a run with no arrays has exactly the run-root node");
  assert.deepEqual(
    view.nodes[0],
    { id: "run-1:run", kind: "multi-agent-run-root", status: "interpret", label: "run-1", path: "/run-1/state.json" },
    "run-root node has the exact id/kind/status/label/path shape"
  );
  assert.deepEqual(view.edges, [], "no edges with no child arrays");
}

// Task node id format + owns/dispatches/reports/gates edges.
{
  const run = baseRun({
    tasks: [
      {
        id: "t1",
        status: "completed",
        taskPath: "/t1.json",
        dispatchId: "d1",
        resultNodeId: "run-1:node:result1",
        verifierNodeId: "run-1:node:verify1",
      },
    ],
  });
  const view = runToGraphView(run);
  const task = view.nodes.find((n) => n.kind === "task");
  assert.deepEqual(task, { id: "run-1:task:t1", kind: "task", status: "completed", label: "t1", path: "/t1.json" }, "task node id format run-1:task:<id>");
  const edgeLabels = view.edges.filter((e) => e.from === "run-1:task:t1" || e.to === "run-1:task:t1").map((e) => e.label).sort();
  assert.deepEqual(edgeLabels, ["dispatches", "gates", "owns", "reports"], "task participates in owns/dispatches/reports/gates edges");
  assert.ok(view.edges.some((e) => e.from === "run-1:run" && e.to === "run-1:task:t1" && e.label === "owns"), "run owns task");
  assert.ok(view.edges.some((e) => e.from === "run-1:task:t1" && e.to === "run-1:dispatch:d1" && e.label === "dispatches"), "task dispatches to dispatch id");
  assert.ok(view.edges.some((e) => e.from === "run-1:task:t1" && e.to === "run-1:node:result1" && e.label === "reports"), "task reports to resultNodeId");
  assert.ok(view.edges.some((e) => e.from === "run-1:task:t1" && e.to === "run-1:node:verify1" && e.label === "gates"), "task gates to verifierNodeId");
}

// A task with no dispatchId/resultNodeId/verifierNodeId produces no dangling edges.
{
  const run = baseRun({ tasks: [{ id: "t2", status: "pending", taskPath: "/t2.json" }] });
  const view = runToGraphView(run);
  const edgesFromT2 = view.edges.filter((e) => e.from === "run-1:task:t2");
  assert.equal(edgesFromT2.length, 0, "a task missing dispatch/result/verifier ids produces zero outgoing edges besides 'owns' into it");
}

// Dispatch -> worker edges via workerIds.
{
  const run = baseRun({
    dispatches: [{ id: "d1", manifestPath: "/d1.json", workerIds: ["w1", "w2"] }],
    workers: [
      { id: "w1", status: "completed" },
      { id: "w2", status: "running" },
    ],
  });
  const view = runToGraphView(run);
  assert.ok(view.edges.some((e) => e.from === "run-1:dispatch:d1" && e.to === "run-1:worker:w1" && e.label === "dispatches"), "dispatch dispatches to worker w1");
  assert.ok(view.edges.some((e) => e.from === "run-1:dispatch:d1" && e.to === "run-1:worker:w2" && e.label === "dispatches"), "dispatch dispatches to worker w2");
}

// Worker -> feedback edges via feedbackIds, worker gates via output.verifierNodeId.
{
  const run = baseRun({
    workers: [{ id: "w1", status: "blocked", output: { verifierNodeId: "run-1:node:v1" }, feedbackIds: ["f1"] }],
    feedback: [{ id: "f1", status: "open", severity: "high", classification: "policy" }],
  });
  const view = runToGraphView(run);
  assert.ok(view.edges.some((e) => e.from === "run-1:worker:w1" && e.to === "run-1:node:v1" && e.label === "gates"), "worker gates via output.verifierNodeId");
  assert.ok(view.edges.some((e) => e.from === "run-1:worker:w1" && e.to === "run-1:feedback:f1" && e.label === "blocks"), "worker blocks via feedbackIds");
  const feedbackNode = view.nodes.find((n) => n.kind === "feedback");
  assert.equal(feedbackNode.label, "high policy", "feedback node label is '<severity> <classification>'");
}

// Candidate scores: nested score node + path format.
{
  const run = baseRun({
    candidates: [{ id: "c1", status: "scored", resultPath: "/c1.json", workerId: "w1", scores: ["s1"] }],
  });
  const view = runToGraphView(run);
  const scoreNode = view.nodes.find((n) => n.kind === "score");
  assert.deepEqual(
    scoreNode,
    { id: "run-1:score:s1", kind: "score", status: "completed", label: "s1", path: "run-1/candidates/c1/scores/s1.json" },
    "score node path is <runId>/candidates/<candidateId>/scores/<scoreId>.json"
  );
  assert.ok(view.edges.some((e) => e.from === "run-1:candidate:c1" && e.to === "run-1:score:s1" && e.label === "scores"), "candidate scores edge to score node");
  assert.ok(view.edges.some((e) => e.from === "run-1:worker:w1" && e.to === "run-1:candidate:c1" && e.label === "reports"), "candidate with workerId reports FROM the worker (not resultNodeId)");
}

// Candidate without workerId falls back to candidate.resultNodeId as the reports-edge source.
{
  const run = baseRun({
    candidates: [{ id: "c2", status: "scored", resultNodeId: "run-1:node:r2" }],
  });
  const view = runToGraphView(run);
  assert.ok(view.edges.some((e) => e.from === "run-1:node:r2" && e.to === "run-1:candidate:c2" && e.label === "reports"), "candidate without workerId reports from resultNodeId");
}

// Selection edges: selects from candidate + score, gates via verifierNodeId.
{
  const run = baseRun({
    candidateSelections: [{ id: "sel1", candidateId: "c1", rankingPath: "/r.json", scoreId: "s1", verifierNodeId: "run-1:node:v2" }],
  });
  const view = runToGraphView(run);
  assert.ok(view.edges.some((e) => e.from === "run-1:candidate:c1" && e.to === "run-1:selection:sel1" && e.label === "selects"), "selection selects from its candidate");
  assert.ok(view.edges.some((e) => e.from === "run-1:score:s1" && e.to === "run-1:selection:sel1" && e.label === "selects"), "selection also selects from its score when scoreId present");
  assert.ok(view.edges.some((e) => e.from === "run-1:node:v2" && e.to === "run-1:selection:sel1" && e.label === "gates"), "selection gates via verifierNodeId");
}

// Commit node id: uses stateNodeId when present, else falls back to run-1:commit:<id>; status verifierGated -> committed else checkpoint.
{
  const run = baseRun({
    commits: [
      { id: "commit-a", verifierGated: true, stateNodeId: "run-1:node:sn1", selectionId: "sel1", verifierNodeId: "run-1:node:v3" },
      { id: "commit-b", verifierGated: false, snapshotPath: "/snap-b.json" },
    ],
  });
  const view = runToGraphView(run);
  const gated = view.nodes.find((n) => n.id === "run-1:node:sn1");
  assert.equal(gated.status, "committed", "verifierGated commit status is 'committed'");
  const checkpoint = view.nodes.find((n) => n.id === "run-1:commit:commit-b");
  assert.ok(checkpoint, "commit without stateNodeId falls back to run-1:commit:<id>");
  assert.equal(checkpoint.status, "checkpoint", "non-verifierGated commit status is 'checkpoint'");
  assert.ok(view.edges.some((e) => e.from === "run-1:selection:sel1" && e.to === "run-1:node:sn1" && e.label === "commits"), "commit commits-edge from its selectionId");
}

// Feedback blocks edges: from nodeId and from task via taskId.
{
  const run = baseRun({
    tasks: [{ id: "t1", status: "blocked", taskPath: "/t1.json" }],
    feedback: [{ id: "f1", status: "open", severity: "med", classification: "quality", nodeId: "run-1:node:n1", taskId: "t1" }],
  });
  const view = runToGraphView(run);
  assert.ok(view.edges.some((e) => e.from === "run-1:node:n1" && e.to === "run-1:feedback:f1" && e.label === "blocks"), "feedback blocks-edge from its nodeId");
  assert.ok(view.edges.some((e) => e.from === "run-1:task:t1" && e.to === "run-1:feedback:f1" && e.label === "blocks"), "feedback blocks-edge from its taskId (resolved to run-1:task:<taskId>)");
}

// Edge de-duplication: identical (from,to,label) triples collapse to one.
{
  const run = baseRun({
    tasks: [{ id: "t1", status: "completed", taskPath: "/t1.json", resultNodeId: "shared", verifierNodeId: "shared" }],
  });
  // Force two edges with identical from/to/label by re-using the same task twice via dispatch construction is awkward;
  // instead verify dedup directly using two distinct sources producing the same edge shape is not applicable here,
  // so we assert the dedup mechanism using commits pointing at the same selection+node pair twice.
  const run2 = baseRun({
    commits: [
      { id: "c1", verifierGated: true, selectionId: "sel1", stateNodeId: "same-node" },
      { id: "c2", verifierGated: true, selectionId: "sel1", stateNodeId: "same-node" },
    ],
  });
  const view = runToGraphView(run2);
  const commitsEdges = view.edges.filter((e) => e.from === "run-1:selection:sel1" && e.to === "same-node" && e.label === "commits");
  assert.equal(commitsEdges.length, 1, "duplicate (from,to,label) edges must collapse to exactly one");
}

// Nodes are sorted by kind then id; edges sorted by from then to then label.
{
  const run = baseRun({
    tasks: [
      { id: "b", status: "completed", taskPath: "/b.json" },
      { id: "a", status: "completed", taskPath: "/a.json" },
    ],
  });
  const view = runToGraphView(run);
  const taskIds = view.nodes.filter((n) => n.kind === "task").map((n) => n.id);
  assert.deepEqual(taskIds, ["run-1:task:a", "run-1:task:b"], "nodes of the same kind are sorted by id");
  // multi-agent-run-root sorts before "task" alphabetically.
  assert.equal(view.nodes[0].kind, "multi-agent-run-root", "nodes are sorted by kind first (multi-agent-run-root < task)");
}

process.stdout.write("stateexplosion-graph-runtographview: ok\n");
