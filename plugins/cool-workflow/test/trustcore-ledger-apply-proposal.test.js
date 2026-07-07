#!/usr/bin/env node
// trustcore-ledger-apply-proposal — pins applyLedgerProposal: the diff can
// ONLY escape a VERIFIED proposal (SPEC/ledger-trust.md invariant 7 and
// "applyLedgerProposal result" section).

const assert = require("node:assert/strict");
const { applyLedgerProposal, buildLedgerProposal, buildLedgerReview } = require("../dist/core/trust/ledger");

// A verified proposal with a diff: ok:true, diff passed through verbatim.
{
  const p = buildLedgerProposal({
    from: "a",
    to: "b",
    title: "t",
    rationale: "r",
    targetFiles: ["x.ts"],
    suggestedDiff: "@@ -1 +1 @@\n-old\n+new\n",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const result = applyLedgerProposal(p);
  assert.equal(result.ok, true);
  assert.equal(result.id, p.id);
  assert.equal(result.kind, "proposal");
  assert.equal(result.diff, "@@ -1 +1 @@\n-old\n+new\n", "diff must pass through verbatim, including trailing newline");
  assert.deepEqual(result.failedChecks, []);
}

// A tampered entry: ok:false, diff:null, failedChecks come from verify.
{
  const p = buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: [], suggestedDiff: "diff-body", createdAt: "2026-01-01T00:00:00.000Z" });
  const tampered = { ...p, title: "TAMPERED" };
  const result = applyLedgerProposal(tampered);
  assert.equal(result.ok, false);
  assert.equal(result.diff, null, "a tampered entry must never leak its diff");
  assert.ok(result.failedChecks.length > 0);
  assert.equal(result.failedChecks[0].code, "ledger-digest-mismatch");
}

// A review (not a proposal): ok:false, diff:null, code ledger-not-a-proposal.
{
  const r = buildLedgerReview({ from: "a", to: "b", target: "ldg-x", verdict: "APPROVED", findings: [], createdAt: "2026-01-01T00:00:00.000Z" });
  const result = applyLedgerProposal(r);
  assert.equal(result.ok, false);
  assert.equal(result.diff, null);
  assert.equal(result.kind, "review");
  assert.equal(result.failedChecks[0].code, "ledger-not-a-proposal");
  assert.equal(result.failedChecks[0].detail, "apply expects a proposal entry, not a review");
}

// A proposal with no diff (empty string suggestedDiff): ok:false, diff:null,
// code ledger-empty-diff.
{
  const p = buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: [], createdAt: "2026-01-01T00:00:00.000Z" });
  // suggestedDiff omitted -> becomes "" per buildLedgerProposal's own rule.
  assert.equal(p.suggestedDiff, "");
  const result = applyLedgerProposal(p);
  assert.equal(result.ok, false);
  assert.equal(result.diff, null);
  assert.equal(result.failedChecks[0].code, "ledger-empty-diff");
  assert.equal(result.failedChecks[0].detail, "proposal carries no suggestedDiff to apply");
}

// Non-JSON-object / malformed input: ok:false, diff:null, propagates the
// structural verify failure (no crash on garbage input).
{
  for (const bad of [null, undefined, "garbage", 123]) {
    const result = applyLedgerProposal(bad);
    assert.equal(result.ok, false, `garbage input ${JSON.stringify(bad)} must not throw and must fail`);
    assert.equal(result.diff, null);
  }
}

process.stdout.write("trustcore-ledger-apply-proposal: ok\n");
