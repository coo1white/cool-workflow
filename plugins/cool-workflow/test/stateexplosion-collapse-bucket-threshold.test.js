#!/usr/bin/env node
// stateexplosion-collapse-bucket-threshold — pins the collapseBucket (6)
// rule: a bucket of a collapsible kind smaller than 6 stays fully
// expanded, EXCEPT in the critical-path view where everything off-path
// collapses into a bucket regardless of size.
//
// Evidence: SPEC/state-core.md "A bucket smaller than collapseBucket (6)
// stays expanded — except in the critical-path view, where everything off
// the path collapses into one bucket per kind named critical-context:<kind>";
// project/docs/rebuild/PLAN.md byte-compat item 9.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");
const { DEFAULT_STATE_EXPLOSION_THRESHOLDS } = require("../dist/core/state/state-explosion/size");

function workers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `run-1:worker:w${i}`, kind: "worker", status: "completed", label: `w${i}` }));
}

// Exactly 5 (< 6 threshold): compact view leaves them fully expanded.
{
  const full = { nodes: workers(5), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  assert.equal(record.nodes.length, 5, "a bucket of 5 (under threshold 6) stays fully expanded in compact view");
  assert.equal(record.nodes.filter((n) => n.kind === "summary").length, 0, "no synthetic summary node for an under-threshold bucket");
}

// Exactly 6 (== threshold): DOES collapse (threshold is inclusive: ids.length < collapseBucket stays expanded, so 6 collapses).
{
  const full = { nodes: workers(6), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.ok(summary, "a bucket of exactly 6 (== collapseBucket threshold) DOES collapse");
  assert.equal(summary.synthetic.collapsedNodeCount, 6, "all 6 nodes collapse at the threshold boundary");
}

// 5 vs 6 boundary re-confirmed with an explicit custom threshold, to prove
// the comparison is ids.length < thresholds.collapseBucket (strict less-than).
{
  const customThresholds = { ...DEFAULT_STATE_EXPLOSION_THRESHOLDS, collapseBucket: 3 };
  const under = buildCompactGraphFromView("run-1", { nodes: workers(2), edges: [] }, "compact", { thresholds: customThresholds, now: "2024-01-01T00:00:00.000Z" });
  assert.equal(under.nodes.filter((n) => n.kind === "summary").length, 0, "with collapseBucket=3, a bucket of 2 stays expanded");
  const atThreshold = buildCompactGraphFromView("run-1", { nodes: workers(3), edges: [] }, "compact", { thresholds: customThresholds, now: "2024-01-01T00:00:00.000Z" });
  assert.equal(atThreshold.nodes.filter((n) => n.kind === "summary").length, 1, "with collapseBucket=3, a bucket of exactly 3 collapses");
}

// Critical-path view: even a bucket of ONLY 2 off-path workers collapses
// (the size threshold is bypassed entirely in this view).
{
  const full = { nodes: workers(2), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "critical-path", { now: "2024-01-01T00:00:00.000Z" });
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.ok(summary, "critical-path view collapses off-path nodes regardless of bucket size, even just 2");
  assert.equal(summary.synthetic.collapsedNodeCount, 2, "both off-path workers collapse into the one critical-path bucket");
  assert.ok(summary.id.includes("critical-context"), "critical-path bucket id uses the critical-context:<kind> naming");
}

// Critical-path view: bucket key is exactly "critical-context:<kind>" (slugified).
{
  const full = { nodes: workers(2), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "critical-path", { now: "2024-01-01T00:00:00.000Z" });
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.equal(summary.id, "run-1:summary:critical-context:worker", "critical-path synthetic node id is run-1:summary:critical-context:<kind>");
}

process.stdout.write("stateexplosion-collapse-bucket-threshold: ok\n");
