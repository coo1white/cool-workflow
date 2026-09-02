#!/usr/bin/env node
// statecore-transition-matrix-illegal (milestone 3) — pins every ILLEGAL
// StateNode transition: committed is terminal (nothing legal out of it,
// including — surprisingly — committed->committed itself, see the
// dedicated block below), plus every off-table from->to combination
// throws PipelineContractError with code "illegal-transition" and the
// exact message, BEFORE the node changes.

const assert = require("node:assert/strict");
const { createStateNode, transitionStateNode, PipelineContractError } = require("../dist/core/state/state-node");

function makeNode(status) {
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  return { ...node, status };
}

// committed -> committed (same->same) passes the transition-matrix gate
// (same===same short circuit) but then FAILS the second gate
// (commit-without-verifier), because that check is unconditional on
// node.status !== "verified" — it does not special-case same->same. So
// committed is terminal in the strongest sense: not even a no-op
// re-commit is possible. Verified byte-identical against the old build's
// state-node module — this is a faithful port,
// not a v2 regression.
{
  const node = makeNode("committed");
  assert.throws(
    () => transitionStateNode(node, { status: "committed" }),
    (err) => {
      assert.ok(err instanceof PipelineContractError);
      assert.equal(err.structured.code, "commit-without-verifier", "committed->committed must fail the SECOND gate, not the matrix");
      assert.equal(err.message, `State node ${node.id} cannot be committed before it is verified`);
      return true;
    },
    "committed -> committed must throw commit-without-verifier, not succeed as a same->same no-op"
  );
}

// committed is terminal: every transition OUT of committed to a DIFFERENT
// status is illegal via the first gate (the matrix).
{
  const targets = ["pending", "running", "completed", "failed", "blocked", "verified", "rejected"];
  for (const to of targets) {
    const node = makeNode("committed");
    assert.throws(
      () => transitionStateNode(node, { status: to }),
      (err) => {
        assert.ok(err instanceof PipelineContractError, "must throw PipelineContractError");
        assert.equal(err.structured.code, "illegal-transition");
        assert.equal(err.message, `State node ${node.id} cannot transition from committed to ${to}`);
        return true;
      },
      `committed -> ${to} must be illegal`
    );
  }
}

// A representative set of off-table illegal transitions.
const ILLEGAL_CASES = [
  ["pending", "committed"], // must go through verified first
  ["running", "pending"],
  ["running", "verified"],
  ["running", "rejected"],
  ["running", "committed"],
  ["completed", "pending"],
  ["completed", "running"],
  ["completed", "blocked"],
  ["completed", "committed"],
  ["failed", "running"],
  ["failed", "completed"],
  ["failed", "verified"],
  ["failed", "rejected"],
  ["failed", "committed"],
  ["blocked", "running"],
  ["blocked", "completed"],
  ["blocked", "verified"],
  ["blocked", "rejected"],
  ["blocked", "committed"],
  ["verified", "pending"],
  ["verified", "running"],
  ["verified", "completed"],
  ["verified", "failed"],
  ["verified", "blocked"],
  ["rejected", "running"],
  ["rejected", "completed"],
  ["rejected", "blocked"],
  ["rejected", "verified"],
  ["rejected", "committed"],
];

{
  for (const [from, to] of ILLEGAL_CASES) {
    const node = makeNode(from);
    assert.throws(
      () => transitionStateNode(node, { status: to }),
      (err) => {
        assert.ok(err instanceof PipelineContractError);
        assert.equal(err.structured.code, "illegal-transition");
        assert.equal(err.message, `State node ${node.id} cannot transition from ${from} to ${to}`);
        return true;
      },
      `${from} -> ${to} must be illegal`
    );
  }
}

// An illegal transition throws BEFORE the node changes — verify by
// inspecting a fresh copy remains unmutated (transitionStateNode never
// mutates its input node object either way, but confirm no partial return
// leaks by checking the thrown call produced no return value assignment).
{
  const node = makeNode("committed");
  const before = { ...node };
  try {
    transitionStateNode(node, { status: "pending" });
    assert.fail("must have thrown");
  } catch (err) {
    assert.ok(err instanceof PipelineContractError);
  }
  assert.deepEqual(node, before, "the original node object must be untouched after an illegal-transition throw");
}

process.stdout.write("statecore-transition-matrix-illegal: ok\n");
