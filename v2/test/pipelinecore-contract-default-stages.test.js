#!/usr/bin/env node
// pipelinecore-contract-default-stages — pins createDefaultPipelineContract's
// exact stage list and policies byte-for-byte against SPEC/pipeline-run.md's
// "Default contract stage table (byte facts a rebuild must keep)".

const assert = require("node:assert/strict");
const { DEFAULT_PIPELINE_CONTRACT_ID, createDefaultPipelineContract } = require("../dist/core/pipeline/contract");

// DEFAULT_PIPELINE_CONTRACT_ID exact value.
{
  assert.equal(DEFAULT_PIPELINE_CONTRACT_ID, "cw.pipeline.default", "default contract id must be cw.pipeline.default");
}

// Top-level contract shape: schemaVersion, id, title.
{
  const c = createDefaultPipelineContract();
  assert.equal(c.schemaVersion, 1, "schemaVersion must be 1");
  assert.equal(c.id, "cw.pipeline.default", "id must equal DEFAULT_PIPELINE_CONTRACT_ID");
  assert.equal(c.title, "Cool Workflow Default Pipeline", "title must be exact");
}

// Exactly six stages, in this exact order: plan, dispatch, result, verify, commit, report.
{
  const c = createDefaultPipelineContract();
  assert.equal(c.stages.length, 6, "must have exactly six stages");
  assert.deepEqual(
    c.stages.map((s) => s.id),
    ["plan", "dispatch", "result", "verify", "commit", "report"],
    "stage id order must be plan,dispatch,result,verify,commit,report"
  );
}

// plan stage exact fields.
{
  const c = createDefaultPipelineContract();
  const plan = c.stages.find((s) => s.id === "plan");
  assert.deepEqual(plan.acceptedInputKinds, ["input"]);
  assert.deepEqual(plan.acceptedInputStatuses, ["pending", "completed"]);
  assert.equal(plan.producedOutputKind, "task");
  assert.deepEqual(plan.requiredArtifacts, ["state"]);
  assert.equal(plan.name, "Plan");
}

// dispatch stage exact fields.
{
  const c = createDefaultPipelineContract();
  const dispatch = c.stages.find((s) => s.id === "dispatch");
  assert.deepEqual(dispatch.acceptedInputKinds, ["task"]);
  assert.deepEqual(dispatch.acceptedInputStatuses, ["pending"]);
  assert.equal(dispatch.producedOutputKind, "dispatch");
  assert.deepEqual(dispatch.requiredArtifacts, ["task"]);
}

// result stage exact fields.
{
  const c = createDefaultPipelineContract();
  const result = c.stages.find((s) => s.id === "result");
  assert.deepEqual(result.acceptedInputKinds, ["dispatch"]);
  assert.deepEqual(result.acceptedInputStatuses, ["running", "completed"]);
  assert.equal(result.producedOutputKind, "result");
  assert.deepEqual(result.requiredArtifacts, ["result"]);
}

// verify stage exact fields (requiredEvidence, not requiredArtifacts).
{
  const c = createDefaultPipelineContract();
  const verify = c.stages.find((s) => s.id === "verify");
  assert.deepEqual(verify.acceptedInputKinds, ["result", "verifier"]);
  assert.deepEqual(verify.acceptedInputStatuses, ["completed", "verified"]);
  assert.equal(verify.producedOutputKind, "verifier");
  assert.deepEqual(verify.requiredEvidence, ["cw:result"]);
  assert.equal(verify.requiredArtifacts, undefined, "verify stage must not declare requiredArtifacts");
}

// commit stage exact fields, including the verifierGate.
{
  const c = createDefaultPipelineContract();
  const commit = c.stages.find((s) => s.id === "commit");
  assert.deepEqual(commit.acceptedInputKinds, ["verifier", "commit"]);
  assert.deepEqual(commit.acceptedInputStatuses, ["verified"]);
  assert.equal(commit.producedOutputKind, "commit");
  assert.deepEqual(commit.verifierGate, { required: true, acceptedStatuses: ["verified"], requiredEvidence: true });
}

// report stage exact fields.
{
  const c = createDefaultPipelineContract();
  const report = c.stages.find((s) => s.id === "report");
  assert.deepEqual(report.acceptedInputKinds, ["commit", "result", "verifier"]);
  assert.deepEqual(report.acceptedInputStatuses, ["committed", "completed", "verified"]);
  assert.equal(report.producedOutputKind, "report");
  assert.deepEqual(report.requiredArtifacts, ["report"]);
}

// Top-level policies exact values.
{
  const c = createDefaultPipelineContract();
  assert.deepEqual(c.artifactPolicy, { root: ".cw/runs/<run-id>", requireReadablePaths: true });
  assert.deepEqual(c.evidencePolicy, { highPriorityRequiresEvidence: true });
  assert.deepEqual(c.failurePolicy, { preserveFailureNodes: true, retryableByDefault: false });
  assert.deepEqual(c.commitPolicy, { requiresVerifierGate: true, acceptedVerifierStatuses: ["verified"] });
  assert.deepEqual(c.compatibility, { minSchemaVersion: 1, maxSchemaVersion: 1 });
}

// Each call gives a FRESH object (no shared mutable state between calls).
{
  const a = createDefaultPipelineContract();
  const b = createDefaultPipelineContract();
  assert.notEqual(a, b, "must return a new object each call");
  assert.notEqual(a.stages, b.stages, "stages array must not be shared");
  a.stages.push({ id: "mutated" });
  assert.equal(b.stages.length, 6, "mutating one contract's stages must not affect another call's result");
}

process.stdout.write("pipelinecore-contract-default-stages: ok\n");
