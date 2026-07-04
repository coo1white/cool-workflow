#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createDefaultPipelineContract } = require("../dist/core/pipeline/contract");
// v2 replaced the createPipelineRunner() factory with pure free functions in
// core/pipeline/runner. The runner no longer touches fs itself: it takes injected
// persistNode / saveCheckpoint deps (exactly how src/shell/pipeline.ts wires it).
// Rebuild the same `runner` facade here by binding those shell deps, so the smoke
// keeps proving the same one-step engine AND on-disk node persistence.
const pipelineRunner = require("../dist/core/pipeline/runner");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/shell/run-store");
const { writeRunNode } = require("../dist/shell/node-store");
const { appendRunNode, createStateNode } = require("../dist/core/state/state-node");

const RUNNER_OPTS = { persistNode: writeRunNode, saveCheckpoint, pathExists: (p) => fs.existsSync(p) };
const runner = {
  getRunContract: (run, contractId) => pipelineRunner.getRunContract(run, contractId),
  getRunNode: (run, nodeId) => pipelineRunner.getRunNode(run, nodeId),
  findRunnablePipelineStages: (run) => pipelineRunner.findRunnablePipelineStages(run, undefined, RUNNER_OPTS.pathExists),
  runPipelineStage: (run, stageId, inputNodeId, options) =>
    pipelineRunner.runPipelineStage(run, stageId, inputNodeId, options, RUNNER_OPTS)
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-pipeline-runner-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "runner-smoke"));
ensureRunDirs(paths);
const taskPath = path.join(paths.tasksDir, "task.md");
const resultPath = path.join(paths.resultsDir, "task.md");
fs.writeFileSync(taskPath, "do the thing\n", "utf8");
fs.writeFileSync(resultPath, "done\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "runner-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "runner-smoke",
    title: "Runner Smoke",
    summary: "",
    limits: { maxAgents: 1, maxConcurrentAgents: 1 }
  },
  inputs: {},
  loopStage: "interpret",
  phases: [],
  tasks: [],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: []
};
saveCheckpoint(run);

const contract = runner.getRunContract(run);
assert.equal(contract.id, createDefaultPipelineContract().id);

const input = appendRunNode(
  run,
  createStateNode({
    id: "runner-smoke:input",
    kind: "input",
    status: "completed",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: paths.state }],
    contractId: contract.id
  })
);

assert.deepEqual(
  runner.findRunnablePipelineStages(run).map((stage) => stage.stageId),
  ["plan"]
);

const plan = runner.runPipelineStage(run, "plan", input.id, {
  outputNodeId: "runner-smoke:task",
  outputStatus: "pending",
  artifacts: [{ id: "task", kind: "markdown", path: taskPath }]
});
assert.equal(plan.status, "advanced");
assert.equal(plan.outputNodeId, "runner-smoke:task");
assert.ok(fs.existsSync(path.join(paths.stateNodesDir, "runner-smoke:task.json")));

const illegalCommit = runner.runPipelineStage(run, "commit", "runner-smoke:task", {
  outputNodeId: "runner-smoke:commit-failed"
});
assert.equal(illegalCommit.status, "failed");
assert.equal(illegalCommit.error.code, "unexpected-node-kind");
// v2's failPipelineStage mints its own error-node id (error-<hash>) rather than
// honoring the caller's outputNodeId; the default contract preserves the failure
// node. Assert on the id v2 actually returns and that it is an error node — the
// original intent (an illegal commit produces a preserved error node) is intact.
assert.ok(/^error-/.test(illegalCommit.outputNodeId), "failure produces a preserved error node id");
assert.equal(runner.getRunNode(run, illegalCommit.outputNodeId).kind, "error");

const taskNode = runner.getRunNode(run, "runner-smoke:task");
const dispatch = runner.runPipelineStage(run, "dispatch", taskNode.id, {
  outputNodeId: "runner-smoke:dispatch",
  outputStatus: "completed",
  artifacts: [
    { id: "dispatch", kind: "json", path: paths.state },
    { id: "result", kind: "markdown", path: resultPath }
  ]
});
assert.equal(dispatch.status, "advanced");

const dispatchNode = runner.getRunNode(run, "runner-smoke:dispatch");
const result = runner.runPipelineStage(run, "result", dispatchNode.id, {
  outputNodeId: "runner-smoke:result",
  outputStatus: "completed",
  artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
  evidence: [{ id: "cw:result", source: "cw:result", locator: "runner-smoke:1" }]
});
assert.equal(result.status, "advanced");

const resultNode = runner.getRunNode(run, "runner-smoke:result");
const verify = runner.runPipelineStage(run, "verify", resultNode.id, {
  outputNodeId: "runner-smoke:verifier",
  outputStatus: "verified",
  evidence: resultNode.evidence
});
assert.equal(verify.status, "advanced");

const verifierNode = runner.getRunNode(run, "runner-smoke:verifier");
const commit = runner.runPipelineStage(run, "commit", verifierNode.id, {
  outputNodeId: "runner-smoke:commit",
  outputStatus: "committed",
  artifacts: [{ id: "snapshot", kind: "json", path: paths.state }],
  evidence: verifierNode.evidence
});
assert.equal(commit.status, "advanced");
assert.equal(runner.getRunNode(run, "runner-smoke:commit").status, "committed");

process.stdout.write("pipeline-runner-smoke: ok\n");
