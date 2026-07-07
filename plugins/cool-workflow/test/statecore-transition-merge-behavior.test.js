#!/usr/bin/env node
// statecore-transition-merge-behavior (milestone 3) — pins
// transitionStateNode's merge rules for outputs (object spread),
// artifacts/evidence (merge by id — replace-in-slot or append), and
// metadata (object spread). SPEC/state-core.md src/state-node.ts:81-110.

const assert = require("node:assert/strict");
const { createStateNode, transitionStateNode } = require("../dist/core/state/state-node");

function makeNode(overrides = {}) {
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  return { ...node, ...overrides };
}

// outputs: object-spread merge (new keys added, existing keys overridden,
// untouched keys preserved).
{
  const node = makeNode({ status: "running", outputs: { a: 1, b: 2 } });
  const next = transitionStateNode(node, { status: "completed", outputs: { b: 99, c: 3 } });
  assert.deepEqual(next.outputs, { a: 1, b: 99, c: 3 }, "outputs must be a shallow object-spread merge");
}

// outputs: when the transition supplies NO outputs, the node's existing
// outputs are preserved unchanged (not cleared).
{
  const node = makeNode({ status: "running", outputs: { a: 1 } });
  const next = transitionStateNode(node, { status: "completed" });
  assert.deepEqual(next.outputs, { a: 1 }, "omitting outputs in the transition input must preserve existing outputs");
}

// artifacts: merge by id — an artifact with an existing id REPLACES in the
// same slot; a new id APPENDS.
{
  const node = makeNode({
    status: "running",
    artifacts: [
      { id: "art-1", kind: "file", path: "/a" },
      { id: "art-2", kind: "file", path: "/b" },
    ],
  });
  const next = transitionStateNode(node, {
    status: "completed",
    artifacts: [{ id: "art-1", kind: "file", path: "/a-updated" }, { id: "art-3", kind: "file", path: "/c" }],
  });
  assert.equal(next.artifacts.length, 3, "one replace + one append must give 3 total artifacts");
  assert.deepEqual(next.artifacts[0], { id: "art-1", kind: "file", path: "/a-updated" }, "art-1 must be replaced IN PLACE (same slot)");
  assert.deepEqual(next.artifacts[1], { id: "art-2", kind: "file", path: "/b" }, "art-2 must be untouched");
  assert.deepEqual(next.artifacts[2], { id: "art-3", kind: "file", path: "/c" }, "art-3 must be appended at the end");
}

// evidence: same merge-by-id rule as artifacts.
{
  const node = makeNode({
    status: "running",
    evidence: [{ id: "ev-1", source: "s1" }],
  });
  const next = transitionStateNode(node, {
    status: "completed",
    evidence: [{ id: "ev-1", source: "s1-updated" }, { id: "ev-2", source: "s2" }],
  });
  assert.equal(next.evidence.length, 2);
  assert.deepEqual(next.evidence[0], { id: "ev-1", source: "s1-updated" });
  assert.deepEqual(next.evidence[1], { id: "ev-2", source: "s2" });
}

// metadata: object-spread merge, existing metadata preserved and extended.
{
  const node = makeNode({ status: "running", metadata: { note: "first" } });
  const next = transitionStateNode(node, { status: "completed", metadata: { extra: "second" } });
  assert.deepEqual(next.metadata, { note: "first", extra: "second" });
}

// metadata: when node.metadata is undefined and transition supplies
// metadata, the merge starts from {} (not a crash on spreading undefined).
{
  const node = makeNode({ status: "running", metadata: undefined });
  const next = transitionStateNode(node, { status: "completed", metadata: { a: 1 } });
  assert.deepEqual(next.metadata, { a: 1 });
}

// loopStage: falls back to the existing node's loopStage when omitted;
// overridden when provided.
{
  const node = makeNode({ status: "running", loopStage: "interpret" });
  const noOverride = transitionStateNode(node, { status: "completed" });
  assert.equal(noOverride.loopStage, "interpret", "omitted loopStage must preserve the existing value");

  const withOverride = transitionStateNode(node, { status: "completed", loopStage: "observe" });
  assert.equal(withOverride.loopStage, "observe", "provided loopStage must override");
}

// The original node object is never mutated by a successful transition.
// (structuredClone, not JSON round-trip, so undefined-valued keys like
// contractId/metadata are preserved in the "before" snapshot too.)
{
  const node = makeNode({ status: "running", outputs: { a: 1 } });
  const before = structuredClone(node);
  transitionStateNode(node, { status: "completed", outputs: { b: 2 } });
  assert.deepEqual(node, before, "transitionStateNode must not mutate its input node");
}

process.stdout.write("statecore-transition-merge-behavior: ok\n");
