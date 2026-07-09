#!/usr/bin/env node
"use strict";

// cw gc plan/run on a clean repo (documented empty shape), then against a
// real completed-but-not-archived run from a stub-agent pipeline: default
// policy reclaims NOTHING (all defaults reclaim nothing), so gc plan must
// report the run refused with reason "not-archived", and gc run must
// actually reclaim zero bytes and touch no files. gc verify on a
// never-reclaimed run returns reclaimed:false, verified:false, exit 0.

const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const cleanPlan = run(["gc", "plan", "--json"], { cwd: repo });
  assert.equal(cleanPlan.status, 0);
  const cleanReport = JSON.parse(cleanPlan.stdout);
  assert.equal(cleanReport.schemaVersion, 1);
  assert.equal(cleanReport.total, 0);
  assert.equal(cleanReport.eligibleCount, 0);
  assert.equal(cleanReport.bytesToFree, 0);
  assert.deepEqual(cleanReport.entries, []);
  assert.equal(cleanReport.policy.reclaimAfterArchiveDays, 0);
  assert.equal(cleanReport.policy.keepScratch, false);
  assert.equal(cleanReport.policy.keepSnapshots, false);
  assert.deepEqual(cleanReport.policy.reclaimStates, ["completed", "failed"]);

  const cleanPlanHuman = run(["gc", "plan"], { cwd: repo });
  assert.equal(cleanPlanHuman.status, 0);
  assert.match(cleanPlanHuman.stdout, /^GC Plan \(home\): 0\/0 eligible, 0 byte\(s\) would be freed \[DRY-RUN, frees nothing\]\n/);
  assert.match(cleanPlanHuman.stdout, /\(no runs in scope\)\n$/);

  const cleanRun = run(["gc", "run", "--json"], { cwd: repo });
  assert.equal(cleanRun.status, 0);
  const cleanRunReport = JSON.parse(cleanRun.stdout);
  assert.equal(cleanRunReport.dryRun, false);
  assert.deepEqual(cleanRunReport.reclaimed, []);
  assert.deepEqual(cleanRunReport.refused, []);
  assert.equal(cleanRunReport.totalBytesFreed, 0);
  assert.equal(cleanRunReport.nextAction, "cw gc plan");

  // Now establish one real completed run.
  const pipe = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(pipe.status, 0);
  const runId = JSON.parse(pipe.stdout).runId;
  run(["registry", "refresh"], { cwd: repo });

  const plan = run(["gc", "plan", "--json"], { cwd: repo });
  assert.equal(plan.status, 0);
  const planReport = JSON.parse(plan.stdout);
  assert.equal(planReport.total, 1);
  assert.equal(planReport.eligibleCount, 0, "default policy reclaims nothing");
  assert.equal(planReport.bytesToFree, 0);
  const entry = planReport.entries.find((e) => e.runId === runId);
  assert.ok(entry, "gc plan must list the completed run");
  assert.equal(entry.eligible, false);
  assert.equal(entry.reason, "not-archived");
  assert.equal(entry.tier, "live");

  const gcRun = run(["gc", "run", "--json"], { cwd: repo });
  assert.equal(gcRun.status, 0);
  const gcRunReport = JSON.parse(gcRun.stdout);
  assert.deepEqual(gcRunReport.reclaimed, []);
  assert.equal(gcRunReport.totalBytesFreed, 0);
  assert.ok(gcRunReport.refused.some((r) => r.runId === runId && r.code === "not-archived"));

  // gc verify on a run that was never reclaimed: exit 0, reclaimed:false.
  const verify = run(["gc", "verify", runId, "--json"], { cwd: repo });
  assert.equal(verify.status, 0, "gc verify on a never-reclaimed run must exit 0");
  const verifyReport = JSON.parse(verify.stdout);
  assert.equal(verifyReport.reclaimed, false);
  assert.equal(verifyReport.verified, false);
  assert.ok(verifyReport.checks.some((c) => c.name === "reclaimed" && c.pass === false && c.code === "not-reclaimed"));
});
