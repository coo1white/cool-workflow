#!/usr/bin/env node

// Retry accounting persisted on the task: each failed hop charges one
// attempt. A retry reuses the SAME worker folder (worker-<task>-0001) and
// puts the reason at the top of its next input.md, under "## Previous
// Attempt". At maxAttempts (3) the task parks: status "failed", attempts
// 3, two "agent-delegation-retry" errors and one "agent-delegation-parked".

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, readJson, caseMain, assert } from "../lib.mjs";

const FAIL_AGENT = path.join(import.meta.dirname, "fixtures", "stub-agent-fail.mjs");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "prove it", "--repo", repo, "--json"], {
    env: { CW_AGENT_COMMAND: `node ${FAIL_AGENT} {{input}} {{result}}` },
  });
  assert.equal(r.status, 2);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "parked");

  const task = readJson(payload.statePath).tasks.find((t) => t.id === "map:server-api");
  assert.equal(task.status, "failed");
  assert.equal(task.attempts, 3);
  assert.deepEqual(task.errors.map((e) => e.code), ["agent-delegation-retry", "agent-delegation-retry", "agent-delegation-parked"]);
  assert.equal(task.errors[2].message, "agent hop failed: map:server-api: failed (exit 1) (attempt 3/3)");
  assert.equal(task.workerId, "worker-map:server-api-0001");

  // One worker folder per task, across all three tries.
  const workersDir = path.join(path.dirname(payload.statePath), "workers");
  const mine = fs.readdirSync(workersDir).filter((w) => w.startsWith("worker-map:server-api-"));
  assert.deepEqual(mine, ["worker-map:server-api-0001"]);
  const input = fs.readFileSync(path.join(workersDir, mine[0], "input.md"), "utf8");
  assert.match(input, /## Previous Attempt\n\nCW refused the last attempt: agent hop failed: map:server-api: failed \(exit 1\)/);
  // The failing agent's stderr is kept for the person who reads the run.
  assert.match(fs.readFileSync(path.join(workersDir, mine[0], "logs", "agent-stderr.log"), "utf8"), /stub-agent-fail/);
});
