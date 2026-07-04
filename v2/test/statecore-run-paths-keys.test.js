#!/usr/bin/env node
// statecore-run-paths-keys (milestone 3) — pins createRunPaths' full
// RunPaths key set against SPEC/state-core.md's "createRunPaths(runDir)"
// (16 keys, all joined under runDir).

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRunPaths } = require("../dist/core/state/run-paths");

// Exact 16-key set (runDir + 15 derived paths).
{
  const paths = createRunPaths("/repo/.cw/runs/demo-run");
  const keys = Object.keys(paths).sort();
  assert.deepEqual(
    keys,
    [
      "artifactsDir",
      "auditDir",
      "blackboardDir",
      "candidatesDir",
      "commitsDir",
      "dispatchesDir",
      "feedbackDir",
      "multiAgentDir",
      "report",
      "resultsDir",
      "runDir",
      "state",
      "stateNodesDir",
      "tasksDir",
      "topologiesDir",
      "workersDir",
    ].sort(),
    "RunPaths must carry exactly the 16 documented keys"
  );
}

// Every path is joined under runDir.
{
  const runDir = "/repo/.cw/runs/demo-run";
  const paths = createRunPaths(runDir);
  for (const [key, value] of Object.entries(paths)) {
    if (key === "runDir") continue;
    assert.ok(value.startsWith(runDir), `${key} must be joined under runDir, got ${value}`);
  }
}

// Exact sub-path names.
{
  const runDir = "/repo/.cw/runs/demo-run";
  const paths = createRunPaths(runDir);
  assert.equal(paths.state, path.join(runDir, "state.json"));
  assert.equal(paths.report, path.join(runDir, "report.md"));
  assert.equal(paths.tasksDir, path.join(runDir, "tasks"));
  assert.equal(paths.resultsDir, path.join(runDir, "results"));
  assert.equal(paths.dispatchesDir, path.join(runDir, "dispatches"));
  assert.equal(paths.artifactsDir, path.join(runDir, "artifacts"));
  assert.equal(paths.commitsDir, path.join(runDir, "commits"));
  assert.equal(paths.stateNodesDir, path.join(runDir, "nodes"));
  assert.equal(paths.feedbackDir, path.join(runDir, "feedback"));
  assert.equal(paths.auditDir, path.join(runDir, "audit"));
  assert.equal(paths.workersDir, path.join(runDir, "workers"));
  assert.equal(paths.candidatesDir, path.join(runDir, "candidates"));
  assert.equal(paths.multiAgentDir, path.join(runDir, "multi-agent"));
  assert.equal(paths.blackboardDir, path.join(runDir, "blackboard"));
  assert.equal(paths.topologiesDir, path.join(runDir, "topologies"));
}

// Pure path math: no filesystem touched, works for a nonexistent dir too.
{
  const paths = createRunPaths("/does/not/exist/on/disk/.cw/runs/x");
  assert.equal(paths.runDir, "/does/not/exist/on/disk/.cw/runs/x");
}

// Different runDir inputs never collide.
{
  const a = createRunPaths("/repo/.cw/runs/run-a");
  const b = createRunPaths("/repo/.cw/runs/run-b");
  assert.notEqual(a.state, b.state, "different run dirs must produce different state paths");
}

process.stdout.write("statecore-run-paths-keys: ok\n");
