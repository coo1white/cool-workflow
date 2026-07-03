#!/usr/bin/env node
"use strict";

// State-explosion thresholds + collapse rules, driven WITHOUT `-q`/drive()
// (v2/PLAN.md milestone 4's own note: prefer a setup path that avoids the
// live agent-driven pipeline so this milestone stays independently
// gatable). A `state.json` with a hand-written `workers` array is written
// directly to disk (same technique as state-normalize-defaults.case.js
// and state-migration-unsupported.case.js), then `cw summary refresh`/
// `cw summary show` are driven purely through the CLI. `workers` is the
// real graph substrate `buildMultiAgentOperatorGraph` reads (each worker
// becomes one graph node; the run root is always node 1) — a fixture
// under `tasks`/`nodes` alone does not reach this behavior.
//
// Pins:
//   - DEFAULT_STATE_EXPLOSION_THRESHOLDS.graphNodes (40) and the exact
//     threshold reason string `graph has <n> nodes (> 40)`
//   - compactionRecommended flips true once the threshold is crossed
//   - collapse: a same-kind bucket of >= collapseBucket (6) collapses
//     into one synthetic `<runId>:summary:<bucket>` node in the
//     "compact" view
//   - never-collapse: a node with status "failed" among the collapsible
//     kind never disappears into the synthetic bucket (byte-compat item 9)
//   - a bucket UNDER 6 stays expanded in "compact" but collapses into
//     "critical-context:<kind>" in the "critical-path" view

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

function baseState(runId, cwd, runDir, workers) {
  return {
    schemaVersion: 1,
    id: runId,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    cwd,
    workflow: { id: "fixture-workflow", title: "Fixture Workflow", summary: "", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: {
      runDir,
      state: path.join(runDir, "state.json"),
      report: path.join(runDir, "report.md"),
      tasksDir: path.join(runDir, "tasks"),
      resultsDir: path.join(runDir, "results"),
      dispatchesDir: path.join(runDir, "dispatches"),
      artifactsDir: path.join(runDir, "artifacts"),
      commitsDir: path.join(runDir, "commits"),
      stateNodesDir: path.join(runDir, "nodes"),
      feedbackDir: path.join(runDir, "feedback"),
    },
    workers,
  };
}

function worker(id, runId, status) {
  return {
    schemaVersion: 1,
    id,
    runId,
    taskId: `t-${id}`,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    status,
    workerDir: "/tmp/w",
    inputPath: "/tmp/w/input.json",
    resultPath: "/tmp/w/result.md",
    artifactsDir: "/tmp/w/artifacts",
    logsDir: "/tmp/w/logs",
    allowedPaths: [],
    feedbackIds: [],
    errors: [],
  };
}

function writeFixture(runId, workerCount, failedIndex) {
  const repo = freshDir("repo");
  const runDir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker(`w${i}`, runId, i === failedIndex ? "failed" : "completed"));
  }
  const statePath = path.join(runDir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(baseState(runId, repo, runDir, workers), null, 2) + "\n");
  return { repo, runDir, statePath };
}

caseMain(() => {
  // --- Part 1: threshold crossed (45 workers > graphNodes threshold 40),
  // one worker marked "failed" (a never-collapse status). ---
  const runId1 = "explosion-run-1";
  const { repo: repo1 } = writeFixture(runId1, 45, 3);

  const refresh = run(["summary", "refresh", runId1, "--json"], { cwd: repo1 });
  assert.equal(refresh.status, 0);
  const index = JSON.parse(refresh.stdout);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.id, "multi-agent-summary-index");

  const show = run(["summary", "show", runId1, "--json"], { cwd: repo1 });
  assert.equal(show.status, 0);
  const report = JSON.parse(show.stdout);

  // graphNodes = 46 (1 run root + 45 workers) > 40
  assert.equal(report.stateSize.graphNodes, 46);
  assert.equal(report.stateSize.compactionRecommended, true);
  assert.ok(
    report.stateSize.reasons.includes("graph has 46 nodes (> 40)"),
    "exact threshold reason string"
  );

  // Collapse: 44 of the 45 workers (all but the failed one) collapse into
  // one synthetic "workers" bucket in the compact view; the failed worker
  // and the run root stay expanded.
  const compact = report.compactGraph;
  assert.equal(compact.fullNodeCount, 46);
  assert.equal(compact.syntheticNodes.length, 1);
  const synthetic = compact.syntheticNodes[0];
  assert.equal(synthetic.id, `${runId1}:summary:workers`);
  assert.equal(synthetic.collapsedNodeCount, 44);
  assert.equal(synthetic.dominantStatus, "completed");
  const compactIds = compact.nodes.map((n) => n.id).sort();
  assert.deepEqual(compactIds, [`${runId1}:run`, `${runId1}:summary:workers`, `${runId1}:worker:w3`].sort());

  // Never-collapse: the failed node carries its real kind/status, never a
  // synthetic wrapper.
  const failedNode = compact.nodes.find((n) => n.id === `${runId1}:worker:w3`);
  assert.ok(failedNode, "the failed worker must stay expanded, never hidden in a summary node");
  assert.equal(failedNode.status, "failed");
  assert.equal(failedNode.synthetic, undefined);

  // --- Part 2: a bucket under the collapse threshold (3 workers < 6)
  // stays expanded in "compact" but collapses in "critical-path". ---
  const runId2 = "explosion-run-2";
  const { repo: repo2 } = writeFixture(runId2, 3, -1);
  const refresh2 = run(["summary", "refresh", runId2, "--json"], { cwd: repo2 });
  assert.equal(refresh2.status, 0);
  const show2 = run(["summary", "show", runId2, "--json"], { cwd: repo2 });
  const report2 = JSON.parse(show2.stdout);

  assert.equal(report2.stateSize.graphNodes, 4);
  assert.equal(report2.stateSize.compactionRecommended, false, "4 nodes must not cross any threshold");
  assert.deepEqual(report2.stateSize.reasons, []);

  // Under-threshold bucket stays fully expanded in "compact".
  assert.equal(report2.compactGraph.syntheticNodes.length, 0);
  const compact2Ids = report2.compactGraph.nodes.map((n) => n.id).sort();
  assert.deepEqual(
    compact2Ids,
    [`${runId2}:run`, `${runId2}:worker:w0`, `${runId2}:worker:w1`, `${runId2}:worker:w2`].sort()
  );

  // Same 3-worker bucket collapses in "critical-path" (view-specific rule:
  // everything off the path collapses regardless of collapseBucket).
  const criticalGraph = report2.criticalPathGraph;
  assert.equal(criticalGraph.syntheticNodes.length, 1);
  assert.equal(criticalGraph.syntheticNodes[0].id, `${runId2}:summary:critical-context:worker`);
  assert.equal(criticalGraph.syntheticNodes[0].collapsedNodeCount, 3);
  const criticalIds = criticalGraph.nodes.map((n) => n.id).sort();
  assert.deepEqual(criticalIds, [`${runId2}:run`, `${runId2}:summary:critical-context:worker`].sort());
});
