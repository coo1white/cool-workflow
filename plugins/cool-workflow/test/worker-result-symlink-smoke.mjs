#!/usr/bin/env node
// worker-result-symlink-smoke: the worker write boundary (result file,
// artifacts, logs) must hold on the REAL path, not only the lexical one. A
// worker controls the files under its own worker dir, so a result.md left as a
// symlink (or a symlinked worker dir / artifacts dir) would make CW read, copy,
// and later inject a file from outside the boundary. validateSandboxWrite and
// recordWorkerOutput fail closed with sandbox-write-denied; a plain result and a
// run reached through a symlinked root (macOS /var -> /private/var) still pass.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRunPaths, ensureRunDirs, saveCheckpoint } from "../dist/shell/run-store.js";
import { allocateWorkerScope, recordWorkerOutput } from "../dist/shell/worker-isolation.js";
import { validateSandboxWrite } from "../dist/shell/sandbox-profile.js";

const RESULT = ["# Result", "", "```cw:result", JSON.stringify({ summary: "done", findings: [], evidence: [] }), "```", ""].join("\n");
const OUTSIDE = ["OUTSIDE-SECRET", "", "```cw:result", JSON.stringify({ summary: "leaked", findings: [], evidence: [] }), "```", ""].join("\n");

function setup(root) {
  const runId = "symlink-smoke";
  const paths = createRunPaths(path.join(root, ".cw", "runs", runId));
  ensureRunDirs(paths);
  const run = {
    schemaVersion: 1, id: runId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    cwd: root, workflow: { id: runId, title: "", summary: "", limits: { maxAgents: 4, maxConcurrentAgents: 4 } },
    inputs: {}, loopStage: "interpret",
    phases: [{ id: "assess", name: "Assess", status: "pending", taskIds: ["assess:one"] }],
    tasks: [{
      id: "assess:one", kind: "agent", phase: "Assess", status: "pending",
      prompt: "assess", taskPath: "", resultPath: "", loopStage: "interpret", stateNodeId: `${runId}:task:assess:one`
    }],
    dispatches: [], commits: [], paths, nodes: [], contracts: [], feedback: [], workers: []
  };
  saveCheckpoint(run);
  const scope = allocateWorkerScope(run, run.tasks[0], { workerId: "w", persist: false });
  return { run, scope };
}

function realTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function expectDenied(run, scope, target, why) {
  const violation = validateSandboxWrite(scope.sandboxPolicy, target, "w");
  assert.ok(violation, `${why}: validateSandboxWrite must refuse`);
  assert.equal(violation.code, "sandbox-write-denied", why);
  assert.match(violation.message, /resolves through a symlink outside sandbox profile/, why);
}

// --- Control: a plain result.md is accepted ---
{
  const root = realTmp("cw-symlink-ok-");
  const { run, scope } = setup(root);
  fs.writeFileSync(scope.resultPath, RESULT, "utf8");
  assert.equal(validateSandboxWrite(scope.sandboxPolicy, scope.resultPath, "w"), null, "plain result is inside the boundary");
  recordWorkerOutput(run, "w", scope.resultPath, { persist: false });
  assert.equal(run.tasks[0].status, "completed");
}

// --- result.md is a symlink to a file outside the boundary: refused, nothing copied ---
{
  const root = realTmp("cw-symlink-leaf-");
  const { run, scope } = setup(root);
  const outside = path.join(root, "outside.md");
  fs.writeFileSync(outside, OUTSIDE, "utf8");
  fs.rmSync(scope.resultPath, { force: true });
  fs.symlinkSync(outside, scope.resultPath);
  expectDenied(run, scope, scope.resultPath, "symlinked result.md");
  let err;
  try { recordWorkerOutput(run, "w", scope.resultPath, { persist: false }); } catch (e) { err = e; }
  assert.ok(err, "recordWorkerOutput must refuse a symlinked result.md");
  assert.match(err.message, /resolves through a symlink outside sandbox profile/);
  assert.notEqual(run.tasks[0].status, "completed", "the task is not accepted");
  const copied = fs.existsSync(run.paths.resultsDir) ? fs.readdirSync(run.paths.resultsDir) : [];
  for (const name of copied) {
    assert.ok(!fs.readFileSync(path.join(run.paths.resultsDir, name), "utf8").includes("OUTSIDE-SECRET"), "the outside file is never copied into results/");
  }
  // The real target path itself is not an allowed write path either.
  assert.ok(validateSandboxWrite(scope.sandboxPolicy, outside, "w"), "the symlink target is outside the boundary");
}

// --- The worker dir (a parent of result.md) is a symlink to an outside dir: refused ---
{
  const root = realTmp("cw-symlink-parent-");
  const { scope } = setup(root);
  const outsideDir = path.join(root, "elsewhere");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "result.md"), OUTSIDE, "utf8");
  fs.rmSync(scope.workerDir, { recursive: true, force: true });
  fs.symlinkSync(outsideDir, scope.workerDir);
  expectDenied(null, scope, scope.resultPath, "symlinked worker dir");
}

// --- The artifacts dir is a symlink out of the boundary: writes under it are refused ---
{
  const root = realTmp("cw-symlink-artifacts-");
  const { scope } = setup(root);
  const artifactsDir = scope.sandboxPolicy.metadata.artifactsDir;
  const outsideDir = path.join(root, "dot-git");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.rmSync(artifactsDir, { recursive: true, force: true });
  fs.symlinkSync(outsideDir, artifactsDir);
  expectDenied(null, scope, path.join(artifactsDir, "hooks", "pre-commit"), "symlinked artifacts dir");
}

// --- No false refusal: the run is reached through a symlinked root (macOS /var -> /private/var) ---
{
  const realRoot = realTmp("cw-symlink-root-");
  const linkParent = realTmp("cw-symlink-link-");
  const linkedRoot = path.join(linkParent, "root-link");
  fs.symlinkSync(realRoot, linkedRoot);
  const { run, scope } = setup(linkedRoot);
  fs.writeFileSync(scope.resultPath, RESULT, "utf8");
  assert.equal(validateSandboxWrite(scope.sandboxPolicy, scope.resultPath, "w"), null, "lexical path under a symlinked root");
  assert.equal(validateSandboxWrite(scope.sandboxPolicy, fs.realpathSync(scope.resultPath), "w"), null, "real path of the same result");
  recordWorkerOutput(run, "w", scope.resultPath, { persist: false });
  assert.equal(run.tasks[0].status, "completed");
}

console.log("worker-result-symlink-smoke: ok");
