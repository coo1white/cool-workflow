#!/usr/bin/env node
"use strict";

// Resume: every drive call is a fresh CLI process reloading durable state
// from disk (state.json + nodes/ + workers/). This proves a run can be
// continued across process boundaries with `run --drive --once --run <id>`
// and that `run drive <id>` / `run resume <id>` (read-only) agree with the
// mutating drive on the run's current position, with no double-dispatch.
//
// A true kill-mid-agent-spawn interrupt cannot be simulated black-box (the
// stub agent is a synchronous child that either finishes or the whole test
// process is killed) — see skipped_surface_items.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, stubAgentEnv, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const env = stubAgentEnv("a.txt:1");

  // Plan only (no drive yet) — a fresh process now "resumes" it.
  const planResult = run(["plan", "end-to-end-golden-path", "--question", "prove it", "--repo", repo, "--json"], {
    cwd: repo,
  });
  assert.equal(planResult.status, 0);
  const planPayload = JSON.parse(planResult.stdout);
  const runId = planPayload.runId;

  // Read-only preview: next action is "dispatch", nothing mutated.
  let preview = run(["run", "drive", runId, "--json"], { cwd: repo, env });
  assert.equal(preview.status, 0);
  let previewPayload = JSON.parse(preview.stdout);
  assert.equal(previewPayload.nextAction, "dispatch");
  assert.equal(previewPayload.pendingWorkers, 1);
  assert.equal(previewPayload.completedWorkers, 0);

  // Read-only resume payload agrees, and lists the next task.
  let resume = run(["run", "resume", runId, "--json"], { cwd: repo, env });
  assert.equal(resume.status, 0);
  let resumePayload = JSON.parse(resume.stdout);
  assert.equal(resumePayload.runId, runId);
  assert.equal(resumePayload.nextTasks.length, 1);
  assert.equal(resumePayload.nextTasks[0].id, "golden:path");
  assert.equal(resumePayload.nextTasks[0].status, "pending");

  // Neither preview call dispatched anything.
  const runDir = path.dirname(planPayload.statePath);
  assert.deepEqual(fs.readdirSync(path.join(runDir, "dispatches")).length, 0);

  // Now actually drive one step from a NEW process (simulating a resumed
  // operator session): dispatch happens, task moves to running.
  let step = run(["run", "--drive", "--once", "--run", runId, "--json"], { cwd: repo, env });
  assert.equal(step.status, 0);
  let stepPayload = JSON.parse(step.stdout);
  assert.equal(stepPayload.status, "in-progress");
  assert.equal(fs.readdirSync(path.join(runDir, "dispatches")).length, 1);

  // Continue to completion from yet another process using --run.
  let done = run(["run", "--drive", "--run", runId, "--json"], { cwd: repo, env });
  assert.equal(done.status, 0);
  let donePayload = JSON.parse(done.stdout);
  assert.equal(donePayload.status, "complete");
  assert.equal(donePayload.completedWorkers, 1);

  // resume --drive (mutating twin) on the now-complete run reports the SAME
  // run id and a drive field, with the terminal commit already in place —
  // re-invoking is idempotent (a later drive step just reports "complete").
  let resumeDrive = run(["run", "resume", runId, "--drive", "--once", "--json"], { cwd: repo, env });
  assert.equal(resumeDrive.status, 0);
  let resumeDrivePayload = JSON.parse(resumeDrive.stdout);
  assert.equal(resumeDrivePayload.runId, runId);
  assert.ok(resumeDrivePayload.drive, "resume --drive must add a drive field");
  assert.equal(resumeDrivePayload.drive.status, "complete");

  // Only ONE worker and ONE dispatch ever existed across the whole resume
  // sequence — no duplicate dispatch from re-resolving the run repeatedly.
  assert.equal(fs.readdirSync(path.join(runDir, "dispatches")).length, 1);
  const workerDirs = fs.readdirSync(path.join(runDir, "workers")).filter((f) => f.startsWith("worker-"));
  assert.equal(workerDirs.length, 1);
});
