#!/usr/bin/env node
"use strict";

// drive-async-real-signal-smoke — proves shell/drive.ts's driveAsync() is
// ACTUALLY interruptible by a real, kernel-delivered SIGINT/SIGTERM, using a
// genuinely EXTERNAL signal sender (this test process calling process.kill()
// on a SEPARATE child process) -- never process.emit(), which never leaves
// the current process/call stack and so cannot prove anything about real
// OS signal delivery.
//
// Background: drive()'s (and driveAsync()'s) whole multi-round loop is one
// continuous synchronous span -- every round's agent spawn uses spawnSync,
// and nothing between rounds ever awaited anything. Node.js does not
// dispatch a queued POSIX signal to a JS `process.on(signal, ...)` listener
// until the event loop actually gets a turn; a signal landing anywhere in
// that span sits queued until the loop finishes on its own, by which point
// the listener has already been removed, so it is never invoked at all.
// The pre-existing sigint-sigterm-drive-loop-smoke.js test fakes the signal
// by monkeypatching saveCheckpoint to call process.emit(signal, signal)
// SYNCHRONOUSLY from inside the same call stack the handler is registered
// on -- that bypasses the actual kernel-signal-queuing-then-event-loop-
// dispatch mechanism entirely, so its "pass" says nothing about real-world
// signal responsiveness (confirmed live during development: a real external
// `kill -INT` sent to a plain synchronous busy loop -- no spawnSync even
// involved -- is dropped for as long as the loop runs, and fires within
// ~1ms of the very next real event-loop turn once one occurs).
//
// This test sends a REAL signal -- process.kill(childPid, signal), from
// this test's own OS process, targeting a genuinely separate child process
// -- timed via a real on-disk marker (not a fixed sleep) to land while the
// child driver is provably still blocked inside spawnSync for round 1. It
// proves TWO things, in contrast, using the identical real signal and
// identical timing:
//   (a) driveAsync() (the live-entry-point fix) actually stops after round 1
//       and reports "blocked", naming the interrupting signal -- resumable.
//   (b) the plain, fully synchronous drive() (kept byte-identical for
//       backward compatibility -- recursive sub-workflow calls, existing
//       tests) does NOT react at all: the signal is silently swallowed and
//       the run drives straight through to completion, exactly the
//       documented, accepted, unfixed gap driveAsync exists to close.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const workflowAppLoaderPath = path.join(pluginRoot, "dist/shell/workflow-app-loader.js");
const pipelinePath = path.join(pluginRoot, "dist/shell/pipeline.js");
const drivePath = path.join(pluginRoot, "dist/shell/drive.js");

const { loadWorkflowApp } = require(workflowAppLoaderPath);
const { plan } = require(pipelinePath);
const { drive } = require(drivePath);

