#!/usr/bin/env node
// trustcore-ledger-resolve-inbox — pins resolveLedgerInbox's pure derivation
// (SPEC/ledger-trust.md "Handoff ledger entry" resolution states section,
// invariant 8: "a tampered review never resolves a proposal").

const assert = require("node:assert/strict");
const { resolveLedgerInbox } = require("../dist/core/trust/ledger");

function entry(overrides) {
  return {
    file: "f.json",
    id: null,
    kind: null,
    from: null,
    to: null,
    title: null,
    target: null,
    verdict: null,
    ok: true,
    failedChecks: [],
    ...overrides,
  };
}

// A proposal with no reviews targeting it: pending.
{
  const result = resolveLedgerInbox([entry({ kind: "proposal", id: "ldg-a", title: "Add x" })]);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].resolution, "pending");
  assert.equal(result.pending, 1);
  assert.equal(result.approved, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.contested, 0);
  assert.deepEqual(result.proposals[0].reviews, []);
}

// A proposal with one APPROVED review: approved.
{
  const result = resolveLedgerInbox([
    entry({ kind: "proposal", id: "ldg-a", title: "t" }),
    entry({ kind: "review", id: "ldg-r1", target: "ldg-a", verdict: "APPROVED" }),
  ]);
  assert.equal(result.proposals[0].resolution, "approved");
  assert.equal(result.approved, 1);
  assert.deepEqual(result.proposals[0].reviews, ["ldg-r1"]);
}

// A proposal with one REJECTED review: rejected.
{
  const result = resolveLedgerInbox([
    entry({ kind: "proposal", id: "ldg-a", title: "t" }),
    entry({ kind: "review", id: "ldg-r1", target: "ldg-a", verdict: "REJECTED" }),
  ]);
  assert.equal(result.proposals[0].resolution, "rejected");
  assert.equal(result.rejected, 1);
}

// Multiple reviews that disagree: contested.
{
  const result = resolveLedgerInbox([
    entry({ kind: "proposal", id: "ldg-a", title: "t" }),
    entry({ kind: "review", id: "ldg-r1", target: "ldg-a", verdict: "APPROVED" }),
    entry({ kind: "review", id: "ldg-r2", target: "ldg-a", verdict: "REJECTED" }),
  ]);
  assert.equal(result.proposals[0].resolution, "contested");
  assert.equal(result.contested, 1);
  assert.deepEqual(result.proposals[0].reviews, ["ldg-r1", "ldg-r2"].sort(), "reviews list must be sorted");
}

// Multiple reviews that all agree (2x APPROVED): still approved, not contested.
{
  const result = resolveLedgerInbox([
    entry({ kind: "proposal", id: "ldg-a", title: "t" }),
    entry({ kind: "review", id: "ldg-r1", target: "ldg-a", verdict: "APPROVED" }),
    entry({ kind: "review", id: "ldg-r2", target: "ldg-a", verdict: "APPROVED" }),
  ]);
  assert.equal(result.proposals[0].resolution, "approved");
}

// A tampered review (ok:false) targeting a proposal must NEVER resolve it —
// the proposal stays pending even though a review entry exists.
{
  const result = resolveLedgerInbox([
    entry({ kind: "proposal", id: "ldg-a", title: "t" }),
    entry({ kind: "review", id: "ldg-r1", target: "ldg-a", verdict: "APPROVED", ok: false, failedChecks: [{ name: "digest", code: "ledger-digest-mismatch" }] }),
  ]);
  assert.equal(result.proposals[0].resolution, "pending", "a tampered (ok:false) review must not resolve the proposal");
  assert.equal(result.pending, 1);
  assert.deepEqual(result.proposals[0].reviews, [], "a tampered review must not even be listed as an answering review");
}

// A tampered proposal (ok:false) must not appear in the resolution at all.
{
  const result = resolveLedgerInbox([entry({ kind: "proposal", id: "ldg-bad", title: "t", ok: false, failedChecks: [{ name: "digest", code: "ledger-digest-mismatch" }] })]);
  assert.equal(result.proposals.length, 0, "a tampered proposal must be excluded from the resolution entirely");
  assert.equal(result.pending, 0);
}

// Proposals are sorted by id in the output.
{
  const result = resolveLedgerInbox([
    entry({ kind: "proposal", id: "ldg-z", title: "z" }),
    entry({ kind: "proposal", id: "ldg-a", title: "a" }),
  ]);
  assert.deepEqual(result.proposals.map((p) => p.id), ["ldg-a", "ldg-z"], "proposals must be sorted by id");
}

// Empty input: all zero tallies, empty proposals list.
{
  const result = resolveLedgerInbox([]);
  assert.deepEqual(result, { proposals: [], pending: 0, approved: 0, rejected: 0, contested: 0 });
}

// A review with no target field does not count as answering anything.
{
  const result = resolveLedgerInbox([
    entry({ kind: "proposal", id: "ldg-a", title: "t" }),
    entry({ kind: "review", id: "ldg-r1", target: null, verdict: "APPROVED" }),
  ]);
  assert.equal(result.proposals[0].resolution, "pending", "a review with no target must not answer any proposal");
}

process.stdout.write("trustcore-ledger-resolve-inbox: ok\n");
