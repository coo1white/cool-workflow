#!/usr/bin/env node
"use strict";

// Absent-vs-corrupt telemetry asymmetry (ledger-trust.md Rebuild risk #4).
// An absent telemetry.json is a clean, empty-verifying chain: present:false,
// verified:true, exit 0. A PRESENT but hand-corrupted (unparseable) one must
// be reported as corrupt and FAIL -- never silently verify green. Reading
// them the same way was a real bug in the old build's history (an append
// could re-genesis over a poisoned file); this case pins the read-side half
// of that fix. Only a run's state.json + (optionally) telemetry.json are
// used -- both files the CLI itself would write, built by hand here the
// same way state-ledger-trust.case.js hand-builds ledger entries.

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

function makeRunDir(runId) {
  const repo = freshDir("repo");
  const runDir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ schemaVersion: 1, runId }));
  return { repo, runDir };
}

caseMain(() => {
  // --- absent telemetry.json: clean empty chain, exit 0 ---
  const absentRunId = "absent-telemetry-run";
  const { repo: absentRepo } = makeRunDir(absentRunId);
  // deliberately do NOT write telemetry.json at all

  const absentVerify = run(["telemetry", "verify", absentRunId, "--json"], { cwd: absentRepo });
  assert.equal(absentVerify.status, 0, "an absent ledger must exit 0, never fail-closed on nothing");
  const absentResult = JSON.parse(absentVerify.stdout);
  assert.equal(absentResult.present, false);
  assert.equal(absentResult.verified, true);
  assert.equal(absentResult.records, 0);
  assert.deepEqual(absentResult.failedChecks, []);

  // the human render must say so explicitly, not just print a bare "verified"
  const absentHuman = run(["telemetry", "verify", absentRunId], { cwd: absentRepo });
  assert.equal(absentHuman.status, 0);
  assert.match(absentHuman.stdout, /has no attestation ledger \(nothing to verify\)/);

  // --- present but hand-corrupted telemetry.json: must FAIL, never verify green ---
  const corruptRunId = "corrupt-telemetry-run";
  const { repo: corruptRepo, runDir: corruptRunDir } = makeRunDir(corruptRunId);
  // not valid JSON at all -- a hand-corrupted overlay, the exact shape a
  // half-written or disk-damaged file would take.
  fs.writeFileSync(path.join(corruptRunDir, "telemetry.json"), "{ not valid json at all !!");

  const corruptVerify = run(["telemetry", "verify", corruptRunId, "--json"], { cwd: corruptRepo });
  assert.equal(corruptVerify.status, 1, "a present-but-corrupt ledger must fail closed, exit 1");
  const corruptResult = JSON.parse(corruptVerify.stdout);
  assert.equal(corruptResult.present, true, "corrupt is present:true -- distinct from absent");
  assert.equal(corruptResult.verified, false);
  assert.equal(corruptResult.records, 0);
  assert.equal(corruptResult.failedChecks.length, 1);
  assert.equal(corruptResult.failedChecks[0].name, "ledger-load");
  assert.equal(corruptResult.failedChecks[0].code, "telemetry-ledger-corrupt");

  // the human render for a corrupt ledger must show tampering language, never
  // the same "nothing to verify" text an absent ledger gets.
  const corruptHuman = run(["telemetry", "verify", corruptRunId], { cwd: corruptRepo });
  assert.equal(corruptHuman.status, 1);
  assert.doesNotMatch(corruptHuman.stdout, /nothing to verify/);
  assert.match(corruptHuman.stdout, /TAMPERING DETECTED|check\(s\) failed/);
});