const FIXED_NOW = "2026-07-09T00:00:00.000Z";
const STEP_MS = 900; // real wall-clock time per round -- comfortably longer
// than the marker-poll interval + real signal-delivery latency, so the
// signal is provably sent while the round-1 stub is still running.
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls a JSONL marker file (real wall-clock waiting, not a synchronous
// busy-wait, so this test process's own event loop stays free) until a line
// satisfies `predicate`, or throws after `timeoutMs`.
async function waitForMarker(file, predicate, timeoutMs) {
  const start = Date.now();
  for (;;) {
    if (fs.existsSync(file)) {
      const lines = fs
        .readFileSync(file, "utf8")
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (lines.some(predicate)) return lines;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for a marker in ${file}`);
    await sleep(15);
  }
}
function readMarkers(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// A real child process standing in for the agent: writes a "start" marker
// the instant it launches, sleeps STEP_MS (real wall-clock time -- this is
// its OWN process, so using setTimeout here is unrelated to the signal
// responsiveness under test), then writes the result file + an "end"
// marker. The driver (drive()/driveAsync()) is blocked inside spawnSync for
// this whole window -- exactly the busy span a real signal must survive.
function writeStub(file, timingLog) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    `const timingLog = ${JSON.stringify(timingLog)};`,
    "function mark(event) { fs.appendFileSync(timingLog, JSON.stringify({ event, pid: process.pid, time: Date.now() }) + '\\n'); }",
    'mark("start");',
    "setTimeout(() => {",
    '  const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "  fs.writeFileSync(rp, body);",
    '  mark("end");',
    '  process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 4, output_tokens: 2 } }));',
    "  process.exit(0);",
    `}, ${STEP_MS});`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

// Three tasks in ONE plain (non-parallel) phase -- a non-once drive()/
// driveAsync() call takes exactly 3 outer-loop rounds, one task each.
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

function agentConfigFor(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "stub", source: "flag" };
}

// The driver: a genuinely SEPARATE OS process that calls `fnName`
// (drive/driveAsync) against an ALREADY-PLANNED run and writes its result to
// `resultFile`. Wrapping in Promise.resolve() lets the SAME template drive
// both the synchronous drive() (already a plain value) and the async
// driveAsync() (a real Promise) uniformly.
function driverScript(fnName, runId, cwd, stub, resultFile) {
  return `
    const fs = require("fs");
    const { drive, driveAsync } = require(${JSON.stringify(drivePath)});
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [${JSON.stringify(stub)}, "{{result}}"], model: "stub", source: "flag" };
    const options = { now: ${JSON.stringify(FIXED_NOW)}, agentConfig };
    Promise.resolve(${fnName}(${JSON.stringify(runId)}, ${JSON.stringify(cwd)}, options)).then((result) => {
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(result));
      process.exit(0);
    }).catch((err) => {
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ error: String((err && err.stack) || err) }));
      process.exit(1);
    });
  `;
}

// Spawns the driver (real, separate OS process -- child_process.spawn, not
// spawnSync, so THIS process stays free to poll the timing log and deliver
// the signal while the driver runs), waits for round 1's stub to genuinely
// start, sends the real signal, then waits for the driver to exit and
// returns its written result.
async function runDriverAndSignal(fnName, runId, work, stub, timingLog, signal) {
  const resultFile = path.join(work, `result-${fnName}-${signal}.json`);
  const child = spawn(process.execPath, ["-e", driverScript(fnName, runId, work, stub, resultFile)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, CW_NO_AUTO_AGENT: "1" }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitForMarker(timingLog, (e) => e.event === "start", 5000);

  // The real, kernel-delivered signal: this test's OWN process signaling a
  // genuinely SEPARATE child process by PID. There is no self-emit, no
  // same-tick shortcut -- the child must receive this exactly the way a
  // terminal Ctrl-C or a supervisor's `kill` would deliver it.
  process.kill(child.pid, signal);

  const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  assert.equal(exitCode, 0, `${fnName}'s driver (real ${signal}) must exit cleanly, not crash (stderr: ${stderr})`);
  return JSON.parse(fs.readFileSync(resultFile, "utf8"));
}

