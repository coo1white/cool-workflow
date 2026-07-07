#!/usr/bin/env node
// stateexplosion-graph-focus-depth — pins the focus+depth BFS neighborhood
// protection: nodes within BFS depth of the focus id are kept, everything
// else in a collapsible kind collapses (focus implies collapseEnabled).
//
// Evidence: SPEC/state-core.md "buildCompactGraph(run, view, { focus?,
// depth?, thresholds? })"; graph.ts's bfsNeighborhood + finalizeGraphRecord.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");

function chain(length = 7) {
  // w0 -- w1 -- w2 -- ... -- w<length-1> (a worker chain)
  const nodes = Array.from({ length }, (_, i) => ({ id: `w${i}`, kind: "worker", status: "completed", label: `w${i}` }));
  const edges = [];
  for (let i = 0; i < length - 1; i += 1) edges.push({ from: `w${i}`, to: `w${i + 1}`, label: "next" });
  return { nodes, edges };
}

// "full" view + a focus still emits everything verbatim (view === "full"
// short-circuits collapse BEFORE the focus/collapseEnabled logic runs).
{
  const full = chain(9);
  const record = buildCompactGraphFromView("run-1", full, "full", {
    focus: "w4",
    depth: 1,
    now: "2024-01-01T00:00:00.000Z",
  });
  assert.equal(record.nodes.length, 9, "the 'full' view with a focus still emits every node uncollapsed (view==='full' short-circuits collapse)");
}

// Using "compact" (not "full") + focus, with enough out-of-neighborhood
// nodes (>= 6) to actually cross the collapseBucket threshold: only the
// BFS neighborhood is protected; the rest collapses.
{
  const full = chain(9); // w0..w8, focus w4 depth 1 keeps w3,w4,w5 -> 6 remain (w0,w1,w2,w6,w7,w8)
  const record = buildCompactGraphFromView("run-1", full, "compact", {
    focus: "w4",
    depth: 1,
    now: "2024-01-01T00:00:00.000Z",
  });
  const keptWorkerIds = record.nodes.filter((n) => n.kind === "worker").map((n) => n.id).sort();
  assert.deepEqual(keptWorkerIds, ["w3", "w4", "w5"], "depth=1 from w4 keeps exactly w3,w4,w5 as real nodes");
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.ok(summary, "the remaining 6 out-of-neighborhood workers collapse into one synthetic bucket");
  assert.equal(summary.synthetic.collapsedNodeCount, 6, "exactly the 6 out-of-neighborhood workers collapse");
}

// depth=0 keeps ONLY the focus node itself (plus whatever else is separately protected).
{
  const full = chain(9);
  const record = buildCompactGraphFromView("run-1", full, "compact", {
    focus: "w4",
    depth: 0,
    now: "2024-01-01T00:00:00.000Z",
  });
  const keptWorkerIds = record.nodes.filter((n) => n.kind === "worker").map((n) => n.id);
  assert.deepEqual(keptWorkerIds, ["w4"], "depth=0 keeps only the focus node itself");
}

// depth defaults to 1 when options.depth is omitted (options.depth ?? 1).
{
  const full = chain(9);
  const withExplicitDepth1 = buildCompactGraphFromView("run-1", full, "compact", { focus: "w4", depth: 1, now: "x" });
  const withDefaultDepth = buildCompactGraphFromView("run-1", full, "compact", { focus: "w4", now: "x" });
  const idsA = withExplicitDepth1.nodes.filter((n) => n.kind === "worker").map((n) => n.id).sort();
  const idsB = withDefaultDepth.nodes.filter((n) => n.kind === "worker").map((n) => n.id).sort();
  assert.deepEqual(idsA, idsB, "omitting depth defaults to the same neighborhood as depth=1");
}

process.stdout.write("stateexplosion-graph-focus-depth: ok\n");
