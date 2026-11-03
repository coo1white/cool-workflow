#!/usr/bin/env node
// commitgate-receipt-refused — resolveCommitGate re-checks every
// `receipt:<id>` the verifier node cites (via deps.refusedReceipts, the
// shell's receipt store) and fails closed with commit-verifier-receipt-refused;
// with no checker wired, a cited receipt is refused, never waved through.

import assert from "node:assert/strict";
import { resolveCommitGate } from "../../../dist/core/pipeline/commit-gate.js";

const NOW = "2026-11-03T00:00:00.000Z";
const RC = "rc-0123456789abcdef";

function run(evidence) {
  return {
    id: "run-1",
    tasks: [],
    nodes: [{ id: "run-1:verifier:t1", kind: "verifier", status: "verified", evidence }],
  };
}
const options = { reason: "manual", verifierNodeId: "run-1:verifier:t1" };
const cited = [{ id: "e1", source: "cw:result", path: "README.md:1" }, { id: "e2", source: "cw:result", locator: `receipt:${RC}` }];

// Refused by the store: the reason and next step reach the error.
{
  const seen = [];
  const res = resolveCommitGate(run(cited), options, {
    now: NOW,
    refusedReceipts: (ids) => (seen.push(...ids), [{ id: RC, code: "receipt-stale", reason: `the code changed since receipt ${RC} was made`, next: "cw check -- npm test" }]),
  });
  assert.deepEqual(seen, [RC]);
  const err = res.errors.find((e) => e.code === "commit-verifier-receipt-refused");
  assert.ok(err, "a refused receipt blocks the commit");
  assert.match(err.message, /cites a receipt CW cannot accept: the code changed since receipt .*\. Next: cw check -- npm test$/);
  assert.equal(err.details.receipts[0].code, "receipt-stale");
}

// Accepted by the store: no receipt error.
{
  const res = resolveCommitGate(run(cited), options, { now: NOW, refusedReceipts: () => [] });
  assert.equal(res.errors.length, 0);
}

// No checker wired: fail closed.
{
  const res = resolveCommitGate(run(cited), options, { now: NOW });
  assert.ok(res.errors.some((e) => e.code === "commit-verifier-receipt-refused"));
}

// No receipt cited: the checker is never asked (old runs keep their exact errors).
{
  const res = resolveCommitGate(run([cited[0]]), options, { now: NOW, refusedReceipts: () => assert.fail("not asked") });
  assert.equal(res.errors.length, 0);
}

console.log("commitgate-receipt-refused: ok");
