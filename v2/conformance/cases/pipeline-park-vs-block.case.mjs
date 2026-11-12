#!/usr/bin/env node

// park vs block — two distinct stop states, both exit 2.
//
// park: a task's agent hop fails past the retry budget (maxAttempts 3).
// Each failed try is a "fulfill" step with status "failed" and attempts
// 1, 2; the third is action:"park", status:"parked", with the
// "(attempt 3/3)" suffix. The run status is "parked" and nothing commits.
//
// block: resuming that run with no agent configured reopens nothing to an
// agent: it stops at once on one "blocked" step with the fixed reason,
// never charging a new attempt to a parked task.

import path from "node:path";
import { run, gitRepo, readJson, caseMain, assert } from "../lib.mjs";

const FAIL_AGENT = path.join(import.meta.dirname, "fixtures", "stub-agent-fail.mjs");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const r = run(["-q", "prove it", "--repo", repo, "--json"], {
    env: { CW_AGENT_COMMAND: `node ${FAIL_AGENT} {{input}} {{result}}` },
  });
  assert.equal(r.status, 2);
  const parked = JSON.parse(r.stdout);
  assert.equal(parked.status, "parked");
  assert.equal(parked.completedWorkers, 0);
  assert.ok(parked.parkedWorkers > 0);
  assert.equal(parked.commitId, undefined, "a parked run must not commit");

  const mine = parked.steps.filter((s) => s.taskId === "map:server-api");
  assert.deepEqual(mine.map((s) => [s.action, s.status, s.attempts]), [
    ["fulfill", "failed", 1],
    ["fulfill", "failed", 2],
    ["park", "parked", 3],
  ]);
  assert.equal(mine[0].reason, "agent hop failed: map:server-api: failed (exit 1)");
  assert.equal(mine[2].reason, "agent hop failed: map:server-api: failed (exit 1) (attempt 3/3)");

  // Resume with no agent: blocked on one step, no new attempt charged.
  const blocked = run(["--resume", "--run", parked.runId, "--json"], { cwd: repo, env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(blocked.status, 2);
  const b = JSON.parse(blocked.stdout);
  assert.equal(b.status, "blocked");
  assert.equal(b.resumedFrom, parked.runId);
  assert.equal(b.steps.length, 1);
  assert.equal(b.steps[0].action, "blocked");
  assert.match(b.steps[0].reason, /^agent backend not configured/);
  const task = readJson(b.statePath).tasks.find((t) => t.id === "map:server-api");
  assert.equal(task.errors.length, 3, "no attempt was charged while blocked");
});
