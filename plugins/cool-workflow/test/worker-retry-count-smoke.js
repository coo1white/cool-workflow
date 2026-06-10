#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { allocateWorkerScope, reclaimOrphans, listWorkerScopes } = require("../dist/worker-isolation");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-worker-retry-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "worker-retry"));
ensureRunDirs(paths);

const task = {
  id: "task-1",
  kind: "analyze",
  phase: "analysis",
  status: "pending",
  requiresEvidence: false,
  prompt: "test",
  taskPath: path.join(paths.tasksDir, "task-1.md"),
  resultPath: path.join(paths.resultsDir, "task-1.md"),
  loopStage: "act",
  workerId: "worker-task-1-0001"
};

const run = {
  schemaVersion: 1,
  id: "worker-retry",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "worker-retry",
    title: "Worker Retry",
    summary: "",
    limits: { maxAgents: 1, maxConcurrentAgents: 1 }
  },
  inputs: {},
  loopStage: "interpret",
  phases: [],
  tasks: [task],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  workers: []
};
saveCheckpoint(run);

// --- 1. Allocate worker, initial retryCount should be absent (undefined) ---
const allocated = allocateWorkerScope(run, task, { workerId: "worker-task-1-0001" });
assert.equal(allocated.status, "allocated");
assert.equal(allocated.retryCount, undefined, "fresh allocation should not have retryCount");

// --- 2. Mark as failed, then re-allocate; retryCount should be 1 ---
allocated.status = "failed";
allocated.errors = [{ code: "test-failure", message: "test", at: new Date().toISOString() }];
saveCheckpoint(run);

const retried = allocateWorkerScope(run, task, { workerId: "worker-task-1-0001" });
assert.equal(retried.status, "allocated", "retried worker should be allocated");
assert.equal(retried.retryCount, 1, "retryCount should be 1 after one retry");
assert.equal(retried.errors.length, 0, "errors should be cleared on retry");

// --- 3. Mark as orphaned, then re-allocate; retryCount should be 2 ---
retried.status = "orphaned";
retried.errors = [{ code: "worker-orphaned", message: "timeout", at: new Date().toISOString() }];
retried.timeoutMs = 1;
task.workerId = "worker-task-1-0001";
saveCheckpoint(run);

const reRetried = allocateWorkerScope(run, task, { workerId: "worker-task-1-0001" });
assert.equal(reRetried.status, "allocated");
assert.equal(reRetried.retryCount, 2, "retryCount should be 2 after second retry");

process.stdout.write("worker-retry-count-smoke: ok\n");
