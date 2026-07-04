#!/usr/bin/env node
// stateexplosion-report-computestatesize — pins report.ts's computeStateSize
// (the one-arg WorkflowRun wrapper around computeStateSizeWithGraph, built
// via runToGraphViewFromWorkflowRun) and shouldCompactRun's pure decision.
//
// Evidence: SPEC/state-core.md "computeStateSize(run, thresholds?)";
// size.ts's own header note on why the one-arg wrapper lives in report.ts
// (avoids a size.ts <-> graph.ts import cycle).

const assert = require("node:assert/strict");
const { computeStateSize, shouldCompactRun } = require("../dist/core/state/state-explosion/report");
const { DEFAULT_STATE_EXPLOSION_THRESHOLDS } = require("../dist/core/state/state-explosion/size");

function minimalRun(overrides = {}) {
  return {
    id: "run-1",
    loopStage: "interpret",
    paths: { state: "/run-1/state.json" },
    tasks: [],
    dispatches: [],
    commits: [],
    ...overrides,
  };
}

// computeStateSize builds the graph view itself (graphNodes includes at
// least the run-root) and returns the same shape as computeStateSizeWithGraph.
{
  const size = computeStateSize(minimalRun());
  assert.equal(size.graphNodes, 1, "computeStateSize's derived graph has exactly the run-root node with no tasks");
  assert.equal(size.total, 0, "a run with no multiAgent/blackboard arrays has total 0");
  assert.equal(size.compactionRecommended, false, "a tiny run does not recommend compaction");
}

// computeStateSize honors an explicit thresholds argument.
{
  const run = minimalRun({ tasks: Array.from({ length: 45 }, (_, i) => ({ id: `t${i}`, status: "completed", taskPath: `/t${i}.json` })) });
  // 45 tasks + 1 run-root = 46 graph nodes, over the default 40.
  const size = computeStateSize(run);
  assert.ok(size.graphNodes > DEFAULT_STATE_EXPLOSION_THRESHOLDS.graphNodes, "45 tasks + root produces more graph nodes than the default threshold");
  assert.equal(size.compactionRecommended, true, "crossing the default graphNodes threshold recommends compaction");

  const relaxed = computeStateSize(run, { ...DEFAULT_STATE_EXPLOSION_THRESHOLDS, graphNodes: 1000 });
  assert.equal(relaxed.compactionRecommended, false, "a relaxed custom threshold no longer recommends compaction for the same run");
}

// shouldCompactRun is the pure boolean decision half of maybeCompactRun:
// true exactly when computeStateSize(...).compactionRecommended is true.
{
  const smallRun = minimalRun();
  assert.equal(shouldCompactRun(smallRun), false, "shouldCompactRun is false for a run under every threshold");

  const bigRun = minimalRun({ tasks: Array.from({ length: 45 }, (_, i) => ({ id: `t${i}`, status: "completed", taskPath: `/t${i}.json` })) });
  assert.equal(shouldCompactRun(bigRun), true, "shouldCompactRun is true once a threshold is crossed");
}

// shouldCompactRun honors a custom thresholds argument too.
{
  const bigRun = minimalRun({ tasks: Array.from({ length: 45 }, (_, i) => ({ id: `t${i}`, status: "completed", taskPath: `/t${i}.json` })) });
  assert.equal(
    shouldCompactRun(bigRun, { ...DEFAULT_STATE_EXPLOSION_THRESHOLDS, graphNodes: 1000 }),
    false,
    "shouldCompactRun with a relaxed threshold returns false for the same run that triggered it by default"
  );
}

process.stdout.write("stateexplosion-report-computestatesize: ok\n");
