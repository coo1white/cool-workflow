#!/usr/bin/env node
"use strict";

// Retry accounting persisted on the worker scope: a failed hop charges one
// attempt (the max of the in-memory count and the persisted retryCount).
// After parking at maxAttempts (default 3) the worker manifest carries
// retryCount:3, a terminal error with code "agent-delegation-parked", and
// the task's own state node moves to "failed" (never re-dispatched).
//
// Also: a RETRYABLE failure (not yet at the budget) reuses the SAME worker
// scope on the next step — no new dispatch/worker id is minted mid-retry.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert } = require("../lib");

const FAIL_AGENT = path.join(__dirname, "fixtures", "stub-agent-fail.js");
function failAgentEnv() {
  return { CW_AGENT_COMMAND: `node ${FAIL_AGENT} {{input}} {{result}}` };
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const env = failAgentEnv();

  // Step 1: dispatch + first failed hop (retryable, same scope next time).
  let r = run(
    ["run", "end-to-end-golden-path", "--drive", "--once", "--question", "prove it", "--repo", repo, "--json"],
    { env }
  );
  let payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "in-progress");
  const runDir = path.dirname(payload.statePath);
  const workerIdAfterStep1 = fs.readdirSync(path.join(runDir, "workers")).find((f) => f.startsWith("worker-"));
  let manifest = readJson(path.join(runDir, "workers", workerIdAfterStep1, "manifest.json"));
  assert.equal(manifest.status, "running", "a retryable failure keeps the task/worker running");
  assert.equal(manifest.metadata.agentDelegationAttempts, 1);

  // Step 2: second failed hop — SAME worker id, retryCount not yet at cap.
  r = run(["run", "--drive", "--once", "--run", payload.runId, "--json"], { cwd: repo, env });
  payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "in-progress");
  const workerIdAfterStep2 = fs.readdirSync(path.join(runDir, "workers")).find((f) => f.startsWith("worker-"));
  assert.equal(workerIdAfterStep2, workerIdAfterStep1, "retry reuses the same worker scope, no re-dispatch");
  manifest = readJson(path.join(runDir, "workers", workerIdAfterStep1, "manifest.json"));
  assert.equal(manifest.metadata.agentDelegationAttempts, 2);

  // Step 3: third failure hits the retry budget (default maxAttempts 3) and
  // parks — the worker manifest now records the terminal state.
  r = run(["run", "--drive", "--once", "--run", payload.runId, "--json"], { cwd: repo, env });
  payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "parked");
  manifest = readJson(path.join(runDir, "workers", workerIdAfterStep1, "manifest.json"));
  assert.equal(manifest.status, "failed");
  assert.equal(manifest.retryCount, 3);
  assert.equal(manifest.errors.length, 1);
  assert.equal(manifest.errors[0].code, "agent-delegation-parked");
  assert.equal(manifest.errors[0].retryable, false);
  assert.equal(
    manifest.errors[0].message,
    "agent hop failed: golden:path: failed (exit 1) (attempt 3/3)"
  );

  // Only ONE worker/dispatch was ever created across all three steps.
  const allWorkers = fs.readdirSync(path.join(runDir, "workers")).filter((f) => f.startsWith("worker-"));
  assert.equal(allWorkers.length, 1);
  const allDispatches = fs.readdirSync(path.join(runDir, "dispatches"));
  assert.equal(allDispatches.length, 1);
});
