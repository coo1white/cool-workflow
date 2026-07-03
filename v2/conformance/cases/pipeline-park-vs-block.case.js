#!/usr/bin/env node
"use strict";

// park vs block — two distinct terminal-ish drive states.
//
// park: a task's agent hop fails past the retry budget (default maxAttempts
// 3). recordWorkerFailure marks the task/worker "failed"; the step is
// action:"park", status:"parked"; DriveResult.status becomes "parked".
//
// block: driving further on a run that has a parked/failed task in an
// incomplete phase finds no eligible worker (nothing pending/running, not
// everything completed) and stops with the FIXED reason string
// "no eligible worker (a parked/failed worker blocks the phase gate)" —
// action/status "blocked", never re-attempting the parked task.

const path = require("node:path");
const { run, gitRepo, caseMain, assert } = require("../lib");

const FAIL_AGENT = path.join(__dirname, "fixtures", "stub-agent-fail.js");
function failAgentEnv() {
  return { CW_AGENT_COMMAND: `node ${FAIL_AGENT} {{input}} {{result}}` };
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  // A single-task app driven with an agent that always fails: 3 attempts,
  // then park. attempts count up 1, 2, 3; the last reason carries the
  // "(attempt n/max)" suffix.
  const r = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: failAgentEnv() }
  );
  assert.equal(r.status, 0);
  const parked = JSON.parse(r.stdout);
  assert.equal(parked.status, "parked");
  assert.equal(parked.parkedWorkers, 1);
  assert.equal(parked.completedWorkers, 0);
  assert.equal(parked.commitId, undefined, "a parked run must not commit");

  const fulfillSteps = parked.steps.filter((s) => s.action === "fulfill");
  assert.deepEqual(
    fulfillSteps.map((s) => s.attempts),
    [1, 2]
  );
  for (const s of fulfillSteps) {
    assert.equal(s.status, "failed");
    assert.equal(s.reason, "agent hop failed: golden:path: failed (exit 1)");
  }
  const parkStep = parked.steps[parked.steps.length - 1];
  assert.equal(parkStep.action, "park");
  assert.equal(parkStep.status, "parked");
  assert.equal(parkStep.attempts, 3);
  assert.equal(parkStep.reason, "agent hop failed: golden:path: failed (exit 1) (attempt 3/3)");

  // Driving the SAME parked run again must not retry the task — it must
  // block on the phase gate with the exact fixed reason string, one step.
  const blocked = run(["run", "--drive", "--once", "--run", parked.runId, "--json"], {
    cwd: repo,
    env: failAgentEnv(),
  });
  assert.equal(blocked.status, 0);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  assert.equal(blockedPayload.steps.length, 1);
  assert.equal(blockedPayload.steps[0].action, "blocked");
  assert.equal(blockedPayload.steps[0].status, "blocked");
  assert.equal(
    blockedPayload.steps[0].reason,
    "no eligible worker (a parked/failed worker blocks the phase gate)"
  );
  // parkedWorkers is still 1 — no new attempt was charged.
  assert.equal(blockedPayload.parkedWorkers, 1);
});
