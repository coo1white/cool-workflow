#!/usr/bin/env node
"use strict";

// @cw-smoke: timeout 180
// drive-result-prewrite-symlink-smoke — the drive's OWN writes onto a worker's
// result.md must hold the same write boundary `cw result` holds (#785).
//
// Two drive paths write manifest.resultPath before recordWorkerOutput checks it:
// a result-cache hit (copies the cached bytes in) and a sub-workflow task
// (writes the child report in). A result.md left as a symlink to a file outside
// the run would make that write go through the link. The drive now checks the
// path with validateSandboxWrite first and refuses (sandbox-write-denied).
//
//   1. Cache hit on a reused worker dir: a parked worker's agent left result.md
//      as a symlink; another run fills the result cache; the resume reopens the
//      SAME worker dir and hits the cache. The outside file is not written.
//   2. Sub-workflow: while the child run drives, a child agent plants a symlink
//      at the parent worker's result.md. The child report is not written through it.
//   3. Control: a plain cache hit still completes.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));

const NOW = "2026-06-20T00:00:00.000Z";
const ORIGINAL = "ORIGINAL-OUTSIDE-BYTES\n";
const cwd0 = process.cwd();

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}
// The stub agent. In its cwd: `plant.flag` makes it leave result.md as a
// symlink to outside.md and fail; `plant-parent.txt` (a run id) makes it plant
// that symlink at every not-yet-written result.md of that run, then succeed.
function writeStub(file) {
  fs.writeFileSync(file, [
    'const fs = require("fs");',
    'const path = require("path");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const outside = path.join(process.cwd(), "outside.md");',
    'if (fs.existsSync("plant.flag")) {',
    "  fs.rmSync(rp, { force: true });",
    "  fs.symlinkSync(outside, rp);",
    "  process.exit(1);",
    "}",
    'if (fs.existsSync("plant-parent.txt")) {',
    '  const workers = path.join(".cw", "runs", fs.readFileSync("plant-parent.txt", "utf8").trim(), "workers");',
    "  for (const name of fs.readdirSync(workers)) {",
    '    const target = path.join(workers, name, "result.md");',
    "    if (fs.statSync(path.join(workers, name)).isDirectory() && !fs.existsSync(target)) fs.symlinkSync(outside, target);",
    "  }",
    "}",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 4, output_tokens: 2 } }));'
  ].join("\n"), "utf8");
  return file;
}
function agentConfig(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "op", source: "flag" };
}
function writeApp(appsDir, id, apiNames, phasesSrc) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify({
    schemaVersion: 1, id, title: id, summary: id, version: "0.1.0", author: "test",
    inputs: [{ name: "question", type: "string" }],
    sandboxProfiles: ["readonly"],
    compatibility: { minVersion: "0.1.9" },
    workflow: { entrypoint: "workflow.js" }
  }, null, 2));
  fs.writeFileSync(path.join(dir, "workflow.js"), `module.exports = ({ ${apiNames} }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 6, maxConcurrentAgents: 1 },
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: ${phasesSrc}
});\n`);
}
function setupWork(appsDir) {
  const work = tmp("cw-prewrite-work-");
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  fs.writeFileSync(path.join(work, "outside.md"), ORIGINAL, "utf8");
  process.env.CW_APPS_DIR = appsDir;
  return { work, stub: writeStub(path.join(work, "stub.js")) };
}
function planRun(appId, work) {
  return plan(loadWorkflowApp(appId), { repo: work, question: "Q?" });
}
function stepReasons(result) {
  return result.steps.map((s) => s.reason || "").join("\n");
}

