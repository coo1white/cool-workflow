#!/usr/bin/env node
// pipelinecore-runner-runstage — runPipelineStage: the one-step engine.
// SPEC/pipeline-run.md "Pipeline kernel — src/pipeline-runner.ts"
// (runPipelineStage, now src/core/pipeline/runner.ts).

const assert = require("node:assert/strict");
const { createDefaultPipelineContract } = require("../dist/core/pipeline/contract");
const { runPipelineStage } = require("../dist/core/pipeline/runner");
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

// Normal advance: plan stage on a pending "input" node with a "state"
// artifact produces a new "task" node with status "completed" (default
// target since producedOutputKind !== "commit").
{
  const input = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([input]);
  const result = runPipelineStage(run, "plan", input.id, {}, { pathExists: () => true });
  assert.equal(result.status, "advanced");
  assert.equal(result.stageId, "plan");
  assert.equal(result.inputNodeId, input.id);
  assert.equal(result.outputKind, "task");
  const outputNode = run.nodes.find((n) => n.id === result.outputNodeId);
  assert.ok(outputNode, "output node must be appended to run.nodes");
  assert.equal(outputNode.status, "completed", "default target status for non-commit stage is completed");
  assert.equal(outputNode.kind, "task");
}

// runPipelineStage links parent/child: input node's children include the
// output node id, and the output node's parents include the input node id.
{
  const input = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([input]);
  const result = runPipelineStage(run, "plan", input.id);
  const linkedInput = run.nodes.find((n) => n.id === input.id);
  const outputNode = run.nodes.find((n) => n.id === result.outputNodeId);
  assert.ok(linkedInput.children.includes(outputNode.id), "input node must list output node as a child");
  assert.ok(outputNode.parents.includes(linkedInput.id), "output node must list input node as a parent");
}

// Commit-target stage: targetStatus "committed" means the node is FIRST
// created as "verified" then transitioned to "committed" (never created
// directly at "committed" — the initial status differs from the target).
{
  const verifier = createStateNode({
    kind: "verifier",
    status: "verified",
    loopStage: "verify",
    evidence: [{ id: "cw:result", source: "cw:result" }],
  });
  const run = baseRun([verifier]);
  const result = runPipelineStage(run, "commit", verifier.id);
  assert.equal(result.status, "advanced");
  assert.equal(result.outputKind, "commit");
  const outputNode = run.nodes.find((n) => n.id === result.outputNodeId);
  assert.equal(outputNode.status, "committed", "commit stage output must end at committed");
}

// Any other target status (not "commit" kind) starts at "pending" as its
// initial status, then only transitions if targetStatus differs from
// "pending" (here default "completed" != "pending", so a transition DOES
// occur, exercised above). Here we force explicit outputStatus="pending"
// to prove NO transition call happens (targetStatus === initialStatus).
{
  const input = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([input]);
  const result = runPipelineStage(run, "plan", input.id, { outputStatus: "pending" });
  const outputNode = run.nodes.find((n) => n.id === result.outputNodeId);
  assert.equal(outputNode.status, "pending", "explicit outputStatus pending must be honored with no forced transition");
}

// A PipelineContractError from assertNodeSatisfiesContract (bad input node
// kind for the stage) turns into a failPipelineStage failure result, not a
// throw.
{
  const wrongKindNode = createStateNode({ kind: "commit", status: "pending", loopStage: "interpret" });
  const run = baseRun([wrongKindNode]);
  const result = runPipelineStage(run, "plan", wrongKindNode.id);
  assert.equal(result.status, "failed", "contract violation must produce a failed result, not throw");
  assert.equal(result.error.code, "unexpected-node-kind");
}

// An unknown input node id throws (getRunNode's own hard-throw contract),
// not swallowed into a failure result.
{
  const run = baseRun([]);
  assert.throws(() => runPipelineStage(run, "plan", "does-not-exist"), /Unknown state node for run run-1: does-not-exist/);
}

// persist: false suppresses the persistNode/saveCheckpoint side effects
// (via runnerOptions), but the in-memory run.nodes mutation still happens.
{
  const input = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([input]);
  let persistNodeCalls = 0;
  let checkpointCalls = 0;
  const result = runPipelineStage(
    run,
    "plan",
    input.id,
    { persist: false },
    { persistNode: () => persistNodeCalls++, saveCheckpoint: () => checkpointCalls++ }
  );
  assert.equal(result.status, "advanced");
  assert.equal(persistNodeCalls, 0, "persist:false must suppress persistNode calls");
  assert.equal(checkpointCalls, 0, "persist:false must suppress saveCheckpoint calls");
  assert.ok(run.nodes.find((n) => n.id === result.outputNodeId), "in-memory node mutation still happens with persist:false");
}

// Without persist:false, both persistNode (once per appended node) and
// saveCheckpoint (once) fire.
{
  const input = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([input]);
  let persistNodeCalls = 0;
  let checkpointCalls = 0;
  runPipelineStage(run, "plan", input.id, {}, { persistNode: () => persistNodeCalls++, saveCheckpoint: () => checkpointCalls++ });
  assert.equal(persistNodeCalls, 2, "persistNode fires once for the input node and once for the output node");
  assert.equal(checkpointCalls, 1, "saveCheckpoint fires exactly once per stage run");
}

process.stdout.write("pipelinecore-runner-runstage: ok\n");
