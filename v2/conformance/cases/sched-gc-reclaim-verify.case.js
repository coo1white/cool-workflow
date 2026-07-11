#!/usr/bin/env node
"use strict";

// The full archive -> gc plan -> gc run -> gc verify happy path against a
// real completed stub-agent run. Confirms:
//   - archiving flips gc plan's eligibility (not-archived -> eligible)
//   - gc run actually reclaims and reports bytesFreed + a sha256 tombstone
//   - gc verify recomputes the chain and reports verified:true, exit 0
//   - reclaimed.json is written on disk with the matching tombstone

const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const pipe = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(pipe.status, 0);
  const runId = JSON.parse(pipe.stdout).runId;
  run(["registry", "refresh"], { cwd: repo });

  const archive = run(["run", "archive", runId, "--reason", "test archive", "--json"], { cwd: repo });
  assert.equal(archive.status, 0);
  const archiveReport = JSON.parse(archive.stdout);
  assert.equal(archiveReport.archived, true);
  assert.equal(archiveReport.reason, "test archive");
  assert.equal(archiveReport.record.derivedLifecycle, "completed", "archive is a mark, derivedLifecycle unaffected");

  const plan = run(["gc", "plan", "--json"], { cwd: repo });
  assert.equal(plan.status, 0);
  const planReport = JSON.parse(plan.stdout);
  const planEntry = planReport.entries.find((e) => e.runId === runId);
  assert.equal(planEntry.eligible, true, "an archived, completed run is eligible under default policy");
  assert.equal(planEntry.reason, "eligible");
  assert.ok(planReport.bytesToFree > 0);

  const gcRun = run(["gc", "run", "--json"], { cwd: repo });
  assert.equal(gcRun.status, 0);
  const gcRunReport = JSON.parse(gcRun.stdout);
  assert.equal(gcRunReport.dryRun, false);
  assert.equal(gcRunReport.reclaimed.length, 1);
  const reclaimed = gcRunReport.reclaimed[0];
  assert.equal(reclaimed.runId, runId);
  assert.ok(reclaimed.bytesFreed > 0);
  assert.match(reclaimed.tombstoneHash, /^sha256:[0-9a-f]{64}$/);
  // Under the default policy this pipeline run's superseded, non-verifier-
  // gated commit snapshots are ALSO reclaimed (architecture-review-driven
  // cycle 4), not just worker scratch — a commit snapshot is never
  // reconstructable, so that downgrades capability past "re-runnable".
  assert.equal(reclaimed.capability, "verify-only");
  assert.equal(reclaimed.capabilityReason, "snapshot-reclaimed-no-reconstruction");
  assert.equal(gcRunReport.totalBytesFreed, reclaimed.bytesFreed);
  assert.equal(gcRunReport.nextAction, "cw gc verify <run-id>");

  const verify = run(["gc", "verify", runId, "--json"], { cwd: repo });
  assert.equal(verify.status, 0);
  const verifyReport = JSON.parse(verify.stdout);
  assert.equal(verifyReport.reclaimed, true);
  assert.equal(verifyReport.verified, true);
  assert.equal(verifyReport.tier, "reclaimed");
  assert.equal(verifyReport.tombstoneHash, reclaimed.tombstoneHash);
  assert.ok(verifyReport.checks.length >= 1);
  assert.ok(verifyReport.checks.every((c) => c.pass === true), "every check must pass on an honest chain");

  // Human render of gc verify: PASS lines, tombstone cut to 19 chars.
  const verifyHuman = run(["gc", "verify", runId], { cwd: repo });
  assert.match(verifyHuman.stdout, /^GC Verify /);
  assert.match(verifyHuman.stdout, /reclaimed=true verified=true/);
  assert.match(verifyHuman.stdout, /PASS /);

  // reclaimed.json is durable on disk with a matching tombstone entry.
  const reclaimedOverlay = readJson(path.join(repo, ".cw", "runs", runId, "reclaimed.json"));
  assert.equal(reclaimedOverlay.schemaVersion, 1);
  assert.equal(reclaimedOverlay.runId, runId);
  assert.equal(reclaimedOverlay.tombstones.length, 1);
  assert.equal(reclaimedOverlay.tombstones[0].tombstoneId, "tomb-001");
});