// ---------------------------------------------------------------------
// (a) A REAL signal actually stops driveAsync() after round 1 -- proving
//     the fix (a genuine setImmediate-based event-loop yield between
//     rounds) is real, not just plausible in theory.
// ---------------------------------------------------------------------
async function testRealSignalInterruptsDriveAsync(signal) {
  clearAgentEnv();
  const cwd0 = process.cwd();
  const appsDir = tmp(`cw-realsig-async-apps-${signal}-`);
  const work = tmp(`cw-realsig-async-work-${signal}-`);
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const timingLog = path.join(work, "timing.jsonl");
  const stub = writeStub(path.join(work, "stub.js"), timingLog);
  const appId = `realsig-async-${signal}`.toLowerCase();
  writeThreeTaskApp(appsDir, appId);
  process.chdir(work);
  try {
    process.env.CW_APPS_DIR = appsDir;
    const p = plan(loadWorkflowApp(appId), { repo: work, question: "Q?" });
    assert.equal(p.tasks.length, 3, "fixture app must have exactly 3 sequential tasks");

    const result = await runDriverAndSignal("driveAsync", p.id, work, stub, timingLog, signal);
    assert.ok(!result.error, `driveAsync must not throw on a real ${signal} (${result.error})`);
    assert.equal(result.status, "blocked", `a REAL ${signal} sent mid-round must actually stop driveAsync -- got status=${result.status}`);
    assert.equal(result.completedWorkers, 1, "exactly 1 task completes before the real signal stops the next round from starting");
    const last = result.steps[result.steps.length - 1];
    assert.match(last.reason || "", new RegExp(`drive interrupted by ${signal}`), "the terminal step must name the interrupting signal");

    // Confirm round 2 never even started -- the signal landed while round 1
    // was still running (not comfortably after everything finished).
    const events = readMarkers(timingLog);
    assert.equal(events.filter((e) => e.event === "start").length, 1, "round 2's agent must never have been spawned");
    assert.equal(events.filter((e) => e.event === "end").length, 1, "only round 1's stub finishes");

    // Resuming (plain drive() is fine here -- this step isn't testing signal
    // delivery) finishes the remaining 2 tasks, same graceful-stop contract
    // the existing sigint-sigterm-drive-loop-smoke.js already pins.
    const resumed = drive(p.id, work, { now: FIXED_NOW, agentConfig: agentConfigFor(stub) });
    assert.equal(resumed.status, "complete", "re-driving the interrupted run resumes to completion");
    assert.equal(resumed.completedWorkers, 3);
  } finally {
    process.chdir(cwd0);
  }
}

// ---------------------------------------------------------------------
// (b) THE CONTRAST: the identical real signal, delivered at the identical
//     reliable mid-round timing, has NO effect at all on the plain,
//     synchronous drive() -- proving (a) above is a real, targeted fix and
//     not a coincidence of this particular fixture/timing.
// ---------------------------------------------------------------------
async function testRealSignalDoesNotInterruptPlainDrive(signal) {
  clearAgentEnv();
  const cwd0 = process.cwd();
  const appsDir = tmp(`cw-realsig-plain-apps-${signal}-`);
  const work = tmp(`cw-realsig-plain-work-${signal}-`);
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const timingLog = path.join(work, "timing.jsonl");
  const stub = writeStub(path.join(work, "stub.js"), timingLog);
  const appId = `realsig-plain-${signal}`.toLowerCase();
  writeThreeTaskApp(appsDir, appId);
  process.chdir(work);
  try {
    process.env.CW_APPS_DIR = appsDir;
    const p = plan(loadWorkflowApp(appId), { repo: work, question: "Q?" });

    const result = await runDriverAndSignal("drive", p.id, work, stub, timingLog, signal);
    assert.ok(!result.error, `plain drive() must not throw on a real ${signal} either (${result.error})`);
    // This is the whole point: the plain, fully synchronous drive() never
    // gets an event-loop turn until the entire multi-round loop already
    // finished on its own, so the queued signal has nothing left to invoke
    // by the time one becomes available -- it drives straight through as if
    // nothing happened. Documented, accepted, unfixed limitation of the
    // synchronous entry point (kept for backward compatibility); this is
    // exactly the gap driveAsync() exists to close for live callers.
    assert.equal(result.status, "complete", "a real signal has NO effect on the plain synchronous drive() -- the accepted gap driveAsync() closes");
    assert.equal(result.completedWorkers, 3, "all 3 tasks complete -- the real signal was silently dropped, never stopping anything");
  } finally {
    process.chdir(cwd0);
  }
}

async function main() {
  await testRealSignalInterruptsDriveAsync("SIGINT");
  await testRealSignalInterruptsDriveAsync("SIGTERM");
  await testRealSignalDoesNotInterruptPlainDrive("SIGINT");
  await testRealSignalDoesNotInterruptPlainDrive("SIGTERM");
  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  process.stdout.write(
    "drive-async-real-signal-smoke: ok (a REAL kernel-delivered SIGINT/SIGTERM, sent from a separate OS process, actually " +
      "stops driveAsync mid-run and is silently dropped by the plain synchronous drive() -- proving the fix is real, not just plausible)\n"
  );
}

main().catch((e) => {
  process.stderr.write(`FAIL  drive-async-real-signal-smoke.js — ${String((e && e.message) || e)}\n`);
  process.exit(1);
});
