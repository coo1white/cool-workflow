#!/usr/bin/env node
"use strict";

// Track B failure-recovery story: a partially completed run is exported from one
// repo, restored into another, verified by digest, then continued from the
// restored state. This proves the archive is operational state, not just bytes.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));

const sourceRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-restore-source-")));
const restoredRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-restore-target-")));
const archivePath = path.join(sourceRepo, "partial-run.cwrun.json");
fs.writeFileSync(path.join(sourceRepo, "README.md"), "# source\n", "utf8");

function cliJson(args, cwd) {
  return JSON.parse(execFileSync(node, [cli, ...args], { cwd, encoding: "utf8" }));
}

function resultMarkdown(summary, evidence = []) {
  return [
    `# ${summary}`,
    "",
    "```cw:result",
    JSON.stringify({ summary, findings: [], evidence }, null, 2),
    "```",
    ""
  ].join("\n");
}

const originalCwd = process.cwd();
try {
  process.chdir(sourceRepo);
  const runner = new CoolWorkflowRunner({ pluginRoot });
  const run = runner.plan("workflow-app-framework-demo", {
    cwd: sourceRepo,
    repo: sourceRepo,
    question: "prove restore can resume a partial run"
  });
  assert.deepEqual(run.tasks.map((task) => task.id), ["inspect:contract", "implement:change", "verify:evidence"]);

  const firstDispatch = runner.dispatch(run.id, { limit: 1 });
  assert.equal(firstDispatch.tasks[0].id, "inspect:contract", "first phase dispatches inspect task");
  const firstWorkerId = firstDispatch.tasks[0].workerId;
  assert.ok(firstWorkerId, "first dispatch allocates a worker");
  const firstResultPath = firstDispatch.tasks[0].workerResultPath;
  fs.writeFileSync(firstResultPath, resultMarkdown("source inspect completed", ["README.md:1"]), "utf8");
  runner.recordWorkerOutput(run.id, firstWorkerId, firstResultPath);

  const sourceMid = runner.loadRun(run.id);
  assert.equal(sourceMid.tasks.find((task) => task.id === "inspect:contract").status, "completed");
  assert.equal(sourceMid.tasks.find((task) => task.id === "implement:change").status, "pending");
  assert.equal(sourceMid.tasks.find((task) => task.id === "implement:change").workerId, undefined);

  const exported = cliJson(["run", "export", run.id, "--output", archivePath], sourceRepo);
  assert.equal(exported.runId, run.id);
  assert.ok(exported.fileCount > 0, "partial run archive includes run-local files");

  const imported = cliJson(["run", "import", archivePath, "--target", restoredRepo], pluginRoot);
  assert.equal(imported.run.id, run.id);
  assert.equal(imported.verification.ok, true, "import verifies the restored archive");

  const verified = cliJson(["run", "verify-import", run.id], restoredRepo);
  assert.equal(verified.ok, true, "restored run verifies before resume");

  const resume = cliJson(["run", "resume", run.id, "--scope", "repo", "--json"], restoredRepo);
  assert.equal(resume.repo, restoredRepo, "resume resolves restored repo, not source repo");
  assert.equal(resume.resumable, true, "restored partial run is resumable");
  assert.equal(resume.nextTasks[0].id, "implement:change", "resume points at the next pending task");

  const secondDispatch = cliJson(["dispatch", run.id, "--limit", "1"], restoredRepo);
  assert.equal(secondDispatch.tasks[0].id, "implement:change", "restored run dispatches the next task");
  assert.ok(secondDispatch.tasks[0].workerDir.startsWith(restoredRepo), "new worker lives under restored repo");

  const secondResultPath = secondDispatch.tasks[0].workerResultPath;
  fs.writeFileSync(secondResultPath, resultMarkdown("restored implementation completed"), "utf8");
  const accepted = cliJson(["worker", "output", run.id, secondDispatch.tasks[0].workerId, secondResultPath], restoredRepo);
  assert.equal(accepted.tasks.completed, 2, "restored run accepts new worker output");

  const restoredState = JSON.parse(fs.readFileSync(path.join(restoredRepo, ".cw", "runs", run.id, "state.json"), "utf8"));
  assert.equal(restoredState.cwd, restoredRepo, "restored state is rebased to the target repo");
  assert.equal(restoredState.tasks.find((task) => task.id === "inspect:contract").status, "completed");
  assert.equal(restoredState.tasks.find((task) => task.id === "implement:change").status, "completed");

  const sourceState = JSON.parse(fs.readFileSync(path.join(sourceRepo, ".cw", "runs", run.id, "state.json"), "utf8"));
  assert.equal(sourceState.tasks.find((task) => task.id === "implement:change").status, "pending", "source run remains unchanged after restored resume");
  assert.equal(sourceState.tasks.find((task) => task.id === "implement:change").workerId, undefined, "source run gets no restored worker");
} finally {
  process.chdir(originalCwd);
}

process.stdout.write("run-export-restore-resume-smoke: ok\n");