function main() {
  clearAgentEnv();
  const appsDir = tmp("cw-prewrite-apps-");
  writeApp(appsDir, "prewrite-leaf", "workflow, phase, agent, input",
    `[ phase("Work", [ agent("work:do", "Do {{question}}", { sandboxProfileId: "readonly" }) ]) ]`);
  writeApp(appsDir, "prewrite-parent", "workflow, phase, subWorkflow, input",
    `[ phase("Delegate", [ subWorkflow("delegate:child", "prewrite-leaf", { sandboxProfileId: "readonly" }) ]) ]`);

  // ===== 1: cache hit onto a reused worker dir with a planted symlink =====
  {
    const { work, stub } = setupWork(appsDir);
    process.chdir(work);
    try {
      // Run B: the agent leaves result.md as a symlink and fails; B parks.
      fs.writeFileSync(path.join(work, "plant.flag"), "", "utf8");
      const runB = planRun("prewrite-leaf", work);
      const first = drive(runB.id, work, { now: NOW, incremental: true, policy: { maxAttempts: 1 }, agentConfig: agentConfig(stub) });
      assert.equal(first.status, "parked", "run B parks after its agent fails");
      const workerId = loadRunFromCwd(runB.id, work).tasks[0].workerId;
      const resultPath = path.join(work, ".cw", "runs", runB.id, "workers", workerId, "result.md");
      assert.ok(fs.lstatSync(resultPath).isSymbolicLink(), "the planted symlink is left in run B's worker dir");
      fs.rmSync(path.join(work, "plant.flag"));

      // Run A (same app, same inputs, same agent): completes and fills the cache.
      const runA = planRun("prewrite-leaf", work);
      const filled = drive(runA.id, work, { now: NOW, incremental: true, agentConfig: agentConfig(stub) });
      assert.equal(filled.status, "complete", "run A completes and writes the result cache");

      // Resume run B: the parked worker is reopened in the SAME worker dir and hits the cache.
      const resumed = drive(runB.id, work, { now: NOW, incremental: true, reopenParked: true, policy: { maxAttempts: 1 }, agentConfig: agentConfig(stub) });
      assert.deepEqual(resumed.reopenedWorkers, ["work:do"], "the resume reopened run B's parked worker");
      assert.equal(fs.readFileSync(path.join(work, "outside.md"), "utf8"), ORIGINAL, "the cache hit did not write through the symlink");
      assert.notEqual(resumed.status, "complete", "the run is not accepted");
      assert.match(stepReasons(resumed), /result cache rejected: .*resolves through a symlink outside sandbox profile/, "refused as sandbox-write-denied");
      assert.notEqual(loadRunFromCwd(runB.id, work).tasks[0].status, "completed", "the task is not completed");
      console.log("drive-result-prewrite: result-cache hit refuses a symlinked result.md ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 2: sub-workflow result write onto a planted symlink =====
  {
    const { work, stub } = setupWork(appsDir);
    process.chdir(work);
    try {
      const parent = planRun("prewrite-parent", work);
      fs.writeFileSync(path.join(work, "plant-parent.txt"), parent.id, "utf8");
      const result = drive(parent.id, work, { now: NOW, policy: { maxAttempts: 1 }, agentConfig: agentConfig(stub) });
      assert.equal(fs.readFileSync(path.join(work, "outside.md"), "utf8"), ORIGINAL, "the child report was not written through the symlink");
      assert.equal(result.status, "parked", "the parent parks");
      assert.match(stepReasons(result), /sub-workflow result rejected by parent gate: .*resolves through a symlink outside sandbox profile/, "refused as sandbox-write-denied");
      console.log("drive-result-prewrite: sub-workflow write refuses a symlinked result.md ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 3: control — a plain cache hit is still accepted =====
  {
    const { work, stub } = setupWork(appsDir);
    process.chdir(work);
    try {
      const runA = planRun("prewrite-leaf", work);
      assert.equal(drive(runA.id, work, { now: NOW, incremental: true, agentConfig: agentConfig(stub) }).status, "complete");
      const runC = planRun("prewrite-leaf", work);
      const hit = drive(runC.id, work, { now: NOW, incremental: true, agentConfig: agentConfig(stub) });
      assert.equal(hit.status, "complete", "a plain cache hit completes");
      assert.ok(hit.steps.some((s) => s.handleKind === "result-cache"), "the result came from the cache");
      console.log("drive-result-prewrite: plain cache hit ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  console.log("drive-result-prewrite-symlink-smoke: ok");
}

main();
