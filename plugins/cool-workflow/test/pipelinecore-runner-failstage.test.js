#!/usr/bin/env node
// pipelinecore-runner-failstage — failPipelineStage: structured error
// building, preserve-vs-discard failure node, feedback recording hook.
// SPEC/pipeline-run.md "Pipeline kernel — src/pipeline-runner.ts"
// (failPipelineStage, now src/core/pipeline/runner.ts).

const assert = require("node:assert/strict");
const { createDefaultPipelineContract } = require("../dist/core/pipeline/contract");
const { failPipelineStage } = require("../dist/core/pipeline/runner");
const { createStateNode, PipelineContractError } = require("../dist/core/state/state-node");

function baseRun(nodes, contractOverrides) {
  const contract = { ...createDefaultPipelineContract(), ...contractOverrides };
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
    contracts: [contract],
  };
}

// A PipelineContractError's own `.structured` is used verbatim as the
// result's error, not re-derived.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  const err = new PipelineContractError({ code: "unexpected-node-kind", message: "custom message", nodeId: input.id, retryable: true });
  const result = failPipelineStage(run, "plan", input, err);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "unexpected-node-kind");
  assert.equal(result.error.message, "custom message");
  assert.equal(result.error.retryable, true);
}

// A generic (non-PipelineContractError) Error becomes
// code:"pipeline-stage-error" with retryable falling back through
// stage.failure?.retryable ?? contract.failurePolicy?.retryableByDefault ?? false.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  const result = failPipelineStage(run, "plan", input, new Error("boom"));
  assert.equal(result.error.code, "pipeline-stage-error");
  assert.equal(result.error.message, "boom");
  assert.equal(result.error.nodeId, input.id);
  assert.equal(result.error.retryable, false, "default failurePolicy.retryableByDefault is false");
}

// A non-Error thrown value is coerced with String().
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  const result = failPipelineStage(run, "plan", input, "raw string throw");
  assert.equal(result.error.message, "raw string throw");
}

// retryableByDefault: true from contract.failurePolicy propagates through
// when no stage-level override exists.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input], { failurePolicy: { preserveFailureNodes: false, retryableByDefault: true } });
  const result = failPipelineStage(run, "plan", input, new Error("x"));
  assert.equal(result.error.retryable, true);
}

// preserveFailureNode resolution: options.preserveFailureNode ??
// stage.failure?.preserveFailureNode ?? contract.failurePolicy?.preserveFailureNodes ?? false.
// The default contract's failurePolicy.preserveFailureNodes is true, so
// with no override, a failure node/feedback record IS written.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  let feedbackCalls = 0;
  const result = failPipelineStage(run, "plan", input, new Error("boom"), { recordFeedback: () => feedbackCalls++ });
  assert.notEqual(result.outputNodeId, undefined, "default contract preserves failure nodes -> outputNodeId is set");
  const errorNode = run.nodes.find((n) => n.id === result.outputNodeId);
  assert.ok(errorNode, "an error node must be appended to run.nodes");
  assert.equal(errorNode.kind, "error", "default failure kind is 'error'");
  assert.equal(errorNode.status, "failed", "recordNodeError sets status to failed");
  assert.equal(errorNode.metadata.preserved, true);
  assert.equal(feedbackCalls, 1, "recordFeedback hook must be invoked exactly once when preserving");
}

// options.preserveFailureNode: false OVERRIDES the contract's
// preserveFailureNodes:true default -> no node/feedback written, and
// outputNodeId is undefined.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  let feedbackCalls = 0;
  const beforeCount = (run.nodes || []).length;
  const result = failPipelineStage(run, "plan", input, new Error("boom"), {
    preserveFailureNode: false,
    recordFeedback: () => feedbackCalls++,
  });
  assert.equal(result.outputNodeId, undefined, "not preserving -> no outputNodeId");
  assert.equal(run.nodes.length, beforeCount, "no node must be appended when not preserving");
  assert.equal(feedbackCalls, 0, "recordFeedback must not fire when not preserving");
}

// preserveFailureNodes: false at the contract level (and no per-call
// override) also suppresses the failure node.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input], { failurePolicy: { preserveFailureNodes: false, retryableByDefault: false } });
  const result = failPipelineStage(run, "plan", input, new Error("boom"));
  assert.equal(result.outputNodeId, undefined);
}

// The preserved error node is linked as a child of the input node (and the
// input node itself is re-appended/updated in run.nodes with the new link).
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  const result = failPipelineStage(run, "plan", input, new Error("boom"));
  const linkedInput = run.nodes.find((n) => n.id === input.id);
  const errorNode = run.nodes.find((n) => n.id === result.outputNodeId);
  assert.ok(linkedInput.children.includes(errorNode.id));
  assert.ok(errorNode.parents.includes(linkedInput.id));
}

// persist: false suppresses persistNode (options.persistNode), same
// pattern as runPipelineStage.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  let persistNodeCalls = 0;
  failPipelineStage(run, "plan", input, new Error("boom"), { persist: false, persistNode: () => persistNodeCalls++ });
  assert.equal(persistNodeCalls, 0, "persist:false must suppress persistNode calls even when preserving a failure node");
}

// result.error.at is a timestamp string (ISO-like) for a generic Error —
// this is the ONE spot in this bucket's files where core/ reaches for the
// real clock directly (`new Date().toISOString()` at runner.ts's
// failPipelineStage, not threaded as a function parameter). This is
// flagged as a PURITY VIOLATION finding, not silently worked around: the
// assertion below only checks the shape, since the exact value cannot be
// pinned without control of the clock.
{
  const input = createStateNode({ kind: "input", status: "pending", loopStage: "interpret" });
  const run = baseRun([input]);
  const result = failPipelineStage(run, "plan", input, new Error("boom"));
  assert.match(result.error.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "error.at must be an ISO timestamp string");
}

process.stdout.write("pipelinecore-runner-failstage: ok\n");
