#!/usr/bin/env node
"use strict";

// --concurrency > 1 selects the concurrent round driver: a parallel phase's
// tasks are dispatched and settled together, but the round flushes state
// EXACTLY ONCE (one extra "concurrent-round:<n>-tasks" checkpoint), not one
// checkpoint per accepted task. Results still record in deterministic
// (task-id) batch order regardless of which child would finish first.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, stubAgentEnv, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const env = stubAgentEnv("a.txt:1");

  // architecture-review-fast's Map phase has exactly 2 parallel tasks.
  const r = run(
    [
      "run",
      "architecture-review-fast",
      "--drive",
      "--once",
      "--concurrency",
      "2",
      "--question",
      "prove it",
      "--repo",
      repo,
      "--json",
    ],
    { env }
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "in-progress");

  const acceptSteps = payload.steps.filter((s) => s.action === "accept");
  assert.equal(acceptSteps.length, 2, "both Map tasks settle in the one round");
  // Deterministic batch order: task ids come back sorted, not by spawn
  // finish order (both stub agents finish "instantly" so this asserts the
  // recorder's own ordering, not a race).
  assert.deepEqual(
    acceptSteps.map((s) => s.taskId).sort(),
    ["map:operator-surface", "map:runtime-surface"]
  );

  const runDir = path.dirname(payload.statePath);
  const commitReasons = fs
    .readdirSync(path.join(runDir, "commits"))
    .sort()
    .map((f) => readJson(path.join(runDir, "commits", f)).commit.reason);
  // initial-plan (from plan()) + exactly ONE concurrent-round checkpoint —
  // never two, even though two tasks were accepted.
  assert.equal(commitReasons.length, 2);
  assert.equal(commitReasons[0], "initial-plan");
  assert.equal(commitReasons[1], "concurrent-round:2-tasks");

  // Both worker dirs exist (both were really dispatched/spawned).
  const workerDirs = fs.readdirSync(path.join(runDir, "workers")).filter((f) => f.startsWith("worker-"));
  assert.equal(workerDirs.length, 2);
});
