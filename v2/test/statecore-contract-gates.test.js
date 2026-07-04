#!/usr/bin/env node
// statecore-contract-gates (milestone 3) — pins
// assertNodeSatisfiesContract's stage gates: unknown-contract-stage,
// unexpected-node-kind, unexpected-node-status, missing-required-artifact,
// missing-artifact-path, missing-required-evidence, verifier-gate-blocked,
// verifier-gate-missing-evidence. SPEC/state-core.md "Contract gates".

const assert = require("node:assert/strict");
const { createStateNode, assertNodeSatisfiesContract, PipelineContractError } = require("../dist/core/state/state-node");

function baseContract(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "c1",
    title: "Contract",
    stages: [
      {
        id: "stage-1",
        name: "Stage One",
        acceptedInputKinds: ["task"],
        acceptedInputStatuses: ["completed"],
        producedOutputKind: "result",
        ...overrides.stageOverrides,
      },
    ],
    compatibility: { minSchemaVersion: 1, maxSchemaVersion: 1 },
    ...overrides.contractOverrides,
  };
}

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    assert.ok(err instanceof PipelineContractError);
    return err.structured.code;
  }
}

function node(overrides = {}) {
  return { ...createStateNode({ kind: "task", loopStage: "interpret" }), status: "completed", ...overrides };
}

const alwaysExists = () => true;
const neverExists = () => false;

// A satisfying node passes with no throw.
{
  assert.doesNotThrow(() => assertNodeSatisfiesContract(node(), baseContract(), "stage-1", alwaysExists));
}

// unknown-contract-stage: stageId not found in the contract.
{
  const code = codeOf(() => assertNodeSatisfiesContract(node(), baseContract(), "no-such-stage", alwaysExists));
  assert.equal(code, "unknown-contract-stage");
}

// unexpected-node-kind: node.kind not in acceptedInputKinds.
{
  const code = codeOf(() => assertNodeSatisfiesContract(node({ kind: "dispatch" }), baseContract(), "stage-1", alwaysExists));
  assert.equal(code, "unexpected-node-kind");
}

// unexpected-node-status: node.status not in acceptedInputStatuses.
{
  const code = codeOf(() => assertNodeSatisfiesContract(node({ status: "pending" }), baseContract(), "stage-1", alwaysExists));
  assert.equal(code, "unexpected-node-status");
}

// missing-required-artifact: stage.requiredArtifacts names an artifact
// (by id OR kind) the node does not have.
{
  const contract = baseContract({ stageOverrides: { requiredArtifacts: ["needed-artifact"] } });
  const code = codeOf(() => assertNodeSatisfiesContract(node(), contract, "stage-1", alwaysExists));
  assert.equal(code, "missing-required-artifact");
}

// Required artifact matched by KIND (not just id) satisfies the gate.
{
  const contract = baseContract({ stageOverrides: { requiredArtifacts: ["report"] } });
  const withArtifact = node({ artifacts: [{ id: "art-1", kind: "report", path: "/tmp/report.md" }] });
  assert.doesNotThrow(() => assertNodeSatisfiesContract(withArtifact, contract, "stage-1", alwaysExists));
}

// missing-artifact-path: artifact matched by id/kind exists in the node,
// but the path does not exist on disk (pathExists returns false).
{
  const contract = baseContract({ stageOverrides: { requiredArtifacts: ["art-1"] } });
  const withArtifact = node({ artifacts: [{ id: "art-1", kind: "file", path: "/does/not/exist" }] });
  const code = codeOf(() => assertNodeSatisfiesContract(withArtifact, contract, "stage-1", neverExists));
  assert.equal(code, "missing-artifact-path");
}

// missing-required-evidence: contract-wide evidencePolicy.requireEvidence
// makes ANY empty evidence list fail, even with no stage.requiredEvidence.
{
  const contract = baseContract({ contractOverrides: { evidencePolicy: { requireEvidence: true } } });
  const code = codeOf(() => assertNodeSatisfiesContract(node({ evidence: [] }), contract, "stage-1", alwaysExists));
  assert.equal(code, "missing-required-evidence");
}

