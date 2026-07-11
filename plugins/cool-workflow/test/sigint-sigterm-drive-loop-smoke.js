#!/usr/bin/env node
"use strict";

// sigint-sigterm-drive-loop-smoke — Cycle P2-6 of the post-v0.2.2 robustness
// batch.
//
// Before this cycle, NO signal handler existed anywhere in src/ for the
// parent `cw` process. A bare Ctrl-C (SIGINT) or an external SIGTERM ran the
// kernel default: instant termination, no `finally` anywhere got a chance to
// run. Landing mid-`withFileLock` left a stale `.lock` file (a ~6s hard
// failure on the very next command, well under the 30s steal window); an
// agent child spawned via spawnSync for the in-flight step was orphaned by a
// SIGTERM sent only to the parent PID.
//
// drive.ts now installs a SIGINT/SIGTERM handler around its loop: the FIRST
// signal stops the loop from starting its NEXT iteration (never mid-step)
// and returns a normal "blocked" DriveResult naming the interruption, same
// shape as the pre-existing max-iteration block — resumable the same way. A
// SECOND signal means the caller wants out right now and force-exits with
// the conventional 128+signum code.
//
// This proves both paths deterministically (no real OS signal race): a
// shared saveCheckpoint call fires once per completed task, so monkeypatching
// it to call process.emit(signal, signal) synchronously reproduces the exact
// user-facing timing without depending on OS scheduling.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const workflowAppLoaderPath = path.join(pluginRoot, "dist/shell/workflow-app-loader.js");
const pipelinePath = path.join(pluginRoot, "dist/shell/pipeline.js");
const drivePath = path.join(pluginRoot, "dist/shell/drive.js");
const runStorePath = path.join(pluginRoot, "dist/shell/run-store.js");

const { loadWorkflowApp } = require(workflowAppLoaderPath);
const { plan } = require(pipelinePath);
const { drive } = require(drivePath);
const runStore = require(runStorePath);

const FIXED_NOW = "2026-07-08T00:00:00.000Z";
const cleanups = [];

function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(d);
  return d;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_APPS_DIR"]) delete process.env[v];
  process.env.CW_NO_AUTO_AGENT = "1";
}
function writeStub(file) {
  fs.writeFileSync(
    file,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const rp = process.argv[2];",
      'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
      "fs.writeFileSync(rp, body);",
      'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 4, output_tokens: 2 } }));'
    ].join("\n"),
    "utf8"
  );
  return file;
}
function agentConfig(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "stub", source: "flag" };
}
// Three tasks in ONE plain (non-parallel) phase: autoWidth() gives width=1
// for a non-"parallel" phase.mode regardless of maxConcurrentAgents, so a
// non-once drive() call takes exactly 3 outer-loop iterations, one task each.
function writeThreeTaskApp(appsDir, id) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "app.json"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      title: id,
      summary: id,
      version: "0.1.0",
      author: "test",
      inputs: [{ name: "question", type: "string" }],
      sandboxProfiles: ["readonly"],
      compatibility: { minVersion: "0.1.9" },
      workflow: { entrypoint: "workflow.js" }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "workflow.js"),
    `module.exports = ({ workflow, phase, agent, input }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 20, maxConcurrentAgents: 1 },
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: [
    phase("Sequential", [
      agent("step:one", "Do step one on {{question}}", { sandboxProfileId: "readonly" }),
      agent("step:two", "Do step two on {{question}}", { sandboxProfileId: "readonly" }),
      agent("step:three", "Do step three on {{question}}", { sandboxProfileId: "readonly" })
    ])
  ]
});
`,
    "utf8"
  );
}
function planApp(appsDir, id, inputs) {
  process.env.CW_APPS_DIR = appsDir;
  return plan(loadWorkflowApp(id), inputs);
}
// A single task: exactly 2 outer-loop iterations (task dispatch+accept, then
// the run's own terminal commit gate).
function writeOneTaskApp(appsDir, id) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "app.json"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      title: id,
      summary: id,
      version: "0.1.0",
      author: "test",
      inputs: [{ name: "question", type: "string" }],
      sandboxProfiles: ["readonly"],
      compatibility: { minVersion: "0.1.9" },
      workflow: { entrypoint: "workflow.js" }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "workflow.js"),
    `module.exports = ({ workflow, phase, agent, input }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 20, maxConcurrentAgents: 1 },
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: [
    phase("Solo", [
      agent("solo:one", "Do the one step on {{question}}", { sandboxProfileId: "readonly" })
    ])
  ]
});
`,
    "utf8"
  );
}
// A parallel phase with maxConcurrentAgents matching the task count: all 3
// tasks settle in ONE driveConcurrentRound call (width=3), not 3 separate
// outer-loop iterations.
function writeParallelThreeTaskApp(appsDir, id) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "app.json"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      title: id,
      summary: id,
      version: "0.1.0",
      author: "test",
      inputs: [{ name: "question", type: "string" }],
      sandboxProfiles: ["readonly"],
      compatibility: { minVersion: "0.1.9" },
      workflow: { entrypoint: "workflow.js" }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "workflow.js"),
    `module.exports = ({ workflow, parallel, agent, input }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 20, maxConcurrentAgents: 3 },
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: [
    parallel("Round", [
      agent("round:one", "Do round task one on {{question}}", { sandboxProfileId: "readonly" }),
      agent("round:two", "Do round task two on {{question}}", { sandboxProfileId: "readonly" }),
      agent("round:three", "Do round task three on {{question}}", { sandboxProfileId: "readonly" })
    ])
  ]
});
`,
    "utf8"
  );
}

