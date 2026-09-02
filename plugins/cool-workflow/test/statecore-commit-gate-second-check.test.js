#!/usr/bin/env node
// statecore-commit-gate-second-check (milestone 3) — pins the SECOND gate:
// `committed` is refused unless the node status is EXACTLY `verified`,
// checked AFTER the transition matrix. v2/PLAN.md byte-compat item 7: "the
// SECOND gate — committed is refused unless status is exactly 'verified'
// (commit-without-verifier) — checked AFTER the matrix".
//
// The real interaction (verified against source, NOT assumed from the
// SPEC's summary line): the matrix only lists "verified" as a legal source
// for "committed", PLUS same->same is always matrix-legal. So the second
// gate is reachable from exactly ONE place via the public API:
// committed -> committed (same->same passes the matrix, then the second
// gate's unconditional `node.status !== "verified"` check fires because
// "committed" !== "verified"). Every genuinely-different source status
// attempting -> committed is stopped by the FIRST gate (matrix) already.
// This makes "committed" terminal in the strongest sense: it has no legal
// transition at all, not even a same->same no-op. Confirmed byte-identical
// against the old build's state-node module.

const assert = require("node:assert/strict");
const { createStateNode, transitionStateNode, PipelineContractError } = require("../dist/core/state/state-node");

function makeNode(status) {
  const node = createStateNode({ kind: "task", loopStage: "interpret" });
  return { ...node, status };
}

// The one legal path to committed: verified -> committed succeeds and
// passes both gates (matrix allows it, second gate's node.status ===
// "verified" check is satisfied).
{
  const node = makeNode("verified");
  const next = transitionStateNode(node, { status: "committed" });
  assert.equal(next.status, "committed");
}

// committed -> committed passes the FIRST gate (same->same) but FAILS the
// second gate — this is the one case where the second gate is actually
// reachable and does its job, making committed truly terminal (no
// transition at all succeeds out of it, including a no-op).
{
  const node = makeNode("committed");
  assert.throws(
    () => transitionStateNode(node, { status: "committed" }),
    (err) => {
      assert.ok(err instanceof PipelineContractError);
      assert.equal(err.structured.code, "commit-without-verifier");
      assert.equal(err.message, `State node ${node.id} cannot be committed before it is verified`);
      return true;
    },
    "committed -> committed must throw commit-without-verifier (the second gate's one reachable case)"
  );
}

// Every OTHER status attempting -> committed fails the FIRST gate (matrix)
// with illegal-transition, since only "verified" is a legal source for
// "committed" in the table — so for these sources, commit-without-verifier
// is never reached; illegal-transition fires first.
{
  const nonVerifiedSources = ["pending", "running", "completed", "failed", "blocked", "rejected"];
  for (const from of nonVerifiedSources) {
    const node = makeNode(from);
    assert.throws(
      () => transitionStateNode(node, { status: "committed" }),
      (err) => {
        assert.ok(err instanceof PipelineContractError);
        assert.equal(err.structured.code, "illegal-transition", `${from} -> committed must fail the FIRST gate (matrix), not the second`);
        return true;
      },
      `${from} -> committed must throw illegal-transition (matrix gate)`
    );
  }
}

// The error details payload carries {from, to} for commit-without-verifier
// too (same shape as illegal-transition's details).
{
  const node = makeNode("committed");
  try {
    transitionStateNode(node, { status: "committed" });
    assert.fail("must have thrown");
  } catch (err) {
    assert.deepEqual(err.structured.details, { from: "committed", to: "committed" });
    assert.equal(err.structured.nodeId, node.id);
  }
}

process.stdout.write("statecore-commit-gate-second-check: ok\n");
