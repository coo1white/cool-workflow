#!/usr/bin/env node
"use strict";

// The eval-replay harness's whole point is to catch a broken replay. The
// documented rebuild risk is: a rebuild could make "replay" copy the
// baseline snapshot instead of re-deriving it from the raw run state, which
// would make compare/score/gate falsely report a match even when replay is
// actually broken.
//
// This case proves the OLD build does NOT do that: it takes a completed
// stub-agent run, snapshots it, then mutates the raw baseline state.json
// on disk (simulating "the real run state changed/broke") BEFORE calling
// eval replay. Because replayMultiAgentSnapshot re-reads the baseline run
// state file itself rather than copying snapshot.json, the replay output
// reflects the mutation -- and compare/score/gate all correctly flag a
// regression. A "replay copies the baseline" rebuild would instead produce
// an identical replay and a false "pass", so this case would catch it.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = fs.realpathSync(gitRepo({ "a.txt": "hello\n" }));
  const done = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(done.status, 0, done.stderr);
  const runId = JSON.parse(done.stdout).runId;

  const suiteDir = path.join(repo, ".cw", "evals", `${runId}-snapshot`);
  const snapshotPath = path.join(suiteDir, "snapshot.json");
  const replayPath = path.join(suiteDir, "replay-run.json");
  const statePath = path.join(repo, ".cw", "runs", runId, "state.json");

  // Snapshot the baseline while it is still healthy.
  const snap = run(["eval", "snapshot", runId], { cwd: repo });
  assert.equal(snap.status, 0, snap.stderr);
  assert.ok(fs.existsSync(snapshotPath));

  const snapshotBefore = readJson(snapshotPath);
  assert.ok(
    JSON.stringify(snapshotBefore.normalized.evidenceAdoption).length > 2,
    "sanity: evidence adoption section is non-trivial before mutation"
  );

  // Mutate the RAW baseline run state on disk (not the snapshot) so a
  // worker output is now missing/failed. A copy-the-baseline replay would
  // never see this; a re-deriving replay must.
  const state = readJson(statePath);
  assert.ok(Array.isArray(state.workers) && state.workers.length > 0, "run must have worker records");
  const mutatedWorkerId = state.workers[0].id;
  state.workers[0].status = "failed";
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Replay AFTER the mutation: it must reflect the mutated state, not the
  // frozen snapshot -- proof that it re-derives rather than copies.
  const replay = run(["eval", "replay", snapshotPath], { cwd: repo });
  assert.equal(replay.status, 0, replay.stderr);
  const replayPayload = readJson(replayPath);
  assert.equal(replayPayload.status, "completed", "replay itself still completes cleanly");

  const replayRaw = fs.readFileSync(replayPath, "utf8");
  assert.ok(
    replayRaw.includes(mutatedWorkerId),
    "replay output must mention the mutated worker id somewhere in its derived sections"
  );

  // --- compare must catch the mismatch: this is the critical assertion ---
  const compare = run(["eval", "compare", snapshotPath, replayPath, "--json"], { cwd: repo });
  assert.equal(compare.status, 0, compare.stderr, "compare itself still exits 0 even on a fail verdict");
  const comparePayload = JSON.parse(compare.stdout);
  assert.equal(comparePayload.status, "fail", "compare must NOT report a false match after the baseline mutated");
  assert.ok(comparePayload.findings.length > 0, "at least one regression finding must be recorded");
  assert.ok(
    comparePayload.findings.some((f) => f.severity === "error" && /^regression-/.test(f.id)),
    "findings must be shaped as regression-<section> errors"
  );

  // --- score must NOT be a perfect 31/31 ---
  const score = run(["eval", "score", replayPath, "--json"], { cwd: repo });
  assert.equal(score.status, 0, score.stderr);
  const scorePayload = JSON.parse(score.stdout);
  assert.equal(scorePayload.status, "fail");
  assert.ok(scorePayload.score < scorePayload.maxScore, "a broken replay must score below the max");
  const failedMetrics = scorePayload.metrics.filter((m) => m.status !== "pass");
  assert.ok(failedMetrics.length > 0, "at least one metric must fail");

  // --- gate must be fail-closed: verdict hold, nonzero exit ---
  const gate = run(["eval", "gate", suiteDir, "--json"], { cwd: repo });
  assert.notEqual(gate.status, 0, "eval gate must exit nonzero on a hold verdict");
  const gatePayload = JSON.parse(gate.stdout);
  assert.equal(gatePayload.verdict, "hold", "a real regression must hold the gate, never ship");
  assert.ok(gatePayload.findings.length > 0);
  assert.ok(
    gatePayload.findings.every((f) => f.severity === "error"),
    "every gate finding is an error-severity regression"
  );
});