// ---------------------------------------------------------------------
// 1. A single stop signal breaks the loop AFTER the in-flight step, not
//    before it and not mid-way through it: exactly 1 of 3 tasks completes,
//    the run reports "blocked" naming the interrupting signal, the other
//    2 tasks are untouched, drive() removes its own listener (no leak), and
//    re-driving the SAME run id resumes and finishes the remaining work.
// ---------------------------------------------------------------------
function testGracefulSingleSignal(signal) {
  clearAgentEnv();
  const cwd0 = process.cwd();
  const appsDir = tmp(`cw-sigloop-apps-${signal}-`);
  const work = tmp(`cw-sigloop-work-${signal}-`);
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  writeThreeTaskApp(appsDir, "sigloop-app");
  process.chdir(work);
  try {
    const p = planApp(appsDir, "sigloop-app", { repo: work, question: "Q?" });
    assert.equal(p.tasks.length, 3, "fixture app must have exactly 3 sequential tasks");

    const before = process.listenerCount(signal);
    const originalSaveCheckpoint = runStore.saveCheckpoint;
    let hits = 0;
    runStore.saveCheckpoint = function patchedSaveCheckpoint(...args) {
      const result = originalSaveCheckpoint.apply(this, args);
      hits += 1;
      if (hits === 1) process.emit(signal, signal);
      return result;
    };
    let result;
    try {
      result = drive(p.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
    } finally {
      runStore.saveCheckpoint = originalSaveCheckpoint;
    }

    assert.equal(process.listenerCount(signal), before, `drive() must remove its own ${signal} listener, leaving the count unchanged`);
    assert.equal(result.status, "blocked", `a ${signal} mid-drive must report blocked, not complete/parked`);
    assert.equal(result.completedWorkers, 1, `exactly 1 task should complete before ${signal} stopped the NEXT iteration from starting`);
    const last = result.steps[result.steps.length - 1];
    assert.match(last.reason || "", new RegExp(`drive interrupted by ${signal}`), "the terminal step must name the interrupting signal");
    // architecture-review-driven fix: the blocked reason must carry the
    // ACTUAL, copy-pasteable resume command (with this run's real id), not
    // just vague "run again" prose a user has to translate themselves.
    assert.ok(
      (last.reason || "").includes(`cw run resume ${p.id} --drive`),
      `blocked reason must contain the literal resume command (got: ${last.reason})`
    );

    const runAfter = runStore.loadRunFromCwd(p.id, work);
    const remaining = runAfter.tasks.filter((t) => t.id !== "step:one");
    assert.equal(remaining.length, 2);
    assert.ok(remaining.every((t) => t.status === "pending"), "the untouched tasks must still be pending, not partially started");

    const resumed = drive(p.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
    assert.equal(resumed.status, "complete", "re-driving the same run id after an interruption must resume to completion");
    assert.equal(resumed.completedWorkers, 3);
    assert.equal(process.listenerCount(signal), before, "a normal (non-interrupted) drive() call must also leave the listener count unchanged");
  } finally {
    process.chdir(cwd0);
  }
}

testGracefulSingleSignal("SIGINT");
testGracefulSingleSignal("SIGTERM");

// ---------------------------------------------------------------------
// 2. A confirmed adversarial-review must-fix: a signal landing on the run's
//    OWN terminal commit step (the run is already fully done at that exact
//    point) must not still misreport "blocked" -- finalDriveStatus would
//    otherwise fall through to the interrupted step's status instead of
//    ever reaching its "complete" branch, and pipeline-cli.ts's --bundle
//    gate reads status, so a genuinely-finished run would wrongly skip
//    sealing its bundle. First drive an uninterrupted run to learn exactly
//    which saveCheckpoint call is the terminal one (its LAST), then fire
//    the signal on that exact call on a fresh replan of the same app.
// ---------------------------------------------------------------------
function testInterruptOnTerminalCommitReportsComplete(signal) {
  clearAgentEnv();
  const cwd0 = process.cwd();
  try {
    const baselineAppsDir = tmp(`cw-sigloop-terminal-baseline-apps-${signal}-`);
    const baselineWork = tmp(`cw-sigloop-terminal-baseline-work-${signal}-`);
    fs.writeFileSync(path.join(baselineWork, "README.md"), "# t\n", "utf8");
    const baselineStub = writeStub(path.join(baselineWork, "stub.js"));
    writeOneTaskApp(baselineAppsDir, "sigloop-terminal-baseline");
    process.chdir(baselineWork);
    const baselineRun = planApp(baselineAppsDir, "sigloop-terminal-baseline", { repo: baselineWork, question: "Q?" });
    assert.equal(baselineRun.tasks.length, 1, "fixture app must have exactly 1 task");

    const originalSaveCheckpoint = runStore.saveCheckpoint;
    let baselineHits = 0;
    runStore.saveCheckpoint = function (...args) {
      const result = originalSaveCheckpoint.apply(this, args);
      baselineHits += 1;
      return result;
    };
    let baselineResult;
    try {
      baselineResult = drive(baselineRun.id, baselineWork, { now: FIXED_NOW, agentConfig: agentConfig(baselineStub) });
    } finally {
      runStore.saveCheckpoint = originalSaveCheckpoint;
    }
    assert.equal(baselineResult.status, "complete", "the uninterrupted baseline run must complete normally");
    assert.ok(baselineHits >= 2, "a 1-task run must checkpoint at least twice (its own progress, then its terminal commit)");

    const appsDir = tmp(`cw-sigloop-terminal-apps-${signal}-`);
    const work = tmp(`cw-sigloop-terminal-work-${signal}-`);
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const stub = writeStub(path.join(work, "stub.js"));
    writeOneTaskApp(appsDir, "sigloop-terminal-app");
    process.chdir(work);
    const p = planApp(appsDir, "sigloop-terminal-app", { repo: work, question: "Q?" });

    let hits = 0;
    runStore.saveCheckpoint = function (...args) {
      const result = originalSaveCheckpoint.apply(this, args);
      hits += 1;
      if (hits === baselineHits) process.emit(signal, signal);
      return result;
    };
    let result;
    try {
      result = drive(p.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
    } finally {
      runStore.saveCheckpoint = originalSaveCheckpoint;
    }

    assert.equal(result.status, "complete", `a ${signal} landing on the run's own terminal commit step must still report complete, not a misleading blocked`);
    assert.equal(result.completedWorkers, 1);
    assert.ok(result.commitId, "the real terminal commit must be present");
  } finally {
    process.chdir(cwd0);
  }
}

testInterruptOnTerminalCommitReportsComplete("SIGINT");
testInterruptOnTerminalCommitReportsComplete("SIGTERM");

// ---------------------------------------------------------------------
// 3. A confirmed adversarial-review should-fix: driveConcurrentRound's OWN
//    once-per-round saveCheckpoint call (the width>1 path) was never
//    exercised by any signal test. A signal mid-round does NOT stop the
//    round's own in-flight tasks -- this is documented, accepted,
//    round-granularity behavior (refuted as a bug by the same review), but
//    it must still be pinned by a real test so a future change to that
//    behavior is visible. The loop still correctly stops before the NEXT
//    round/commit step, and resuming finishes the run.
// ---------------------------------------------------------------------
function testConcurrentRoundInterruptGranularity(signal) {
  clearAgentEnv();
  const cwd0 = process.cwd();
  const appsDir = tmp(`cw-sigloop-round-apps-${signal}-`);
  const work = tmp(`cw-sigloop-round-work-${signal}-`);
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  writeParallelThreeTaskApp(appsDir, "sigloop-round-app");
  process.chdir(work);
  try {
    const p = planApp(appsDir, "sigloop-round-app", { repo: work, question: "Q?" });
    assert.equal(p.tasks.length, 3, "fixture app must have exactly 3 parallel tasks in one round");

    const before = process.listenerCount(signal);
    const originalSaveCheckpoint = runStore.saveCheckpoint;
    let hits = 0;
    runStore.saveCheckpoint = function (...args) {
      const result = originalSaveCheckpoint.apply(this, args);
      hits += 1;
      if (hits === 1) process.emit(signal, signal);
      return result;
    };
    let result;
    try {
      result = drive(p.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
    } finally {
      runStore.saveCheckpoint = originalSaveCheckpoint;
    }

    assert.equal(process.listenerCount(signal), before, `drive() must remove its own ${signal} listener after a concurrent-round drive too`);
    assert.equal(result.completedWorkers, 3, "a signal mid-round does not stop the round's OWN in-flight tasks -- round granularity is the accepted, documented behavior");
    assert.equal(result.status, "blocked", "the run must still stop before its NEXT round/commit step, even though this round finished");
    const last = result.steps[result.steps.length - 1];
    assert.match(last.reason || "", new RegExp(`drive interrupted by ${signal}`));
    assert.ok(
      (last.reason || "").includes(`cw run resume ${p.id} --drive`),
      `blocked reason must contain the literal resume command (got: ${last.reason})`
    );

    const resumed = drive(p.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
    assert.equal(resumed.status, "complete", "re-driving after a round-boundary interruption resumes to completion");
  } finally {
    process.chdir(cwd0);
  }
}

testConcurrentRoundInterruptGranularity("SIGINT");
testConcurrentRoundInterruptGranularity("SIGTERM");

// ---------------------------------------------------------------------
// 4. A SECOND stop signal (an impatient double Ctrl-C) force-exits
//    immediately with the conventional 128+signum code, rather than
//    waiting for the graceful stop. Run as a real child process since
//    this path calls process.exit().
// ---------------------------------------------------------------------
function testForcedDoubleSignal(signal, expectedExitCode) {
  const appsDir = tmp(`cw-sigloop-force-apps-${signal}-`);
  const work = tmp(`cw-sigloop-force-work-${signal}-`);
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  writeThreeTaskApp(appsDir, "sigloop-force-app");

  const child = `
    process.env.CW_NO_AUTO_AGENT = "1";
    process.chdir(${JSON.stringify(work)});
    process.env.CW_APPS_DIR = ${JSON.stringify(appsDir)};
    const { loadWorkflowApp } = require(${JSON.stringify(workflowAppLoaderPath)});
    const { plan } = require(${JSON.stringify(pipelinePath)});
    const { drive } = require(${JSON.stringify(drivePath)});
    const runStore = require(${JSON.stringify(runStorePath)});
    const p = plan(loadWorkflowApp("sigloop-force-app"), { repo: ${JSON.stringify(work)}, question: "Q?" });
    const original = runStore.saveCheckpoint;
    runStore.saveCheckpoint = function (...args) {
      const r = original.apply(this, args);
      // Two rapid signals in the same turn -- the impatient-double-Ctrl-C case.
      process.emit(${JSON.stringify(signal)}, ${JSON.stringify(signal)});
      process.emit(${JSON.stringify(signal)}, ${JSON.stringify(signal)});
      return r;
    };
    drive(p.id, ${JSON.stringify(work)}, { now: ${JSON.stringify(FIXED_NOW)}, agentConfig: { schemaVersion: 1, command: process.execPath, args: [${JSON.stringify(stub)}, "{{result}}"], model: "stub", source: "flag" } });
    process.stdout.write("UNREACHABLE: drive() returned instead of the 2nd signal forcing an exit\\n");
  `;
  const r = spawnSync(process.execPath, ["-e", child], { encoding: "utf8" });
  assert.equal(r.status, expectedExitCode, `a 2nd ${signal} must force-exit with code ${expectedExitCode}, got ${r.status} (stdout: ${r.stdout} stderr: ${r.stderr})`);
  assert.ok(!r.stdout.includes("UNREACHABLE"), "drive() must never return normally once the 2nd signal fires");
}

testForcedDoubleSignal("SIGINT", 130);
testForcedDoubleSignal("SIGTERM", 143);

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
process.stdout.write(
  "sigint-sigterm-drive-loop-smoke: ok (graceful single-signal stop + resume, listener cleanup, " +
    "terminal-commit interrupt still reports complete, concurrent-round interrupt granularity, forced double-signal exit codes)\n"
);
