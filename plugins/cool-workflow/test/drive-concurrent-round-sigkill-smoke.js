#!/usr/bin/env node
"use strict";

// drive-concurrent-round-sigkill-smoke — proves driveConcurrentRound's
// per-task dispatch is ACTUALLY durable before a real crash, using a
// genuinely EXTERNAL SIGKILL (this test process calling process.kill() on a
// SEPARATE child process), never process.emit() or a JS signal handler.
//
// SIGKILL is the only way to prove this: it cannot be trapped, so no
// finally/handler logic in the killed process ever runs. Anything durable
// after a SIGKILL landed had to already be flushed to disk BEFORE the kill,
// not "on the way out". (Contrast: drive-async-real-signal-smoke.js proves
// SIGINT/SIGTERM cooperative-yield behavior — a different property, since
// those CAN be trapped.)
//
// Architecture-review P2 (cycle 3): driveConcurrentRound dispatched a whole
// batch of tasks (workerId assignment) and spawned every agent child
// concurrently, all before any of it was durable on disk — a crash any
// time during that spawn window (which the code's own progress message
// calls "may take minutes") lost the round's dispatch bookkeeping entirely.
// On resume the tasks looked never-dispatched and got redispatched from
// scratch. Fixed: prepareConcurrentOutcomes now calls saveCheckpoint right
// before the batch is spawned, so dispatch survives a crash mid-spawn.
//
// This test SIGKILLs the driver while every task's agent stub is
// provably still running (all "start" markers seen, no "end" markers
// yet — i.e., squarely inside the fixed window) and then reads state.json
// directly off disk (the killed process cannot have written anything AFTER
// the kill) to confirm every task already shows status "running" with a
// workerId assigned.

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

const FIXED_NOW = "2026-07-09T00:00:00.000Z";
const STEP_MS = 4000; // generous margin: this test's full suite run sits
// alongside 200+ other smokes under --concurrency auto (see drive-round-
// cache-serial-smoke.js's own note on why wall-clock assertions need
// headroom under that load), and this test additionally waits for 3 REAL
// process spawns to all report "start" before proceeding — slower to reach
// than a single-process wait. Long enough that even a loaded CI runner
// reliably delivers the SIGKILL well before any stub reaches its "end"
// write; the assertion at beforeKill (0 "end" markers) is the actual proof
// this landed mid-spawn, not just a fast/lucky run.
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
      if (predicate(lines)) return lines;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for a marker in ${file}`);
    await sleep(15);
  }
}

// Every concurrently-spawned stub appends to the SAME timing log (its own
// pid distinguishes rows) so this test can observe "N starts, 0 ends" from
// outside without knowing task ids or worker directories in advance.
function writeStub(file, timingLog) {
  const lines = [
    'const fs = require("fs");',
    "const rp = process.argv[2];",
    `const timingLog = ${JSON.stringify(timingLog)};`,
    "function mark(event) { fs.appendFileSync(timingLog, JSON.stringify({ event, pid: process.pid, time: Date.now() }) + '\\n'); }",
    'mark("start");',
    "setTimeout(() => {",
    "  const fence = String.fromCharCode(96).repeat(3);",
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

// 3 tasks in one PLAIN phase; concurrency:3 (passed by the driver script
// below) forces roundWidth to 3 regardless of phase mode, so all 3
// dispatch and spawn together as ONE concurrent round — exactly the code
// path under test.
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
  limits: { maxAgents: 20, maxConcurrentAgents: 3 },
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: [
    phase("Batch", [
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

function driverScript(runId, cwd, stub) {
  return `
    const { drive } = require(${JSON.stringify(drivePath)});
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [${JSON.stringify(stub)}, "{{result}}"], model: "stub", source: "flag" };
    drive(${JSON.stringify(runId)}, ${JSON.stringify(cwd)}, { now: ${JSON.stringify(FIXED_NOW)}, agentConfig, concurrency: 3, once: true });
  `;
}

async function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();
  const appsDir = tmp("cw-sigkill-round-apps-");
  const work = tmp("cw-sigkill-round-work-");
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const timingLog = path.join(work, "timing.jsonl");
  const stub = writeStub(path.join(work, "stub.js"), timingLog);
  const appId = "sigkill-concurrent-round";
  writeThreeTaskApp(appsDir, appId);
  process.chdir(work);
  try {
    process.env.CW_APPS_DIR = appsDir;
    const p = plan(loadWorkflowApp(appId), { repo: work, question: "Q?" });
    assert.equal(p.tasks.length, 3, "fixture app must have exactly 3 tasks in one batch");
    assert.ok(
      p.tasks.every((t) => t.status === "pending" && !t.workerId),
      "before driving, every task is pending with no workerId — the baseline this test proves the fix changed"
    );

    const child = spawn(process.execPath, ["-e", driverScript(p.id, work, stub)], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, CW_NO_AUTO_AGENT: "1" }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    // Wait until all 3 stubs have started (proving the round is deep inside
    // the spawn window: past dispatch, past prepareConcurrentOutcomes'
    // pre-spawn saveCheckpoint, mid runAgentBatchOutcomes) and NONE have
    // finished yet.
    await waitForMarker(timingLog, (lines) => lines.filter((l) => l.event === "start").length >= 3, 5000);
    const beforeKill = fs
      .readFileSync(timingLog, "utf8")
      .trim()
      .split(/\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.equal(beforeKill.filter((l) => l.event === "end").length, 0, "SIGKILL must land before any stub finishes — proves this is a mid-spawn crash, not a lucky race after completion");

    // The real, kernel-delivered, untrappable signal.
    process.kill(child.pid, "SIGKILL");
    await new Promise((resolve) => child.on("exit", resolve));
    void stderr;

    const afterState = JSON.parse(fs.readFileSync(p.paths.state, "utf8"));
    const tasksById = new Map(afterState.tasks.map((t) => [t.id, t]));
    for (const taskId of ["step:one", "step:two", "step:three"]) {
      const task = tasksById.get(taskId);
      assert.ok(task, `task ${taskId} must still exist in state.json after the kill`);
      assert.equal(task.status, "running", `${taskId}: dispatch must have survived the SIGKILL (status durably "running", not lost back to "pending")`);
      assert.ok(task.workerId, `${taskId}: workerId assignment must have survived the SIGKILL, not just lived in the killed process's memory`);
    }
  } finally {
    process.chdir(cwd0);
    for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  }

  process.stdout.write(
    "drive-concurrent-round-sigkill-smoke: ok (a REAL SIGKILL landing mid-spawn still leaves every task's dispatch durably recorded in state.json)\n"
  );
}

main().catch((e) => {
  process.stderr.write(`FAIL  drive-concurrent-round-sigkill-smoke.js — ${String((e && e.message) || e)}\n`);
  process.exit(1);
});
