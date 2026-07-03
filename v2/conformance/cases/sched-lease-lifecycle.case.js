#!/usr/bin/env node
"use strict";

// cw sched plan/lease/release/reclaim/reset over the durable home queue,
// with an injected --now for determinism:
//   - lease -> release --failed twice at maxAttempts=2 parks the entry
//     with parkedReason "released as failed (attempt 2/2)"
//   - only sched reset recovers a parked entry (ready, attempts 0)
//   - an expired (unreleased) lease is skipped in a later plan with
//     reason "leased", and only sched reclaim counts the attempt
//   - sched policy set validates numeric flags and fails closed on
//     a non-numeric value

const { run, gitRepo, caseMain, assert } = require("../lib");

function leaseIdOf(leaseJson) {
  const parsed = JSON.parse(leaseJson);
  return parsed.leases[0] ? parsed.leases[0].leaseId : null;
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const policySet = run(["sched", "policy", "set", "--maxAttempts", "2", "--backoffBaseMs", "1", "--json"], { cwd: repo });
  assert.equal(policySet.status, 0);
  const policyReport = JSON.parse(policySet.stdout);
  assert.equal(policyReport.policy.maxAttempts, 2);
  assert.equal(policyReport.source, "file");

  const invalidPolicy = run(["sched", "policy", "set", "--maxConcurrent", "notanumber"], { cwd: repo });
  assert.equal(invalidPolicy.status, 1);
  assert.equal(invalidPolicy.stderr, 'cw: Invalid --maxConcurrent "notanumber": expected a number (e.g. --maxConcurrent 4)\n');

  const add = run(["queue", "add", "--app", "demo", "--json"], { cwd: repo });
  assert.equal(add.status, 0);
  const qid = JSON.parse(add.stdout).id;

  const now1 = "2026-01-01T00:00:00.000Z";
  const now2 = "2026-01-01T00:01:00.000Z";
  const now3 = "2026-01-01T00:10:00.000Z";

  // Two failed releases at maxAttempts=2 must park the entry.
  const lease1 = run(["sched", "lease", "--now", now1, "--json"], { cwd: repo });
  assert.equal(lease1.status, 0);
  const leaseId1 = leaseIdOf(lease1.stdout);
  assert.ok(leaseId1);
  const release1 = run(["sched", "release", leaseId1, "--failed", "--now", now1, "--json"], { cwd: repo });
  assert.equal(release1.status, 0);
  assert.deepEqual(JSON.parse(release1.stdout), { schemaVersion: 1, released: leaseId1, failed: true });

  const lease2 = run(["sched", "lease", "--now", now2, "--json"], { cwd: repo });
  const leaseId2 = leaseIdOf(lease2.stdout);
  assert.ok(leaseId2);
  const release2 = run(["sched", "release", leaseId2, "--failed", "--now", now2, "--json"], { cwd: repo });
  assert.equal(release2.status, 0);

  const parkedShow = run(["queue", "show", qid, "--json"], { cwd: repo });
  assert.equal(parkedShow.status, 0);
  const parkedEntry = JSON.parse(parkedShow.stdout);
  assert.equal(parkedEntry.status, "parked");
  assert.equal(parkedEntry.attempts, 2);
  assert.equal(parkedEntry.parkedReason, "released as failed (attempt 2/2)");

  // A parked entry is never planned/leased again.
  const parkedPlan = run(["sched", "plan", "--now", now3, "--json"], { cwd: repo });
  assert.equal(parkedPlan.status, 0);
  assert.deepEqual(JSON.parse(parkedPlan.stdout).leases, []);

  const badRelease = run(["sched", "release", "lease-does-not-exist"], { cwd: repo });
  assert.equal(badRelease.status, 1);
  assert.equal(badRelease.stderr, "cw: No active lease to release: lease-does-not-exist\n");

  const badReset = run(["sched", "reset", "some-other-id"], { cwd: repo });
  assert.equal(badReset.status, 1);
  assert.equal(badReset.stderr, "cw: No parked entry to reset: some-other-id\n");

  // reset is the ONLY way out of parked: ready again, attempts cleared to 0.
  const reset = run(["sched", "reset", qid, "--json"], { cwd: repo });
  assert.equal(reset.status, 0);
  assert.deepEqual(JSON.parse(reset.stdout), { schemaVersion: 1, reset: qid });

  const afterReset = run(["queue", "show", qid, "--json"], { cwd: repo });
  const afterResetEntry = JSON.parse(afterReset.stdout);
  assert.equal(afterResetEntry.status, "ready");
  assert.equal(afterResetEntry.attempts, 0);
  assert.equal(afterResetEntry.parkedReason, undefined);

  // --- expired lease reclaim path -------------------------------------
  const lease3 = run(["sched", "lease", "--now", now1, "--json"], { cwd: repo });
  const leaseId3 = leaseIdOf(lease3.stdout);
  assert.ok(leaseId3);

  const farFuture = "2026-01-01T00:20:00.000Z"; // well past the 300000ms default leaseTtlMs
  const planExpired = run(["sched", "plan", "--now", farFuture, "--json"], { cwd: repo });
  assert.equal(planExpired.status, 0);
  const planExpiredReport = JSON.parse(planExpired.stdout);
  assert.deepEqual(planExpiredReport.leases, [], "an expired lease must never be re-planned as leased");
  assert.ok(
    planExpiredReport.skipped.some((s) => s.id === qid && s.reason === "leased"),
    "an unexpired-looking entry with an expired lease is skipped as leased, not counted inFlight"
  );

  const reclaim = run(["sched", "reclaim", "--now", farFuture, "--json"], { cwd: repo });
  assert.equal(reclaim.status, 0);
  const reclaimReport = JSON.parse(reclaim.stdout);
  assert.deepEqual(reclaimReport.reclaimed, [qid]);

  const afterReclaim = run(["queue", "show", qid, "--json"], { cwd: repo });
  const afterReclaimEntry = JSON.parse(afterReclaim.stdout);
  assert.equal(afterReclaimEntry.attempts, 1, "an expired-lease reclaim counts exactly one attempt");
});
