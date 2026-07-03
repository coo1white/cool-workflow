#!/usr/bin/env node
"use strict";

// Persist ordering differs between the success path and the error (park)
// path:
//
// Success: plan -> initial-plan checkpoint, dispatch -> dispatch:<id>
// checkpoint, accepted result -> worker:<id>:result checkpoint, terminal
// commit -> agent-delegation-drive checkpoint. Four commits in that exact
// reason order; report.md and state.json both exist and reflect "complete".
//
// Error (park): only the plan and dispatch checkpoints ever land — no
// result was ever accepted, so no worker:<id>:result commit and no
// terminal agent-delegation-drive commit exist. report.md is still
// written (reflects the parked run), but DriveResult.commitId is absent.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, stubAgentEnv, caseMain, assert } = require("../lib");

function commitReasons(runDir) {
  const dir = path.join(runDir, "commits");
  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => readJson(path.join(dir, f)).commit.reason);
}

caseMain(() => {
  // Success path.
  const okRepo = gitRepo({ "a.txt": "hello\n" });
  const okResult = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", okRepo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  assert.equal(okResult.status, 0);
  const okPayload = JSON.parse(okResult.stdout);
  assert.equal(okPayload.status, "complete");
  const okRunDir = path.dirname(okPayload.statePath);
  const okReasons = commitReasons(okRunDir);
  assert.equal(okReasons.length, 4);
  assert.equal(okReasons[0], "initial-plan");
  assert.match(okReasons[1], /^dispatch:dispatch-/);
  assert.match(okReasons[2], /^worker:worker-golden:path-\d+:result$/);
  assert.equal(okReasons[3], "agent-delegation-drive: audited verdict committed");
  assert.ok(fs.existsSync(okPayload.reportPath));
  assert.match(fs.readFileSync(okPayload.reportPath, "utf8"), /# End-to-End Golden Path/);

  // Error (park) path — a different repo, always-failing agent.
  const failRepo = gitRepo({ "a.txt": "hello\n" });
  const failAgent = path.join(__dirname, "fixtures", "stub-agent-fail.js");
  const failResult = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", failRepo, "--json"],
    { env: { CW_AGENT_COMMAND: `node ${failAgent} {{input}} {{result}}` } }
  );
  assert.equal(failResult.status, 0);
  const failPayload = JSON.parse(failResult.stdout);
  assert.equal(failPayload.status, "parked");
  assert.equal(failPayload.commitId, undefined);
  const failRunDir = path.dirname(failPayload.statePath);
  const failReasons = commitReasons(failRunDir);
  assert.equal(failReasons.length, 2, "only plan + dispatch checkpoints on the error path");
  assert.equal(failReasons[0], "initial-plan");
  assert.match(failReasons[1], /^dispatch:dispatch-/);
  assert.ok(!failReasons.some((r) => r.startsWith("worker:")), "no result commit was ever recorded");
  assert.ok(!failReasons.includes("agent-delegation-drive: audited verdict committed"));
  // report.md is still written even though the run parked.
  assert.ok(fs.existsSync(failPayload.reportPath));
});
