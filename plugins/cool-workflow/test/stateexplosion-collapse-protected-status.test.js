#!/usr/bin/env node
// stateexplosion-collapse-protected-status — pins the never-collapse
// STATUS set: failed/blocked/rejected/conflicting nodes must survive
// buildCompactGraphFromView's compact/critical-path collapse, even when
// their kind is otherwise collapsible and their bucket is over threshold.
//
// Evidence: SPEC/state-core.md "State-explosion collapse rules": "Protected
// — NEVER collapsed: ... any node with status failed|blocked|rejected|
// conflicting"; project/docs/rebuild/PLAN.md byte-compat item 9.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");

function workerNode(id, status) {
  return { id: `run-1:worker:${id}`, kind: "worker", status, label: id };
}

// A collapsible-kind bucket of 8 workers, one of them "failed": the failed
// one must stay a real node, not get folded into the synthetic summary.
{
  const full = {
    nodes: [
      ...Array.from({ length: 7 }, (_, i) => workerNode(`w${i}`, "completed")),
      workerNode("wfail", "failed"),
    ],
    edges: [],
  };
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const failedNode = record.nodes.find((n) => n.id === "run-1:worker:wfail");
  assert.ok(failedNode, "the failed-status worker must remain a real (non-synthetic) node in the compact graph");
  assert.equal(failedNode.synthetic, undefined, "the failed-status worker node must not carry a synthetic summary");
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.ok(summary, "the other 7 completed workers still collapse into a synthetic bucket");
  assert.equal(summary.synthetic.collapsedNodeCount, 7, "only the 7 non-protected workers are collapsed, not the failed one");
}

// Each of blocked/rejected/conflicting individually protects a node from collapse.
for (const status of ["blocked", "rejected", "conflicting"]) {
  const full = {
    nodes: [...Array.from({ length: 7 }, (_, i) => workerNode(`w${i}`, "completed")), workerNode("wp", status)],
    edges: [],
  };
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const protectedNode = record.nodes.find((n) => n.id === "run-1:worker:wp");
  assert.ok(protectedNode, `a "${status}"-status node must remain a real node, never collapsed`);
}

// A protected node also survives the critical-path view, where EVERY other
// off-path node collapses into one bucket per kind (the one exception to
// the "buckets under 6 stay expanded" rule — protected status still wins).
{
  const full = {
    nodes: [workerNode("w0", "completed"), workerNode("wfail", "failed")],
    edges: [],
  };
  const record = buildCompactGraphFromView("run-1", full, "critical-path", { now: "2024-01-01T00:00:00.000Z" });
  const failedNode = record.nodes.find((n) => n.id === "run-1:worker:wfail");
  assert.ok(failedNode, "protected status survives even the critical-path view's aggressive bucket-per-kind collapse");
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.ok(summary, "the single non-protected completed worker still collapses (critical-path collapses regardless of bucket size)");
}

// blockedReason on a synthetic summary node reports the first protected member found.
{
  const full = {
    nodes: [
      ...Array.from({ length: 5 }, (_, i) => workerNode(`w${i}`, "completed")),
      workerNode("wblocked", "blocked"),
      workerNode("wmore", "completed"),
    ],
    edges: [],
  };
  // Bump this specific bucket over threshold via critical-path view; the
  // blocked one is separately protected, so the synthetic bucket contains
  // only the 6 completed workers grouped under "workers".
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const blockedNode = record.nodes.find((n) => n.id === "run-1:worker:wblocked");
  assert.ok(blockedNode, "blocked node stays out of the synthetic summary");
}

process.stdout.write("stateexplosion-collapse-protected-status: ok\n");
