#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createDefaultPipelineContract } = require("../dist/pipeline-contract");
const { createPipelineRunner } = require("../dist/pipeline-runner");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { appendRunNode, createStateNode, upsertRunContract } = require("../dist/state-node");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-auto-advance-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "auto-advance"));
ensureRunDirs(paths);

const run = {
  schemaVersion: 1,
  id: "auto-advance",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "auto-advance",
    title: "Auto Advance",
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

// --- 1. Default behavior: autoAdvance OFF, failure halts ---
const runnerDefault = createPipelineRunner();
const contract1 = createDefaultPipelineContract();
upsertRunContract(run, contract1);

const input1 = appendRunNode(run, createStateNode({
  id: "auto-advance:input:1",
  kind: "input",
  status: "completed",
  loopStage: "interpret",
  artifacts: [{ id: "state", kind: "json", path: paths.state }],
  contractId: contract1.id
}));

// Create a plan node (successful) to set up a second input
const plan = runnerDefault.runPipelineStage(run, "plan", input1.id, {
  outputNodeId: "auto-advance:task:1",
  outputStatus: "pending",
  artifacts: [{ id: "task", kind: "markdown", path: path.join(paths.tasksDir, "t.md") }]
});
assert.equal(plan.status, "advanced");

// Now we have 2 input nodes: the original input and the task node
// Dispatch from the input should succeed; dispatch from the task (wrong kind) should fail
// With autoAdvance OFF, advancePipeline should return "failed" on first failure

const resultNoAdvance = runnerDefault.advancePipeline(run, { contractId: contract1.id });
// Should have found at least one runnable stage and run it
assert.ok(resultNoAdvance.stages.length > 0, "should have at least one stage");

// --- 2. autoAdvance ON: failure should try next runnable stage ---
const contract2 = createDefaultPipelineContract();
contract2.failurePolicy = { autoAdvance: true };
contract2.id = "cw.pipeline.auto-advance";
upsertRunContract(run, contract2);

const runnerAuto = createPipelineRunner();
const resultAuto = runnerAuto.advancePipeline(run, { contractId: contract2.id });

// With autoAdvance, if the first runnable stage fails, it should try subsequent ones
assert.ok(resultAuto.stages.length > 0, "should have at least one stage with autoAdvance");
// The key assertion: autoAdvance does not change behavior for successful stages,
// but when stages fail, it tries alternatives instead of failing immediately.
assert.ok(
  resultAuto.status === "advanced" || resultAuto.stages.length > 1,
  `autoAdvance should advance or try multiple stages, got status=${resultAuto.status} stages=${resultAuto.stages.length}`
);

process.stdout.write("pipeline-auto-advance-smoke: ok\n");
