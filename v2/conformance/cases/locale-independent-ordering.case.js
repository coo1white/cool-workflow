#!/usr/bin/env node
"use strict";

// Locale-independent ordering (closes the D-2 finding's replay-determinism
// risk).
//
// The eval-replay harness re-derives its normalized projection from the raw
// run state at REPLAY time (rederiveNormalizedFromSnapshot,
// shell/eval-io.ts), not by copying the baseline verbatim — see
// eval-replay-detects-drift.case.js. Several of the values that projection
// sorts (state-explosion graph nodes/edges, blackboard digest entries, the
// drive's incremental cache-key task order) used to be ordered with a bare
// `localeCompare`, which reads the HOST's default locale. A baseline
// snapshot taken on one machine and replayed/compared on a machine with a
// different collation (e.g. cs_CZ.UTF-8, which orders "ch" as its own
// letter after "h") could then report a FALSE regression — the exact
// opposite of a false-green, but still a determinism-story failure: an
// operator would see `eval compare`/`eval gate` flag drift that was never
// really there.
//
// This case takes a snapshot under the harness's normal (en_US.UTF-8)
// env, then replays and compares it under cs_CZ.UTF-8 — proving the
// normalized projection (and everything downstream: compare, score, gate)
// stays byte-identical across that locale change. NOTE: this workflow's
// own task/node ids happen not to contain any character cs_CZ collates
// differently (no "ch" digraphs, no accented letters), so this specific
// case cannot itself flip red/green on the underlying bug — that proof is
// collate-stablecompare.test.js's job (adversarial "ch"/"h"/"i" strings,
// two real child processes, one per locale). What this case pins is the
// FULL pipeline: a future change that reintroduces a bare localeCompare
// anywhere in that chain will only be caught here if it also happens to
// touch an id shaped like this run's — the unit test is the one that
// cannot be fooled by convenient data.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

const CZECH_ENV = { LANG: "cs_CZ.UTF-8", LC_ALL: "cs_CZ.UTF-8" };

caseMain(() => {
  const repo = fs.realpathSync(gitRepo({ "a.txt": "hello\n" }));

  // Baseline: a real multi-task run + snapshot, under the harness's
  // normal (en_US.UTF-8) env — same recipe as eval-replay-happy-path.case.js.
  const done = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(done.status, 0, done.stderr);
  const runId = JSON.parse(done.stdout).runId;

  const suiteDir = path.join(repo, ".cw", "evals", `${runId}-snapshot`);
  const snapshotPath = path.join(suiteDir, "snapshot.json");
  const replayPath = path.join(suiteDir, "replay-run.json");

  const snap = run(["eval", "snapshot", runId, "--json"], { cwd: repo });
  assert.equal(snap.status, 0, snap.stderr);
  const snapPayload = JSON.parse(snap.stdout);
  assert.equal(snapPayload.runId, runId);
  assert.ok(fs.existsSync(snapshotPath));

  // Replay under a DIFFERENT locale than the baseline was taken under.
  // rederiveNormalizedFromSnapshot re-sorts the same underlying state.json
  // fresh here — if any sort site still used a bare localeCompare, this is
  // where cs_CZ's collation would produce a different order than the
  // baseline's en_US.UTF-8 order.
  const replay = run(["eval", "replay", snapshotPath, "--json"], { cwd: repo, env: CZECH_ENV });
  assert.equal(replay.status, 0, replay.stderr);
  const replayPayload = JSON.parse(replay.stdout);
  assert.equal(replayPayload.status, "completed");
  assert.deepEqual(replayPayload.errors, []);
  assert.ok(fs.existsSync(replayPath));

  // Compare (also run under the Czech locale, for good measure — the
  // comparator itself must not introduce its own locale dependence either).
  const compare = run(["eval", "compare", snapshotPath, replayPath, "--json"], { cwd: repo, env: CZECH_ENV });
  assert.equal(compare.status, 0, compare.stderr);
  const comparePayload = JSON.parse(compare.stdout);
  assert.equal(comparePayload.status, "pass", "a locale change alone must never produce a compare regression");
  assert.deepEqual(comparePayload.findings, [], "no findings: cs_CZ.UTF-8 replay must match the en_US.UTF-8 baseline byte-for-byte");

  // Score + gate, same locale, must both still read a clean pass — proving
  // the fix holds all the way through the harness's fail-closed gate, not
  // just at the compare step.
  const score = run(["eval", "score", replayPath, "--json"], { cwd: repo, env: CZECH_ENV });
  assert.equal(score.status, 0, score.stderr);
  const scorePayload = JSON.parse(score.stdout);
  assert.equal(scorePayload.status, "pass");
  assert.equal(scorePayload.score, scorePayload.maxScore);

  const gate = run(["eval", "gate", suiteDir, "--json"], { cwd: repo, env: CZECH_ENV });
  assert.equal(gate.status, 0, gate.stderr);
  const gatePayload = JSON.parse(gate.stdout);
  assert.equal(gatePayload.verdict, "ship", "a pure locale change must never block the eval gate");
  assert.deepEqual(gatePayload.findings, []);
});
