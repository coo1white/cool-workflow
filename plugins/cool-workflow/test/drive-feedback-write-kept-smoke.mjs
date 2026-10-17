#!/usr/bin/env node
// drive-feedback-write-kept-smoke — a `cw worker fail`, `cw feedback
// collect` or `cw audit attest` made while a drive waits on its agent must
// still be in state.json after the drive's next save.
//
// BACKLOG row of 2026-09-26: a drive round loads the run once, waits on its
// agent(s), then saves; a non-drive writer (worker, feedback, audit, an MCP
// tool) takes only withRunStateLock around its own load and save, so the
// round's save could put its older copy back over that write.
//
//   Part A: a serial round (end-to-end-golden-path, one task):
//     `cw audit attest`.
//   Part B: a concurrent round (architecture-review, --concurrency 2):
//     `cw dispatch`, `cw worker fail` on a third Map worker, `cw feedback
//     collect` (records the failure as feedback), `cw audit attest`.
//
// In each part the stub agent writes its result, then waits on a FILE
// barrier; while it waits this test runs the other writes from separate
// processes; then it lets the agent go. No sleeps decide the order: the
// barrier files do.
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");

const RESULT = (summary) =>
  `# r\n\n\`\`\`cw:result\n{"summary":${JSON.stringify(summary)},"findings":[],"evidence":["README.md:1"]}\n\`\`\`\n`;

function childEnv() {
  const env = { ...process.env, CW_NO_AUTO_AGENT: "1" };
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete env[v];
  return env;
}

function cw(cwd, args) {
  return execFileSync(node, [cli, ...args], { cwd, encoding: "utf8", env: childEnv() });
}

function writeStub(file) {
  fs.writeFileSync(
    file,
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const [barrier, resultPath] = process.argv.slice(2);",
      `fs.writeFileSync(resultPath, ${JSON.stringify(RESULT("stub agent result"))});`,
      'fs.writeFileSync(path.join(barrier, "waiting-" + process.pid), resultPath);',
      'while (!fs.existsSync(path.join(barrier, "release"))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);',
      'process.stdout.write(JSON.stringify({ model: "stub-model" }));',
    ].join("\n"),
    "utf8"
  );
}

function writeDriver(file) {
  fs.writeFileSync(
    file,
    [
      `const { drive } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "drive.js"))});`,
      "const [runId, cwd, stub, barrier, width] = process.argv.slice(2);",
      "const agentConfig = { schemaVersion: 1, command: process.execPath, args: [stub, barrier, '{{result}}'], source: 'flag' };",
      "const result = drive(runId, cwd, { once: true, concurrency: Number(width), agentConfig });",
      "process.stdout.write(JSON.stringify(result));",
    ].join("\n"),
    "utf8"
  );
}

async function waitFor(check, what) {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((res) => setTimeout(res, 10));
  }
}

async function runCase({ label, app, width, agents, failWorkerOf }) {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-feedback-kept-")));
  try {
    fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
    const barrier = path.join(work, "barrier");
    fs.mkdirSync(barrier);
    const stub = path.join(work, "stub.cjs");
    const driver = path.join(work, "driver.cjs");
    writeStub(stub);
    writeDriver(driver);

    const runId = JSON.parse(cw(work, ["plan", app, "--repo", work, "--question", "feedback kept"])).runId;
    const statePath = path.join(work, ".cw", "runs", runId, "state.json");
    const readState = () => JSON.parse(fs.readFileSync(statePath, "utf8"));

    let driveOut = "";
    let driveErr = "";
    const child = spawn(node, [driver, runId, work, stub, barrier, String(width)], { cwd: work, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (driveOut += d));
    child.stderr.on("data", (d) => (driveErr += d));
    const exited = new Promise((res) => child.on("exit", (code) => res(code)));

    await waitFor(() => fs.readdirSync(barrier).filter((f) => f.startsWith("waiting-")).length >= agents, `${label}: ${agents} agent(s) at the barrier`);

    let failedWorker;
    let feedbackIds = [];
    if (failWorkerOf) {
      cw(work, ["dispatch", runId]);
      failedWorker = readState().tasks.find((t) => t.id === failWorkerOf).workerId;
      assert.ok(failedWorker, `${label}: ${failWorkerOf} has a worker after cw dispatch`);
      cw(work, ["worker", "fail", runId, failedWorker, "operator saw a fault"]);
      feedbackIds = JSON.parse(cw(work, ["feedback", "collect", runId])).map((f) => f.id);
      assert.ok(feedbackIds.length > 0, `${label}: cw feedback collect recorded feedback`);
    }
    const attestation = JSON.parse(cw(work, ["audit", "attest", runId, "--note", "operator note during drive"]));
    assert.ok(attestation.id, `${label}: the attestation was recorded`);

    fs.writeFileSync(path.join(barrier, "release"), "go", "utf8");
    const code = await exited;
    assert.equal(code, 0, `${label}: drive exits 0 (stderr: ${driveErr})`);
    const state = readState();

    for (const id of feedbackIds) {
      assert.ok((state.feedback || []).some((f) => f.id === id), `${label}: feedback ${id} survives the drive's save (lost update)`);
    }
    if (failedWorker) {
      assert.equal(state.workers.find((w) => w.id === failedWorker).status, "failed", `${label}: the \`cw worker fail\` on ${failedWorker} survives the drive's save (lost update)`);
    }
    // Audit events live in their own append-only log, not in state.json.
    const events = fs.readFileSync(path.join(work, ".cw", "runs", runId, "audit", "events.jsonl"), "utf8");
    assert.ok(events.includes(JSON.stringify(attestation.id)), `${label}: the attestation ${attestation.id} is kept in the audit log`);

    // The drive's own work is kept too.
    const result = JSON.parse(driveOut);
    const driven = result.steps.filter((s) => s.action === "accept" && s.status === "ok").map((s) => s.taskId);
    assert.equal(driven.length, agents, `${label}: the drive accepted ${agents} agent result(s)`);
    for (const id of driven) {
      assert.equal(state.tasks.find((t) => t.id === id).status, "completed", `${label}: the drive's own accept of ${id} is saved`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

(async () => {
  await runCase({ label: "serial", app: "end-to-end-golden-path", width: 1, agents: 1 });
  await runCase({ label: "concurrent", app: "architecture-review", width: 2, agents: 2, failWorkerOf: "map:transport-core" });
  process.stdout.write("drive-feedback-write-kept-smoke: ok (worker, feedback and audit writes survive a live drive's save)\n");
})().catch((error) => {
  process.stderr.write(`drive-feedback-write-kept-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
