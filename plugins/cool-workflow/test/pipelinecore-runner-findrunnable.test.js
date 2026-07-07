#!/usr/bin/env node
// pipelinecore-runner-findrunnable — findRunnablePipelineStages: every
// node x every stage, kept only when kind/status/artifacts/evidence/
// verifier-gate all pass. SPEC/pipeline-run.md "Pipeline kernel —
// src/pipeline-runner.ts" (findRunnablePipelineStages).

const assert = require("node:assert/strict");
const { createDefaultPipelineContract } = require("../dist/core/pipeline/contract");
const { findRunnablePipelineStages } = require("../dist/core/pipeline/runner");
const { createStateNode } = require("../dist/core/state/state-node");

function baseRun(nodes) {
  return {
    schemaVersion: 1,
    id: "run-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/run-1",
    workflow: { id: "wf", title: "WF", summary: "", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: {},
    nodes,
    contracts: [createDefaultPipelineContract()],
  };
}

// A plan-eligible "input" node in "pending" status with the required
// "state" artifact is runnable at the "plan" stage.
{
  const node = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([node]);
  const contract = createDefaultPipelineContract();
  const stages = findRunnablePipelineStages(run, contract);
  assert.equal(stages.length, 1, "exactly one runnable stage expected");
  assert.equal(stages[0].stageId, "plan");
  assert.equal(stages[0].inputNodeId, node.id);
  assert.equal(stages[0].outputKind, "task");
  assert.equal(stages[0].runId, "run-1");
  assert.equal(stages[0].contractId, "cw.pipeline.default");
}

// Missing the required artifact means the stage is NOT runnable.
{
  const node = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([node]);
  const stages = findRunnablePipelineStages(run, createDefaultPipelineContract());
  assert.equal(stages.length, 0, "no required artifact -> not runnable");
}

// Artifact present but its path does not exist (per pathExists) -> not runnable.
{
  const node = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/nowhere/state.json" }],
  });
  const run = baseRun([node]);
  const stages = findRunnablePipelineStages(run, createDefaultPipelineContract(), () => false);
  assert.equal(stages.length, 0, "artifact path failing pathExists -> not runnable");
}

// A "verify" stage requires evidence with id OR source matching "cw:result".
{
  const nodeNoEvidence = createStateNode({ kind: "result", status: "completed", loopStage: "act" });
  const nodeWithEvidenceById = createStateNode({
    kind: "result",
    status: "completed",
    loopStage: "act",
    evidence: [{ id: "cw:result", source: "other" }],
  });
  const nodeWithEvidenceBySource = createStateNode({
    kind: "result",
    status: "completed",
    loopStage: "act",
    evidence: [{ id: "e1", source: "cw:result" }],
  });
  const run1 = baseRun([nodeNoEvidence]);
  const run2 = baseRun([nodeWithEvidenceById]);
  const run3 = baseRun([nodeWithEvidenceBySource]);
  const contract = createDefaultPipelineContract();
  assert.equal(findRunnablePipelineStages(run1, contract).length, 0, "no evidence -> verify not runnable");
  assert.equal(findRunnablePipelineStages(run2, contract).length, 1, "evidence matched by id -> verify runnable");
  assert.equal(findRunnablePipelineStages(run3, contract).length, 1, "evidence matched by source -> verify runnable");
}

// A "commit" stage requires the input node's kind/status match AND the
// verifier gate (acceptedStatuses ["verified"], requiredEvidence true).
{
  const verifiedWithEvidence = createStateNode({
    kind: "verifier",
    status: "verified",
    loopStage: "verify",
    evidence: [{ id: "e1", source: "x" }],
  });
  const verifiedNoEvidence = createStateNode({ kind: "verifier", status: "verified", loopStage: "verify" });
  const completedNotVerified = createStateNode({ kind: "verifier", status: "completed", loopStage: "verify" });
  const contract = createDefaultPipelineContract();
  assert.equal(findRunnablePipelineStages(baseRun([verifiedWithEvidence]), contract).length, 1, "verified verifier with evidence -> commit runnable");
  assert.equal(findRunnablePipelineStages(baseRun([verifiedNoEvidence]), contract).length, 0, "verified verifier without evidence -> commit gate blocks");
  assert.equal(findRunnablePipelineStages(baseRun([completedNotVerified]), contract).length, 0, "completed (not verified) -> commit not accepted status anyway");
}

// A single node can match MULTIPLE stages if it satisfies more than one
// stage's accept rules (e.g. a "verifier" node with status "verified" also
// satisfies the "verify" stage's acceptedInputStatuses since it lists
// "verified" too, but kind must be "result" or "verifier" - here it IS
// verifier so both "verify" and "commit" stages are candidates given
// correct evidence).
{
  const node = createStateNode({
    kind: "verifier",
    status: "verified",
    loopStage: "verify",
    evidence: [{ id: "cw:result", source: "cw:result" }],
  });
  const run = baseRun([node]);
  const stages = findRunnablePipelineStages(run, createDefaultPipelineContract());
  const stageIds = stages.map((s) => s.stageId).sort();
  assert.deepEqual(stageIds, ["commit", "verify"], "a verified verifier node with cw:result evidence matches both verify and commit stages");
}

// Empty run.nodes -> no runnable stages, no throw.
{
  const run = baseRun([]);
  assert.deepEqual(findRunnablePipelineStages(run, createDefaultPipelineContract()), []);
}

// With no contract argument, getRunContract's default resolution kicks in
// (upserts the default contract when absent).
{
  const node = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/x.json" }],
  });
  const run = baseRun([node]);
  run.contracts = [];
  const stages = findRunnablePipelineStages(run);
  assert.equal(stages.length, 1, "default contract resolution must still find the plan stage");
  assert.equal(run.contracts.length, 1, "default contract must be upserted onto the run");
}

process.stdout.write("pipelinecore-runner-findrunnable: ok\n");
