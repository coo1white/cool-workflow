#!/usr/bin/env node
// Track B failure recovery: a failed run is exported, restored on another
// "machine" (directory), discovered through the home registry, and rerun from a
// neutral cwd. Import must register/refresh the restored repo; otherwise the
// control plane cannot find the run outside the target directory.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
// recordWorkerFailure records an error node + trust-audit event and an
// error-feedback record, so a failed source run carries a non-empty
// run.feedback, and the restored run's derivedLifecycle reads "blocked"
// (deriveLifecycle returns "blocked" when openFeedback > 0).
import { plan as planApp } from "../dist/shell/pipeline.js";
import { loadWorkflowApp } from "../dist/shell/workflow-app-loader.js";
import { loadRunFromCwd, saveCheckpoint } from "../dist/shell/run-store.js";
import { dispatchRun } from "../dist/shell/pipeline-cli.js";
import { recordWorkerFailure } from "../dist/shell/worker-isolation.js";

const CoolWorkflowRunner = function () {
  let lastCwd = process.cwd();
  return {
    plan(workflowId, options = {}) {
      lastCwd = String(options.repo || options.cwd || process.cwd());
      return planApp(loadWorkflowApp(workflowId), options);
    },
    dispatch(runId, options = {}) {
      return dispatchRun({ runId, cwd: lastCwd, ...options });
    },
    recordWorkerFailure(runId, workerId, message, options = {}) {
      const run = loadRunFromCwd(runId, lastCwd);
      const updated = recordWorkerFailure(run, workerId, message, options);
      saveCheckpoint(run);
      return updated;
    },
    loadRun(runId) { return loadRunFromCwd(runId, lastCwd); }
  };
};

const cwHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-restore-rerun-home-")));
const sourceRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-restore-rerun-source-")));
const restoredRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-restore-rerun-target-")));
const controlRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-restore-rerun-control-")));
const archivePath = path.join(sourceRepo, "failed-run.cwrun.json");
fs.writeFileSync(path.join(sourceRepo, "README.md"), "# failed source\n", "utf8");

const env = { ...process.env, CW_HOME: cwHome };
function cliJson(args, cwd) {
  return JSON.parse(execFileSync(node, [cli, ...args], { cwd, env, encoding: "utf8" }));
}

const originalCwd = process.cwd();
try {
  process.chdir(sourceRepo);
  const runner = new CoolWorkflowRunner({ pluginRoot });
  const run = runner.plan("workflow-app-framework-demo", {
    cwd: sourceRepo,
    repo: sourceRepo,
    question: "prove restored failed run can rerun from control plane"
  });
  const dispatch = runner.dispatch(run.id, { limit: 1 });
  const workerId = dispatch.tasks[0].workerId;
  assert.ok(workerId, "failed run has a worker to fail");
  runner.recordWorkerFailure(run.id, workerId, "simulated machine-loss failure", {
    code: "simulated-failure",
    retryable: false
  });

  const sourceFailed = runner.loadRun(run.id);
  assert.equal(sourceFailed.tasks[0].status, "failed", "source run is failed before export");
  assert.ok((sourceFailed.feedback || []).some((entry) => entry.status === "open"), "source run has visible failure feedback");

  const exported = cliJson(["run", "export", run.id, "--output", archivePath], sourceRepo);
  assert.equal(exported.runId, run.id);

  const imported = cliJson(["run", "import", archivePath, "--target", restoredRepo], controlRepo);
  assert.equal(imported.verification.ok, true, "import verifies the failed run archive");

  const found = cliJson(["run", "show", run.id, "--cwd", controlRepo, "--scope", "home", "--json"], controlRepo);
  assert.equal(found.found, true, "home registry discovers the restored run from a neutral cwd");
  assert.equal(found.repo, restoredRepo, "discovered run belongs to the restored repo");
  assert.equal(found.record.derivedLifecycle, "blocked", "failed run with open feedback remains visibly blocked");

  const rerun = cliJson(["run", "rerun", run.id, "--cwd", controlRepo, "--scope", "home", "--reason", "restore recovery smoke"], controlRepo);
  assert.equal(rerun.originalRunId, run.id);
  assert.equal(rerun.originalRepo, restoredRepo, "rerun is based on the restored copy");
  assert.equal(rerun.repo, restoredRepo, "new run lands beside the restored copy");
  assert.equal(rerun.provenance.rerunOf, run.id);
  assert.equal(rerun.provenance.rerunOfRepo, restoredRepo);
  assert.equal(rerun.provenance.originRunId, run.id);
  assert.equal(rerun.provenance.generation, 1);
  assert.ok(fs.existsSync(rerun.statePath), "new rerun state exists");
  assert.ok(rerun.statePath.startsWith(restoredRepo), "new rerun state is in restored repo");

  const child = cliJson(["run", "show", rerun.newRunId, "--cwd", controlRepo, "--scope", "home", "--json"], controlRepo);
  assert.equal(child.found, true, "new linked run is discoverable through home registry");
  assert.equal(child.record.provenance.rerunOf, run.id, "new run surfaces rerun provenance");
  assert.equal(child.record.provenance.originRunId, run.id, "new run keeps origin provenance");

  const sourceState = JSON.parse(fs.readFileSync(path.join(sourceRepo, ".cw", "runs", run.id, "state.json"), "utf8"));
  assert.equal(sourceState.tasks[0].status, "failed", "source failed run remains preserved");
  assert.ok(!fs.existsSync(path.join(sourceRepo, ".cw", "runs", rerun.newRunId)), "rerun did not mutate/source-create in original repo");
} finally {
  process.chdir(originalCwd);
}

process.stdout.write("run-export-restore-rerun-smoke: ok\n");
