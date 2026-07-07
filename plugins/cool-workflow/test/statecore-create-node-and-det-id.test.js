#!/usr/bin/env node
// statecore-create-node-and-det-id (milestone 3) — pins createStateNode's
// defaults and the deterministic id fallback formula (no wall clock, no
// random; content-hash based). SPEC/state-core.md "Deterministic id
// fallback": `"<kind>-" + <first 16 hex of sha256(stableStringify({kind,
// loopStage, contractId: null-or-value, inputs: null-or-value, outputs:
// null-or-value}))>`; two nodes with the same content collapse to ONE id.

const assert = require("node:assert/strict");
const { createStateNode, STATE_NODE_SCHEMA_VERSION } = require("../dist/core/state/state-node");
const { sha256, stableStringify } = require("../dist/core/hash");

// Defaults: schemaVersion 1, status "pending", empty-defaulted collections.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  assert.equal(node.schemaVersion, STATE_NODE_SCHEMA_VERSION);
  assert.equal(node.schemaVersion, 1);
  assert.equal(node.status, "pending", "status must default to pending");
  assert.deepEqual(node.inputs, {});
  assert.deepEqual(node.outputs, {});
  assert.deepEqual(node.artifacts, []);
  assert.deepEqual(node.evidence, []);
  assert.deepEqual(node.errors, []);
  assert.deepEqual(node.parents, []);
  assert.deepEqual(node.children, []);
  assert.equal(node.kind, "task");
  assert.equal(node.loopStage, "interpret");
}

// An explicit id is used as-is, no hash computed.
{
  const node = createStateNode({ id: "my-explicit-id", kind: "task", loopStage: "interpret" });
  assert.equal(node.id, "my-explicit-id");
}

// An explicit status overrides the "pending" default.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret", status: "running" });
  assert.equal(node.status, "running");
}

// Deterministic id formula: exact reproduction of the content-hash formula.
{
  const input = { kind: "task", loopStage: "interpret" };
  const node = createStateNode(input);
  const digest = sha256(
    stableStringify({
      kind: "task",
      loopStage: "interpret",
      contractId: null,
      inputs: null,
      outputs: null,
    })
  );
  const expectedId = `task-${digest.replace("sha256:", "").slice(0, 16)}`;
  assert.equal(node.id, expectedId, "the deterministic id must match the exact content-hash formula");
  assert.equal(expectedId.length, "task-".length + 16, "id must be kind + '-' + 16 hex chars");
}

// Two nodes with IDENTICAL content (kind/loopStage/contractId/inputs/
// outputs) collapse to the SAME id — by design, not a bug.
{
  const a = createStateNode({ kind: "dispatch", loopStage: "act" });
  const b = createStateNode({ kind: "dispatch", loopStage: "act" });
  assert.equal(a.id, b.id, "two nodes with identical content must collapse to the same deterministic id");
}

// Nodes with DIFFERENT kind produce different ids.
{
  const a = createStateNode({ kind: "task", loopStage: "interpret" });
  const b = createStateNode({ kind: "dispatch", loopStage: "interpret" });
  assert.notEqual(a.id, b.id);
}

// Nodes with DIFFERENT loopStage produce different ids.
{
  const a = createStateNode({ kind: "task", loopStage: "interpret" });
  const b = createStateNode({ kind: "task", loopStage: "act" });
  assert.notEqual(a.id, b.id);
}

// Nodes with DIFFERENT inputs/outputs/contractId produce different ids —
// each is folded via ?? null, so "not given" and "explicitly null" collapse
// to the same slot, but a real value differs.
{
  const a = createStateNode({ kind: "task", loopStage: "interpret", inputs: { x: 1 } });
  const b = createStateNode({ kind: "task", loopStage: "interpret", inputs: { x: 2 } });
  assert.notEqual(a.id, b.id, "different inputs must produce different deterministic ids");

  const c = createStateNode({ kind: "task", loopStage: "interpret", contractId: "contract-a" });
  const d = createStateNode({ kind: "task", loopStage: "interpret", contractId: "contract-b" });
  assert.notEqual(c.id, d.id, "different contractId must produce different deterministic ids");
}

// contractId omitted vs explicit undefined-equivalent both fold to null in
// the hash input (?? operator), so they produce the SAME id.
{
  const a = createStateNode({ kind: "task", loopStage: "interpret" });
  const b = createStateNode({ kind: "task", loopStage: "interpret", contractId: undefined });
  assert.equal(a.id, b.id, "omitted contractId and explicit undefined must fold to the same id");
}

// createdAt and updatedAt are both set (both are wall-clock reads — flagged
// separately as a purity finding, but pinned here for shape: both present
// and initially equal).
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  assert.equal(typeof node.createdAt, "string");
  assert.equal(typeof node.updatedAt, "string");
  assert.equal(node.createdAt, node.updatedAt, "createdAt and updatedAt must be identical at creation time");
}

process.stdout.write("statecore-create-node-and-det-id: ok\n");
