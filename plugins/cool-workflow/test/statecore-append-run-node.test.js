#!/usr/bin/env node
// statecore-append-run-node (milestone 3) — pins appendRunNode's in-place
// upsert: replace at the same index when the id exists, else push at the
// end; the array reference is stable. SPEC/state-core.md
// "appendRunNode(run, node) — upserts into run.nodes IN PLACE ... the
// array reference is stable"; "test/append-run-node-no-realloc-smoke.js
// — in-place run.nodes upsert, stable array reference, byte-identical
// persisted state".

const assert = require("node:assert/strict");
const { createStateNode, appendRunNode } = require("../dist/core/state/state-node");

function makeRun(nodes) {
  return { id: "r1", nodes };
}

// New node (id not present): pushed at the end.
{
  const run = makeRun([createStateNode({ id: "a", kind: "task", loopStage: "interpret" })]);
  const nodesRef = run.nodes;
  const newNode = createStateNode({ id: "b", kind: "task", loopStage: "interpret" });
  appendRunNode(run, newNode);
  assert.equal(run.nodes.length, 2);
  assert.equal(run.nodes[1].id, "b", "a genuinely new id must be pushed at the end");
  assert.equal(run.nodes, nodesRef, "the array reference must be stable (no reallocation) on append");
}

// Existing node (id present): REPLACED in the SAME slot — order unchanged.
{
  const nodeA = createStateNode({ id: "a", kind: "task", loopStage: "interpret" });
  const nodeB = createStateNode({ id: "b", kind: "task", loopStage: "interpret" });
  const nodeC = createStateNode({ id: "c", kind: "task", loopStage: "interpret" });
  const run = makeRun([nodeA, nodeB, nodeC]);
  const nodesRef = run.nodes;

  const updatedB = { ...nodeB, status: "completed" };
  appendRunNode(run, updatedB);

  assert.equal(run.nodes.length, 3, "an update must not change the array length");
  assert.equal(run.nodes[0].id, "a");
  assert.equal(run.nodes[1].id, "b", "the updated node must stay in the SAME slot (index 1), not move to the end");
  assert.equal(run.nodes[1].status, "completed", "the slot must hold the UPDATED node");
  assert.equal(run.nodes[2].id, "c");
  assert.equal(run.nodes, nodesRef, "the array reference must be stable on an in-place update too");
}

// run.nodes starting undefined: appendRunNode initializes it as [] first.
{
  const run = { id: "r1" };
  const node = createStateNode({ id: "a", kind: "task", loopStage: "interpret" });
  appendRunNode(run, node);
  assert.deepEqual(run.nodes.map((n) => n.id), ["a"], "appendRunNode must initialize run.nodes when absent");
}

// appendRunNode returns the node it was given.
{
  const run = makeRun([]);
  const node = createStateNode({ id: "a", kind: "task", loopStage: "interpret" });
  const returned = appendRunNode(run, node);
  assert.equal(returned, node, "appendRunNode must return the node it was passed");
}

// appendRunNode calls the optional persist callback with (run, node) when
// supplied.
{
  const run = makeRun([]);
  const node = createStateNode({ id: "a", kind: "task", loopStage: "interpret" });
  let calledWith = null;
  appendRunNode(run, node, (r, n) => {
    calledWith = { r, n };
  });
  assert.equal(calledWith.r, run, "persist callback must receive the run");
  assert.equal(calledWith.n, node, "persist callback must receive the node");
}

// appendRunNode does NOT call persist when omitted (no throw either).
{
  const run = makeRun([]);
  const node = createStateNode({ id: "a", kind: "task", loopStage: "interpret" });
  assert.doesNotThrow(() => appendRunNode(run, node));
}

process.stdout.write("statecore-append-run-node: ok\n");
