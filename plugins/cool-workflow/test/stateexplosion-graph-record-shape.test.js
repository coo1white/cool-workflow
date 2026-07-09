#!/usr/bin/env node
// stateexplosion-graph-record-shape — pins buildCompactGraphFromView's
// GraphSummaryRecord byte-exact fields: id format, sourceFingerprint
// format, generatedAt honoring the passed clock, and nextAction switching
// on whether anything collapsed.
//
// Evidence: SPEC/state-core.md "buildCompactGraph(...) — returns a
// GraphSummaryRecord"; graph.ts's finalizeGraphRecord.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");
const { fingerprintStrings } = require("../dist/core/hash");

// id format: "graph-<view>" with no focus.
{
  const record = buildCompactGraphFromView("run-1", { nodes: [], edges: [] }, "compact", { now: "2024-01-01T00:00:00.000Z" });
  assert.equal(record.id, "graph-compact", "record id is graph-<view> with no focus");
  assert.equal(record.runId, "run-1", "runId is passed through verbatim");
  assert.equal(record.scope, "run", "scope is always 'run'");
  assert.equal(record.schemaVersion, 1, "schemaVersion is 1");
}

// id format WITH focus: "graph-<view>:focus:<slug(focus)>".
{
  const record = buildCompactGraphFromView("run-1", { nodes: [], edges: [] }, "compact", { focus: "some node!", now: "x" });
  assert.equal(record.id, "graph-compact:focus:some-node-", "record id with focus appends :focus:<slug(focus)>");
}

// generatedAt: takes options.now verbatim — the clock is a PURE parameter,
// never Date.now() when supplied.
{
  const record = buildCompactGraphFromView("run-1", { nodes: [], edges: [] }, "compact", { now: "1999-12-31T23:59:59.000Z" });
  assert.equal(record.generatedAt, "1999-12-31T23:59:59.000Z", "generatedAt must echo the exact 'now' clock value passed in, not the real clock");
}

// sourceFingerprint: fingerprintStrings(["<id>:<status>", ...]) over full.nodes.
{
  const full = {
    nodes: [
      { id: "a", kind: "task", status: "completed", label: "a" },
      { id: "b", kind: "task", status: "failed", label: "b" },
    ],
    edges: [],
  };
  const record = buildCompactGraphFromView("run-1", full, "full", { now: "x" });
  const expected = fingerprintStrings(["a:completed", "b:failed"]);
  assert.equal(record.sourceFingerprint, expected, "sourceFingerprint is fingerprintStrings of '<id>:<status>' lines over the FULL (unfiltered) node set");
}

// sourceRecordIds: sorted ids of the full node set, regardless of view scoping.
{
  const full = {
    nodes: [
      { id: "z", kind: "task", status: "completed", label: "z" },
      { id: "a", kind: "task", status: "completed", label: "a" },
    ],
    edges: [],
  };
  const record = buildCompactGraphFromView("run-1", full, "full", { now: "x" });
  assert.deepEqual(record.sourceRecordIds, ["a", "z"], "sourceRecordIds is the sorted id list of the FULL node set");
}

// nextAction: when nothing collapsed, points at the same view; when
// something collapsed, points at --view full instead.
{
  const noCollapse = buildCompactGraphFromView("run-1", { nodes: [{ id: "a", kind: "task", status: "completed", label: "a" }], edges: [] }, "compact", { now: "x" });
  assert.equal(noCollapse.nextAction, "cw multi-agent graph run-1 --view compact --json", "no collapse: nextAction points at the same view");

  const workers = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, kind: "worker", status: "completed", label: `w${i}` }));
  const withCollapse = buildCompactGraphFromView("run-1", { nodes: workers, edges: [] }, "compact", { now: "x" });
  assert.equal(withCollapse.nextAction, "cw multi-agent graph run-1 --view full --json", "with collapse: nextAction redirects to --view full");
}

// fullNodeCount/fullEdgeCount reflect the UNFILTERED input; compactNodeCount/compactEdgeCount reflect the scoped+collapsed output.
{
  const workers = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, kind: "worker", status: "completed", label: `w${i}` }));
  const record = buildCompactGraphFromView("run-1", { nodes: workers, edges: [] }, "compact", { now: "x" });
  assert.equal(record.fullNodeCount, 10, "fullNodeCount is the raw input node count");
  assert.equal(record.compactNodeCount, 1, "compactNodeCount is 1 synthetic summary node after full collapse");
  assert.equal(record.collapsedNodeCount, 10, "collapsedNodeCount sums every synthetic node's collapsedNodeCount");
  assert.equal(record.includedCount, record.compactNodeCount, "includedCount mirrors compactNodeCount");
  assert.equal(record.omittedCount, record.collapsedNodeCount, "omittedCount mirrors collapsedNodeCount");
}

// deterministic:true, status:"valid" are constant literals.
{
  const record = buildCompactGraphFromView("run-1", { nodes: [], edges: [] }, "compact", { now: "x" });
  assert.equal(record.deterministic, true, "deterministic is always true");
  assert.equal(record.status, "valid", "status is always 'valid' for a freshly-built graph record");
}

process.stdout.write("stateexplosion-graph-record-shape: ok\n");