// missing-required-evidence: stage.requiredEvidence names a specific piece
// of evidence (by id OR source) the node lacks.
{
  const contract = baseContract({ stageOverrides: { requiredEvidence: ["ev-1"] } });
  const withOtherEvidence = node({ evidence: [{ id: "ev-2", source: "s2" }] });
  const code = codeOf(() => assertNodeSatisfiesContract(withOtherEvidence, contract, "stage-1", alwaysExists));
  assert.equal(code, "missing-required-evidence");
}

// Required evidence matched by SOURCE (not just id) satisfies the gate.
{
  const contract = baseContract({ stageOverrides: { requiredEvidence: ["trusted-source"] } });
  const withEvidence = node({ evidence: [{ id: "ev-1", source: "trusted-source" }] });
  assert.doesNotThrow(() => assertNodeSatisfiesContract(withEvidence, contract, "stage-1", alwaysExists));
}

// verifier-gate-blocked: stage.verifierGate.required, node status not in
// acceptedStatuses (defaults to ["verified"]).
{
  const contract = baseContract({ stageOverrides: { verifierGate: { required: true }, acceptedInputStatuses: ["completed"] } });
  const code = codeOf(() => assertNodeSatisfiesContract(node({ status: "completed" }), contract, "stage-1", alwaysExists));
  assert.equal(code, "verifier-gate-blocked");
}

// verifier-gate-blocked also fires via contract.commitPolicy.requiresVerifierGate
// combined with stage.producedOutputKind === "commit".
{
  const contract = baseContract({
    stageOverrides: { producedOutputKind: "commit", acceptedInputStatuses: ["completed"] },
    contractOverrides: { commitPolicy: { requiresVerifierGate: true } },
  });
  const code = codeOf(() => assertNodeSatisfiesContract(node({ status: "completed" }), contract, "stage-1", alwaysExists));
  assert.equal(code, "verifier-gate-blocked");
}

// The verifier gate is satisfied when node.status IS in acceptedStatuses
// (default ["verified"]).
{
  const contract = baseContract({ stageOverrides: { verifierGate: { required: true }, acceptedInputStatuses: ["verified"] } });
  assert.doesNotThrow(() => assertNodeSatisfiesContract(node({ status: "verified" }), contract, "stage-1", alwaysExists));
}

// verifier-gate-missing-evidence: gate.requiredEvidence true but node has
// no evidence, even though status passes the gate.
{
  const contract = baseContract({
    stageOverrides: { verifierGate: { required: true, requiredEvidence: true }, acceptedInputStatuses: ["verified"] },
  });
  const code = codeOf(() => assertNodeSatisfiesContract(node({ status: "verified", evidence: [] }), contract, "stage-1", alwaysExists));
  assert.equal(code, "verifier-gate-missing-evidence");
}

// A custom acceptedStatuses list on the gate overrides the ["verified"]
// default.
{
  const contract = baseContract({
    stageOverrides: { verifierGate: { required: true, acceptedStatuses: ["completed"] }, acceptedInputStatuses: ["completed"] },
  });
  assert.doesNotThrow(() => assertNodeSatisfiesContract(node({ status: "completed" }), contract, "stage-1", alwaysExists));
}

// No verifier gate at all (no stage.verifierGate, no commitPolicy) never
// throws a verifier-related error.
{
  const contract = baseContract();
  assert.doesNotThrow(() => assertNodeSatisfiesContract(node(), contract, "stage-1", alwaysExists));
}

// pathExists defaults to "always true" when omitted (per the file's own
// documented default), so a missing-artifact-path gate is effectively
// unreachable unless the caller explicitly supplies a real fs check.
{
  const contract = baseContract({ stageOverrides: { requiredArtifacts: ["art-1"] } });
  const withArtifact = node({ artifacts: [{ id: "art-1", kind: "file", path: "/anything" }] });
  assert.doesNotThrow(() => assertNodeSatisfiesContract(withArtifact, contract, "stage-1"), "omitting pathExists must default to always-true");
}

process.stdout.write("statecore-contract-gates: ok\n");
