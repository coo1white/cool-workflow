#!/usr/bin/env node
"use strict";

// Error-path and fail-closed-guard pins for the eval/replay harness:
//  - missing required args on snapshot/replay/compare give the fixed
//    "Missing ... id or path" usage strings;
//  - snapshot on an unknown run id fails closed with "File not found";
//  - eval gate on a suite dir missing all four required artifacts refuses
//    with the exact "missing required artifact(s)" message, listing exactly
//    snapshot.json, replay-run.json, comparison.json, score.json (NOT
//    report.md -- report is an output, not a gate input);
//  - eval gate on a suite dir that only has a snapshot (no replay yet)
//    refuses the same way.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = fs.realpathSync(gitRepo({ "a.txt": "hello\n" }));

  // --- missing run id on snapshot ---
  const noRunId = run(["eval", "snapshot"], { cwd: repo });
  assert.equal(noRunId.status, 1);
  assert.match(noRunId.stderr, /^cw: Missing run id\.\n/);

  // --- unknown run id on snapshot: fails closed, does not fabricate a run ---
  const unknownRun = run(["eval", "snapshot", "no-such-run-id"], { cwd: repo });
  assert.equal(unknownRun.status, 1);
  assert.match(unknownRun.stderr, /^cw: File not found: .*no-such-run-id.*state\.json\n/);

  // --- missing snapshot id/path on replay ---
  const noReplayTarget = run(["eval", "replay"], { cwd: repo });
  assert.equal(noReplayTarget.status, 1);
  assert.match(noReplayTarget.stderr, /^cw: Missing snapshot id or path\.\n/);

  // --- replay against a path that does not resolve to a real snapshot ---
  const badReplayPath = run(["eval", "replay", path.join(repo, "nope")], { cwd: repo });
  assert.equal(badReplayPath.status, 1);
  assert.match(badReplayPath.stderr, /^cw: File not found: /);

  // --- missing baseline id/path on compare ---
  const noCompareArgs = run(["eval", "compare"], { cwd: repo });
  assert.equal(noCompareArgs.status, 1);
  assert.match(noCompareArgs.stderr, /^cw: Missing baseline id or path\.\n/);

  // --- eval gate on an empty/nonexistent suite dir: all 4 named, in order,
  // report.md is NOT among the required artifacts ---
  const emptySuite = path.join(repo, "nowhere-eval-suite");
  const gateEmpty = run(["eval", "gate", emptySuite, "--json"], { cwd: repo });
  assert.equal(gateEmpty.status, 1);
  assert.match(gateEmpty.stderr, /^cw: Eval gate missing required artifact\(s\): /);
  assert.ok(gateEmpty.stderr.includes("snapshot.json"));
  assert.ok(gateEmpty.stderr.includes("replay-run.json"));
  assert.ok(gateEmpty.stderr.includes("comparison.json"));
  assert.ok(gateEmpty.stderr.includes("score.json"));
  assert.ok(!gateEmpty.stderr.includes("report.md"), "report.md is a gate OUTPUT, never a required input");

  // --- eval gate on a suite dir that has only a snapshot (no replay yet):
  // still refuses, listing only the still-missing 3 (replay/comparison/score) ---
  const runResult = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(runResult.status, 0, runResult.stderr);
  const runId = JSON.parse(runResult.stdout).runId;
  const snap = run(["eval", "snapshot", runId], { cwd: repo });
  assert.equal(snap.status, 0, snap.stderr);

  const suiteDir = path.join(repo, ".cw", "evals", `${runId}-snapshot`);
  assert.ok(fs.existsSync(path.join(suiteDir, "snapshot.json")));
  assert.ok(!fs.existsSync(path.join(suiteDir, "replay-run.json")), "replay has not been run yet");

  const gatePartial = run(["eval", "gate", suiteDir, "--json"], { cwd: repo });
  assert.equal(gatePartial.status, 1);
  assert.match(gatePartial.stderr, /^cw: Eval gate missing required artifact\(s\): /);
  assert.ok(!gatePartial.stderr.includes("snapshot.json,"), "snapshot.json already exists, so it is not in the missing list");
  assert.ok(gatePartial.stderr.includes("replay-run.json"));
  assert.ok(gatePartial.stderr.includes("comparison.json"));
  assert.ok(gatePartial.stderr.includes("score.json"));
});
