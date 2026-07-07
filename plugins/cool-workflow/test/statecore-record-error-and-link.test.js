#!/usr/bin/env node
// statecore-record-error-and-link (milestone 3) — pins recordNodeError
// (sets status "failed", appends the error with defaulted at/nodeId) and
// linkStateNodes (de-duplicated children/parents arrays, fresh updatedAt
// on both sides). SPEC/state-core.md src/state-node.ts:166-198.

const assert = require("node:assert/strict");
const { createStateNode, recordNodeError, linkStateNodes } = require("../dist/core/state/state-node");

// recordNodeError: sets status to "failed" regardless of current status.
{
  const node = { ...createStateNode({ kind: "task", loopStage: "interpret" }), status: "running" };
  const next = recordNodeError(node, { code: "boom", message: "it broke" });
  assert.equal(next.status, "failed", "recordNodeError must force status to failed");
}

// recordNodeError: appends to errors (does not replace existing errors).
{
  const node = {
    ...createStateNode({ kind: "task", loopStage: "interpret" }),
    errors: [{ code: "prior", message: "earlier failure", at: "2020-01-01T00:00:00.000Z" }],
  };
  const next = recordNodeError(node, { code: "new-error", message: "second failure" });
  assert.equal(next.errors.length, 2, "recordNodeError must APPEND, not replace");
  assert.equal(next.errors[0].code, "prior");
  assert.equal(next.errors[1].code, "new-error");
}

// recordNodeError: defaults `at` (to now) and `nodeId` (to node.id) when
// not supplied by the caller.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  const next = recordNodeError(node, { code: "e1", message: "msg" });
  const appended = next.errors[next.errors.length - 1];
  assert.equal(appended.nodeId, node.id, "nodeId must default to the node's own id");
  assert.equal(typeof appended.at, "string", "at must default to a string timestamp");
}

// recordNodeError: an explicitly-supplied `at`/`nodeId` is honored, not
// overwritten.
{
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  const next = recordNodeError(node, { code: "e1", message: "msg", at: "1999-01-01T00:00:00.000Z", nodeId: "other-node" });
  const appended = next.errors[next.errors.length - 1];
  assert.equal(appended.at, "1999-01-01T00:00:00.000Z");
  assert.equal(appended.nodeId, "other-node");
}

// linkStateNodes: child id is appended to parent.children, parent id is
// appended to child.parents.
{
  const parent = createStateNode({ id: "parent-1", kind: "task", loopStage: "interpret" });
  const child = createStateNode({ id: "child-1", kind: "task", loopStage: "interpret" });
  const [linkedParent, linkedChild] = linkStateNodes(parent, child);
  assert.deepEqual(linkedParent.children, ["child-1"]);
  assert.deepEqual(linkedChild.parents, ["parent-1"]);
}

// linkStateNodes: de-duplicates — linking the same pair twice does not
// double the array.
{
  const parent = { ...createStateNode({ id: "parent-1", kind: "task", loopStage: "interpret" }), children: ["child-1"] };
  const child = { ...createStateNode({ id: "child-1", kind: "task", loopStage: "interpret" }), parents: ["parent-1"] };
  const [linkedParent, linkedChild] = linkStateNodes(parent, child);
  assert.deepEqual(linkedParent.children, ["child-1"], "re-linking an already-linked child must not duplicate");
  assert.deepEqual(linkedChild.parents, ["parent-1"], "re-linking an already-linked parent must not duplicate");
}

// linkStateNodes: existing unrelated children/parents are preserved
// alongside the new link.
{
  const parent = { ...createStateNode({ id: "parent-1", kind: "task", loopStage: "interpret" }), children: ["other-child"] };
  const child = { ...createStateNode({ id: "child-1", kind: "task", loopStage: "interpret" }), parents: ["other-parent"] };
  const [linkedParent, linkedChild] = linkStateNodes(parent, child);
  assert.deepEqual(linkedParent.children.sort(), ["child-1", "other-child"].sort());
  assert.deepEqual(linkedChild.parents.sort(), ["other-parent", "parent-1"].sort());
}

// linkStateNodes returns a tuple of exactly 2 nodes; original inputs are
// not mutated. (structuredClone, not JSON round-trip, so undefined-valued
// keys like contractId/metadata are preserved in the "before" snapshot.)
{
  const parent = createStateNode({ id: "p", kind: "task", loopStage: "interpret" });
  const child = createStateNode({ id: "c", kind: "task", loopStage: "interpret" });
  const beforeParent = structuredClone(parent);
  const beforeChild = structuredClone(child);
  const result = linkStateNodes(parent, child);
  assert.equal(result.length, 2);
  assert.deepEqual(parent, beforeParent, "linkStateNodes must not mutate the parent input");
  assert.deepEqual(child, beforeChild, "linkStateNodes must not mutate the child input");
}

process.stdout.write("statecore-record-error-and-link: ok\n");
