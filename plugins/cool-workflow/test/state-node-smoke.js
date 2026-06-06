#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  assertNodeSatisfiesContract,
  createStateNode,
  linkStateNodes,
  recordNodeError,
  transitionStateNode,
  validatePipelineContract
} = require("../dist/state-node");
const { createDefaultPipelineContract } = require("../dist/pipeline-contract");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-state-node-"));
const resultPath = path.join(tmp, "result.md");
fs.writeFileSync(resultPath, "verified result\n", "utf8");

const contract = createDefaultPipelineContract();
validatePipelineContract(contract);

const resultNode = createStateNode({
  id: "node:result",
  kind: "result",
  status: "completed",
  loopStage: "observe",
  artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
  evidence: [{ id: "result", source: "cw:result", locator: "file.ts:1" }]
});

assert.equal(resultNode.schemaVersion, 1);
assert.equal(resultNode.kind, "result");

const verifiedNode = transitionStateNode(resultNode, {
  status: "verified",
  loopStage: "adjust"
});
assert.equal(verifiedNode.status, "verified");

const committedNode = transitionStateNode(verifiedNode, {
  status: "committed",
  loopStage: "checkpoint"
});
assert.equal(committedNode.status, "committed");

assert.throws(
  () => transitionStateNode(resultNode, { status: "committed" }),
  /cannot transition from completed to committed/
);

assertNodeSatisfiesContract(resultNode, contract, "verify");

const missingEvidence = createStateNode({
  id: "node:missing-evidence",
  kind: "result",
  status: "completed",
  loopStage: "observe",
  artifacts: [{ id: "result", kind: "markdown", path: resultPath }]
});
assert.throws(
  () => assertNodeSatisfiesContract(missingEvidence, contract, "verify"),
  /missing required evidence/
);

const missingArtifact = createStateNode({
  id: "node:missing-artifact",
  kind: "dispatch",
  status: "completed",
  loopStage: "observe",
  artifacts: [{ id: "result", kind: "markdown", path: path.join(tmp, "missing.md") }],
  evidence: [{ id: "result", source: "test" }]
});
assert.throws(
  () => assertNodeSatisfiesContract(missingArtifact, contract, "result"),
  /path does not exist/
);

assert.throws(
  () => assertNodeSatisfiesContract(resultNode, contract, "commit"),
  /does not accept node kind result/
);

const verifierNode = createStateNode({
  id: "node:verifier",
  kind: "verifier",
  status: "verified",
  loopStage: "adjust",
  evidence: [{ id: "result", source: "test" }]
});
assertNodeSatisfiesContract(verifierNode, contract, "commit");

const failedNode = recordNodeError(resultNode, {
  code: "test-error",
  message: "Readable failure",
  path: resultPath
});
assert.equal(failedNode.status, "failed");
assert.equal(failedNode.errors[0].code, "test-error");
assert.equal(failedNode.errors[0].nodeId, resultNode.id);

const [parent, child] = linkStateNodes(verifierNode, committedNode);
assert.deepEqual(parent.children, [committedNode.id]);
assert.deepEqual(child.parents, [verifierNode.id]);

process.stdout.write("state-node-smoke: ok\n");
