#!/usr/bin/env node
// stateexplosion-collapse-critical-path-extensions — pins the critical-path
// id set (run-root + linkedFailureIds), reasoningCriticalIds protection,
// and the "full" view's no-collapse guarantee.
//
// Evidence: SPEC/state-core.md "Protected — NEVER collapsed: nodes on the
// critical path (run root, ...), ... reasoning-critical nodes, and
// failure-linked nodes"; project/docs/rebuild/PLAN.md byte-compat item 9.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");

function workers(n, statusFor = () => "completed") {
  return Array.from({ length: n }, (_, i) => ({ id: `run-1:worker:w${i}`, kind: "worker", status: statusFor(i), label: `w${i}` }));
}

// criticalPath always includes the run-root id, even with no options.
{
  const full = { nodes: workers(2), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  assert.deepEqual(record.criticalPath, ["run-1:run"], "criticalPath defaults to just the run-root id");
}

// linkedFailureIds extends the critical path and protects those specific nodes from collapse.
{
  const full = { nodes: workers(8), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", {
    now: "2024-01-01T00:00:00.000Z",
    linkedFailureIds: ["run-1:worker:w3"],
  });
  assert.ok(record.criticalPath.includes("run-1:worker:w3"), "linkedFailureIds are appended into criticalPath");
  const protectedNode = record.nodes.find((n) => n.id === "run-1:worker:w3");
  assert.ok(protectedNode, "a linkedFailureIds member must remain a real node, not collapsed");
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.equal(summary.synthetic.collapsedNodeCount, 7, "only the 7 non-linked workers collapse; the linked one is excluded");
}

// reasoningCriticalIds protects a node from collapse WITHOUT adding it to criticalPath.
{
  const full = { nodes: workers(8), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", {
    now: "2024-01-01T00:00:00.000Z",
    reasoningCriticalIds: ["run-1:worker:w5"],
  });
  const protectedNode = record.nodes.find((n) => n.id === "run-1:worker:w5");
  assert.ok(protectedNode, "a reasoningCriticalIds member must remain a real node, not collapsed");
  assert.ok(!record.criticalPath.includes("run-1:worker:w5"), "reasoningCriticalIds protects from collapse but is NOT added to criticalPath itself");
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.equal(summary.synthetic.collapsedNodeCount, 7, "only the 7 non-reasoning-critical workers collapse");
}

// The "full" view NEVER collapses, regardless of bucket size.
{
  const full = { nodes: workers(20), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "full", { now: "2024-01-01T00:00:00.000Z" });
  assert.equal(record.nodes.length, 20, "the full view emits every node verbatim, never collapsed");
  assert.equal(record.nodes.filter((n) => n.kind === "summary").length, 0, "the full view has zero synthetic summary nodes");
  assert.deepEqual(record.syntheticNodes, [], "the full view's syntheticNodes list is empty");
}

// Duplicate ids across linkedFailureIds + run-root are de-duplicated (unique()).
{
  const full = { nodes: workers(2), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", {
    now: "2024-01-01T00:00:00.000Z",
    linkedFailureIds: ["run-1:run", "run-1:run"],
  });
  assert.deepEqual(record.criticalPath, ["run-1:run"], "duplicate ids (including a duplicate of the run-root) are de-duplicated");
}

process.stdout.write("stateexplosion-collapse-critical-path-extensions: ok\n");
