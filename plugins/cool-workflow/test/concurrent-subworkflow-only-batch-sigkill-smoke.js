#!/usr/bin/env node
"use strict";

// concurrent-subworkflow-only-batch-sigkill-smoke — proves the pre-spawn
// checkpoint in prepareConcurrentOutcomes still fires for a concurrent-round
// batch made ENTIRELY of sub-workflow tasks (zero real spawn jobs), using a
// genuinely EXTERNAL SIGKILL, never a trappable JS signal.
//
// Regression this guards: prepareConcurrentOutcomes skips building a spawn
// job for a sub-workflow task (it always settles through processSelectedTask's
// own runSubWorkflow branch instead — see concurrent-subworkflow-no-wasted-
// spawn-smoke.js). If the pre-spawn checkpoint stayed gated on "did this batch
// build any spawn jobs" (jobs.length > 0), a batch with NO plain agent
// sibling — only sub-workflow tasks — would build zero jobs and skip that
// checkpoint entirely, even though each task's dispatch (workerId
// assignment) already mutated the round-cached run object. The round then
// runs a MINUTES-LONG recursive drive() call for the child workflow with the
// parent's own dispatch never flushed to disk. A crash during that window
// loses the parent batch's dispatch bookkeeping outright.
//
// Fixed: the checkpoint is now gated on "was anything in this batch actually
// dispatched this round", tracked independently of jobs.length.
//
// This test SIGKILLs the driver while the CHILD sub-workflow's own agent
// stub is provably still running (a "start" marker seen, no "end" marker
// yet) and then reads the PARENT's state.json directly off disk to confirm
// both sub-workflow tasks already show status "running" with a workerId —
// not "pending" with no workerId, which is what a lost dispatch would show.

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

const FIXED_NOW = "2026-07-13T00:00:00.000Z";
// Long enough that a loaded CI runner reliably delivers the SIGKILL well
// before the child stub reaches its "end" write (mirrors
// drive-concurrent-round-sigkill-smoke.js's STEP_MS reasoning).
const STEP_MS = 4000;
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

// Child app: ONE plain agent task, so its own drive() recursion is a
// simple serial round — the SLOW stub above is what gives us the window
// to observe "start" and SIGKILL before "end".
function writeChildApp(appsDir, id) {
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
      inputs: [{ name: "repo", type: "path", required: true }],
      workflow: { entrypoint: "workflow.js" }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "workflow.js"),
    `module.exports = ({ workflow, phase, agent, input }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 1, maxConcurrentAgents: 1 },
  inputs: [input("repo", { type: "path", required: true })],
  phases: [phase("Solo", [agent("child:only", "Do the one child thing.")])]
});
`,
    "utf8"
  );
}

// Parent app: ONE parallel() phase with ONLY sub-workflow tasks (no plain
// agent sibling) — the exact "jobs.length === 0" topology the regression
// needs to be reachable.
function writeParentApp(appsDir, id, childId) {
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
      inputs: [{ name: "repo", type: "path", required: true }],
      workflow: { entrypoint: "workflow.js" }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "workflow.js"),
    `module.exports = ({ workflow, parallel, subWorkflow, input }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: { maxAgents: 2, maxConcurrentAgents: 2 },
  inputs: [input("repo", { type: "path", required: true })],
  phases: [parallel("Fan", [
    subWorkflow("wf:a", ${JSON.stringify(childId)}, { inputs: {} }),
    subWorkflow("wf:b", ${JSON.stringify(childId)}, { inputs: {} })
  ])]
});
`,
    "utf8"
  );
}

function driverScript(runId, cwd, stub) {
  return `
    const { drive } = require(${JSON.stringify(drivePath)});
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [${JSON.stringify(stub)}, "{{result}}"], model: "stub", source: "flag", timeoutMs: 30000 };
    drive(${JSON.stringify(runId)}, ${JSON.stringify(cwd)}, { now: ${JSON.stringify(FIXED_NOW)}, agentConfig, concurrency: 2, once: true });
  `;
}

async function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();
  const appsDir = tmp("cw-sigkill-subwf-apps-");
  const work = tmp("cw-sigkill-subwf-work-");
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const timingLog = path.join(work, "timing.jsonl");
  const stub = writeStub(path.join(work, "stub.js"), timingLog);
  const childId = "subwf-only-child";
  const parentId = "subwf-only-parent";
  writeChildApp(appsDir, childId);
  writeParentApp(appsDir, parentId, childId);
  process.chdir(work);
  try {
    process.env.CW_APPS_DIR = appsDir;
    const p = plan(loadWorkflowApp(parentId), { repo: work });
    assert.equal(p.tasks.length, 2, "fixture parent app must have exactly 2 sub-workflow tasks in one batch");
    assert.ok(
      p.tasks.every((t) => t.status === "pending" && !t.workerId),
      "before driving, every parent task is pending with no workerId — the baseline this test proves the fix changed"
    );

    const child = spawn(process.execPath, ["-e", driverScript(p.id, work, stub)], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, CW_NO_AUTO_AGENT: "1" }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    // Wait until the child sub-workflow's own agent stub has started (proving
    // we are deep inside runSubWorkflow's recursive drive() call, well past
    // the parent round's prepareConcurrentOutcomes and its pre-spawn
    // checkpoint) and it has not finished yet.
    await waitForMarker(timingLog, (lines) => lines.filter((l) => l.event === "start").length >= 1, 5000);
    const beforeKill = fs
      .readFileSync(timingLog, "utf8")
      .trim()
      .split(/\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.equal(beforeKill.filter((l) => l.event === "end").length, 0, "SIGKILL must land before the child stub finishes — proves this is mid sub-workflow recursion, not a lucky race after completion");

    process.kill(child.pid, "SIGKILL");
    await new Promise((resolve) => child.on("exit", resolve));
    void stderr;

    const afterState = JSON.parse(fs.readFileSync(p.paths.state, "utf8"));
    const tasksById = new Map(afterState.tasks.map((t) => [t.id, t]));
    for (const taskId of ["wf:a", "wf:b"]) {
      const task = tasksById.get(taskId);
      assert.ok(task, `task ${taskId} must still exist in the parent's state.json after the kill`);
      assert.equal(task.status, "running", `${taskId}: dispatch must have survived the SIGKILL (status durably "running", not lost back to "pending") — an all-sub-workflow batch builds zero spawn jobs, so this checkpoint must not be gated on jobs.length`);
      assert.ok(task.workerId, `${taskId}: workerId assignment must have survived the SIGKILL, not just lived in the killed process's memory`);
    }
  } finally {
    process.chdir(cwd0);
    for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  }

  process.stdout.write(
    "concurrent-subworkflow-only-batch-sigkill-smoke: ok (a REAL SIGKILL landing mid sub-workflow recursion still leaves an all-sub-workflow batch's dispatch durably recorded in state.json)\n"
  );
}

main().catch((e) => {
  process.stderr.write(`FAIL  concurrent-subworkflow-only-batch-sigkill-smoke.js — ${String((e && e.message) || e)}\n`);
  process.exit(1);
});
