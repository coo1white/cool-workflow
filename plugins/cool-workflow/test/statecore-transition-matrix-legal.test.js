#!/usr/bin/env node
// statecore-transition-matrix-legal (milestone 3) — pins every LEGAL
// StateNode transition from SPEC/state-core.md "StateNode transition
// matrix": same->same always legal, plus the full table. v2/PLAN.md
// byte-compat item 7.
//
// NOTE: createStateNode/transitionStateNode currently call `new
// Date().toISOString()` directly instead of taking a clock parameter (see
// src/core/state/state-node.ts). This is a purity violation per the task's
// hard rules (core/ must take a clock as a parameter) — reported as a
// finding. These tests avoid asserting on updatedAt's exact value and
// instead assert only on status-transition behavior, which is unaffected.

const assert = require("node:assert/strict");
const { createStateNode, transitionStateNode } = require("../dist/core/state/state-node");

function makeNode(status) {
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  return { ...node, status };
}

const LEGAL_TABLE = {
  pending: ["running", "blocked", "failed", "completed", "verified", "rejected"],
  running: ["completed", "failed", "blocked"],
  completed: ["verified", "rejected", "failed"],
  failed: ["pending", "blocked"],
  blocked: ["pending", "failed"],
  verified: ["committed", "rejected"],
  rejected: ["pending", "failed"],
};

// Every legal transition in the table succeeds and returns a node with the
// new status.
{
  for (const [from, tos] of Object.entries(LEGAL_TABLE)) {
    for (const to of tos) {
      const node = makeNode(from);
      const next = transitionStateNode(node, { status: to });
      assert.equal(next.status, to, `${from} -> ${to} must be legal and produce status ${to}`);
    }
  }
}

// same -> same passes the FIRST gate (the transition matrix) for every
// status, including committed — but "committed" also has to pass the
// SECOND gate (commit-without-verifier), which checks `node.status !==
// "verified"` UNCONDITIONALLES of same->same. So committed -> committed
// actually THROWS commit-without-verifier (verified in both v2's dist/ and
// the old build's state-node module — this is a
// faithful port, not a v2-only quirk). Every OTHER same->same status is
// unaffected by the second gate and succeeds normally.
{
  const nonCommittedStatuses = ["pending", "running", "completed", "failed", "blocked", "verified", "rejected"];
  for (const status of nonCommittedStatuses) {
    const node = makeNode(status);
    const next = transitionStateNode(node, { status });
    assert.equal(next.status, status, `${status} -> ${status} (same->same) must succeed for every non-committed status`);
  }
}

// pending -> completed and pending -> verified are explicitly legal
// (rebuild risk #7 calls these out by name as easy to get wrong).
{
  const toCompleted = transitionStateNode(makeNode("pending"), { status: "completed" });
  assert.equal(toCompleted.status, "completed");
  // verified from pending needs status verified but NOT committed (that
  // needs the second gate, tested separately) — this is just the matrix.
  const toVerified = transitionStateNode(makeNode("pending"), { status: "verified" });
  assert.equal(toVerified.status, "verified");
}

// verified -> committed is legal (first gate) — paired with the second gate
// test file for the full commit story.
{
  const next = transitionStateNode(makeNode("verified"), { status: "committed" });
  assert.equal(next.status, "committed");
}

process.stdout.write("statecore-transition-matrix-legal: ok\n");
