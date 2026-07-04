#!/usr/bin/env node
// stateexplosion-size-thresholds — pins DEFAULT_STATE_EXPLOSION_THRESHOLDS
// and computeStateSizeWithGraph's 12-category counting, total, reasons,
// and compactionRecommended flag.
//
// Evidence: SPEC/state-core.md "computeStateSize(run, thresholds?) /
// computeStateSizeWithGraph(...)" and "DEFAULT_STATE_EXPLOSION_THRESHOLDS".

const assert = require("node:assert/strict");
const {
  STATE_EXPLOSION_SCHEMA_VERSION,
  DEFAULT_STATE_EXPLOSION_THRESHOLDS,
  computeStateSizeWithGraph,
} = require("../dist/core/state/state-explosion/size");

// STATE_EXPLOSION_SCHEMA_VERSION is pinned at 1.
{
  assert.equal(STATE_EXPLOSION_SCHEMA_VERSION, 1, "STATE_EXPLOSION_SCHEMA_VERSION must be 1");
}

// DEFAULT_STATE_EXPLOSION_THRESHOLDS exact literal values (SPEC/state-core.md).
{
  assert.deepEqual(
    DEFAULT_STATE_EXPLOSION_THRESHOLDS,
    {
      graphNodes: 40,
      graphEdges: 60,
      blackboardMessages: 25,
      blackboardRecords: 40,
      collapseBucket: 6,
      totalRecords: 80,
    },
    "DEFAULT_STATE_EXPLOSION_THRESHOLDS must match the SPEC's literal thresholds object"
  );
}

// Empty run + empty graph: every count is 0, no reasons, not recommended.
{
  const size = computeStateSizeWithGraph({}, DEFAULT_STATE_EXPLOSION_THRESHOLDS, { nodes: [], edges: [] });
  assert.equal(size.multiAgentRuns, 0, "empty run: multiAgentRuns is 0");
  assert.equal(size.roles, 0, "empty run: roles is 0");
  assert.equal(size.groups, 0, "empty run: groups is 0");
  assert.equal(size.memberships, 0, "empty run: memberships is 0");
  assert.equal(size.fanouts, 0, "empty run: fanouts is 0");
  assert.equal(size.fanins, 0, "empty run: fanins is 0");
  assert.equal(size.topics, 0, "empty run: topics is 0");
  assert.equal(size.messages, 0, "empty run: messages is 0");
  assert.equal(size.contexts, 0, "empty run: contexts is 0");
  assert.equal(size.artifacts, 0, "empty run: artifacts is 0");
  assert.equal(size.snapshots, 0, "empty run: snapshots is 0");
  assert.equal(size.decisions, 0, "empty run: decisions is 0");
  assert.equal(size.total, 0, "empty run: total is 0");
  assert.equal(size.graphNodes, 0, "empty run: graphNodes is 0");
  assert.equal(size.graphEdges, 0, "empty run: graphEdges is 0");
  assert.deepEqual(size.reasons, [], "empty run: no reasons");
  assert.equal(size.compactionRecommended, false, "empty run: compaction not recommended");
}

// total is the exact sum of the 12 record categories (graphNodes/graphEdges excluded).
{
  const run = {
    multiAgent: { runs: [1], roles: [1, 2], groups: [1, 2, 3], memberships: [1], fanouts: [1], fanins: [1] },
    blackboard: { topics: [1], messages: [1, 2], contexts: [1], artifacts: [1], snapshots: [1], decisions: [1] },
  };
  const size = computeStateSizeWithGraph(run, DEFAULT_STATE_EXPLOSION_THRESHOLDS, { nodes: [1, 2, 3, 4], edges: [1, 2] });
  // 1 + 2 + 3 + 1 + 1 + 1 + 1 + 2 + 1 + 1 + 1 + 1 = 16
  assert.equal(size.total, 16, "total must be exact sum of the 12 record categories");
  assert.equal(size.graphNodes, 4, "graphNodes reflects the graph view's node count");
  assert.equal(size.graphEdges, 2, "graphEdges reflects the graph view's edge count");
  assert.equal(size.compactionRecommended, false, "17 records under every threshold: no compaction");
}

// Exact reason strings, one per crossed threshold, sorted.
{
  const run = {
    blackboard: { messages: new Array(26).fill(0) },
  };
  const thresholds = DEFAULT_STATE_EXPLOSION_THRESHOLDS;
  const size = computeStateSizeWithGraph(run, thresholds, { nodes: new Array(41).fill(0), edges: new Array(61).fill(0) });
  assert.ok(size.reasons.includes("graph has 41 nodes (> 40)"), "graphNodes threshold reason exact string");
  assert.ok(size.reasons.includes("graph has 61 edges (> 60)"), "graphEdges threshold reason exact string");
  assert.ok(size.reasons.includes("blackboard has 26 messages (> 25)"), "blackboardMessages threshold reason exact string");
  assert.deepEqual(size.reasons, [...size.reasons].sort(), "reasons must be sorted");
  assert.equal(size.compactionRecommended, true, "crossing a threshold recommends compaction");
}

// blackboardRecords reason: sum of the 6 blackboard categories crossing 40.
{
  const run = {
    blackboard: { topics: new Array(41).fill(0) },
  };
  const size = computeStateSizeWithGraph(run, DEFAULT_STATE_EXPLOSION_THRESHOLDS, { nodes: [], edges: [] });
  assert.ok(
    size.reasons.some((r) => r === "blackboard has 41 records (> 40)"),
    "blackboardRecords reason uses the summed count across all 6 blackboard categories"
  );
}

// totalRecords reason: sum of all 12 categories crossing 80.
{
  const run = {
    multiAgent: { runs: new Array(81).fill(0) },
  };
  const size = computeStateSizeWithGraph(run, DEFAULT_STATE_EXPLOSION_THRESHOLDS, { nodes: [], edges: [] });
  assert.ok(
    size.reasons.some((r) => r === "run has 81 multi-agent records (> 80)"),
    "totalRecords reason uses the summed count across all 12 categories"
  );
}

// Boundary: exactly at threshold does NOT trigger (strictly greater-than).
{
  const run = { blackboard: { messages: new Array(25).fill(0) } };
  const size = computeStateSizeWithGraph(run, DEFAULT_STATE_EXPLOSION_THRESHOLDS, { nodes: [], edges: [] });
  assert.deepEqual(size.reasons, [], "exactly at threshold (25 messages) must NOT trigger a reason");
  assert.equal(size.compactionRecommended, false, "at-threshold count is not compaction-recommended");
}

// Custom thresholds are honored instead of the defaults.
{
  const run = { blackboard: { messages: [1, 2, 3] } };
  const custom = { ...DEFAULT_STATE_EXPLOSION_THRESHOLDS, blackboardMessages: 2 };
  const size = computeStateSizeWithGraph(run, custom, { nodes: [], edges: [] });
  assert.ok(size.reasons.includes("blackboard has 3 messages (> 2)"), "custom threshold must be honored over the default");
}

process.stdout.write("stateexplosion-size-thresholds: ok\n");
