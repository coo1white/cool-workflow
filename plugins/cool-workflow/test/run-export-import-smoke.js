#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint, readJson, writeJson } = require("../dist/state");
const { exportRun, importRun } = require("../dist/run-export"); // P2: will create this

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-export-"));
const runId = "export-test";
const runDir = path.join(tmp, ".cw", "runs", runId);
const paths = createRunPaths(runDir);
ensureRunDirs(paths);

// Create a minimal run
const run = {
  schemaVersion: 1,
  id: runId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: { question: "hello" },
  loopStage: "interpret",
  phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: ["t1"] }],
  tasks: [{ id: "t1", kind: "analyze", phase: "analyze", status: "completed", requiresEvidence: false,
    prompt: "test", taskPath: path.join(paths.tasksDir, "t1.md"), resultPath: path.join(paths.resultsDir, "t1.md"), loopStage: "act" }],
  dispatches: [],
  commits: [],
  paths,
  nodes: [{ id: `${runId}:input`, kind: "input", status: "completed", loopStage: "interpret",
    outputs: {}, artifacts: [{ id: "state", kind: "json", path: paths.state }] }],
  contracts: []
};
saveCheckpoint(run);

// Export
const exportPath = path.join(tmp, "run-export.json");
const exported = exportRun(run, exportPath);
assert.ok(fs.existsSync(exportPath), "export file should exist");
assert.equal(exported.runId, runId);
assert.ok(exported.exportedAt, "should have exportedAt timestamp");

// Import to new location
const restoreDir = path.join(tmp, "restored");
fs.mkdirSync(restoreDir, { recursive: true });
const restored = importRun(exportPath, restoreDir);
assert.equal(restored.run.id, runId);
assert.equal(restored.run.workflow.id, "test");
assert.ok(restored.run.paths.state.includes(restoreDir), "restored paths should be under restoreDir");

process.stdout.write("run-export-import-smoke: ok\n");
