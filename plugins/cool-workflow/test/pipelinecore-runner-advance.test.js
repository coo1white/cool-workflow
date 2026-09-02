#!/usr/bin/env node
// pipelinecore-runner-advance — advancePipeline: idle/advance/fail and the
// autoAdvance failurePolicy branch. SPEC/pipeline-run.md "Pipeline kernel —
// src/pipeline-runner.ts" (advancePipeline, now src/core/pipeline/runner.ts).

const assert = require("node:assert/strict");
const { createDefaultPipelineContract } = require("../dist/core/pipeline/contract");
const { advancePipeline, findRunnablePipelineStages } = require("../dist/core/pipeline/runner");
const { createStateNode } = require("../dist/core/state/state-node");

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

// No runnable stages at all -> idle with empty stages array.
{
  const run = baseRun([]);
  const result = advancePipeline(run);
  assert.deepEqual(result, { status: "idle", stages: [] });
}

// One runnable stage that succeeds -> "advanced", stopping at the first
// success (stages array still lists ALL candidates considered).
{
  const input = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([input]);
  const result = advancePipeline(run);
  assert.equal(result.status, "advanced");
  assert.equal(result.stageId, "plan");
  assert.ok(Array.isArray(result.stages) && result.stages.length >= 1);
}

// A node with no evidence, under a contract with evidencePolicy.requireEvidence
// true and no stage-level requiredEvidence list, is never even considered
// "runnable" by findRunnablePipelineStages: its evidenceSatisfied() pre-filter
// honors contract.evidencePolicy.requireEvidence exactly like
// runPipelineStage's stricter assertNodeSatisfiesContract
// (assertRequiredEvidence) does, matching the old build's hasRequiredEvidence
// (now src/core/pipeline/runner.ts, which also takes `contract` and checks
// `contract.evidencePolicy?.requireEvidence`). The two gates staying
// consistent means advancePipeline reports "idle", not a wasted "failed"
// attempt.
{
  const input = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const run = baseRun([input], { evidencePolicy: { requireEvidence: true } });
  const result = advancePipeline(run);
  assert.equal(result.status, "idle", "evidenceSatisfied's pre-filter honors evidencePolicy.requireEvidence, so no candidate is runnable at all");
  assert.deepEqual(result.stages, []);
}

// With failurePolicy.autoAdvance true, a failing FIRST candidate does not
// stop the loop — later candidates are still attempted, and if one of
// those succeeds, the overall result is "advanced".
{
  const failingInput = createStateNode({
    id: "input-failing",
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
  });
  const goodInput = createStateNode({
    id: "input-good",
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/state.json" }],
    evidence: [{ id: "e1", source: "x" }],
  });
  const run = baseRun([failingInput, goodInput], {
    evidencePolicy: { requireEvidence: true },
    failurePolicy: { preserveFailureNodes: true, retryableByDefault: false, autoAdvance: true },
  });
  const result = advancePipeline(run);
  assert.equal(result.status, "advanced", "autoAdvance must keep trying after a failure and report the eventual success");
  assert.equal(result.stageId, "plan");
  assert.equal(result.inputNodeId, goodInput.id);
}

// With autoAdvance true, if evidenceSatisfied's pre-filter (now aligned
// with assertRequiredEvidence's contract.evidencePolicy.requireEvidence
// check) finds NO runnable candidate at all, advancePipeline reports
// "idle" — autoAdvance only changes what happens after a runnable
// candidate is tried and fails; it never manufactures a "failed" result
// out of an empty candidate list.
{
  const noEvidenceNode = createStateNode({
    kind: "input",
    status: "pending",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: "/tmp/a.json" }],
  });
  const run = baseRun([noEvidenceNode], {
    evidencePolicy: { requireEvidence: true },
    failurePolicy: { preserveFailureNodes: true, retryableByDefault: false, autoAdvance: true },
  });
  const result = advancePipeline(run);
  assert.equal(result.status, "idle", "no candidate is runnable, so autoAdvance has nothing to retry past");
  assert.deepEqual(result.stages, []);
}

// With autoAdvance true and EVERY runnable candidate genuinely failing
// inside runPipelineStage, the LAST failure is reported (not the first).
// Both candidates pass findRunnablePipelineStages' coarse artifact check
// (their "state" artifact path exists at scan time), but pathExists is a
// realistic STATEFUL predicate (like the real fs.existsSync a shell/
// caller passes): by the time runPipelineStage re-checks strictly, one
// path has stopped existing (e.g. removed by another process between the
// scan and the actual run) -- a real-world path this two-gate split must
// tolerate, not merely a hypothetical.
{
  let seen = 0;
  const flakyPathExists = () => {
    seen++;
    return seen <= 2; // both nodes read as present during the coarse scan (2 candidates x 1 check each)...
  }; // ...but every check made DURING the actual run (after the scan) reports missing.
  const inputA = createStateNode({ id: "input-a", kind: "input", status: "pending", loopStage: "interpret", artifacts: [{ id: "state", kind: "json", path: "/tmp/a.json" }] });
  const inputB = createStateNode({ id: "input-b", kind: "input", status: "pending", loopStage: "interpret", artifacts: [{ id: "state", kind: "json", path: "/tmp/b.json" }] });
  const run = baseRun([inputA, inputB], {
    failurePolicy: { preserveFailureNodes: true, retryableByDefault: false, autoAdvance: true },
  });
  const runnable = findRunnablePipelineStages(run, run.contracts[0], flakyPathExists);
  assert.equal(runnable.length, 2, "both candidates read as runnable during the coarse scan");
  seen = 0; // reset: advancePipeline's own runPipelineStage calls now see both paths as gone
  const result = advancePipeline(run, { pathExists: flakyPathExists });
  assert.equal(result.status, "failed", "both runnable candidates fail once pathExists reports their path missing");
  assert.equal(result.error.code, "missing-artifact-path");
  assert.equal(result.inputNodeId, "input-b", "the LAST candidate's failure is reported, not the first");
}

process.stdout.write("pipelinecore-runner-advance: ok\n");
