#!/usr/bin/env node
// trustcore-ledger-digest-and-id — pins computeLedgerDigest and the
// content-addressed id derivation (SPEC/ledger-trust.md "Handoff ledger
// entry": digest = sha256 over stableStringify of every field EXCEPT id
// and digest; id = "ldg-" + first 16 hex chars of the digest).

const assert = require("node:assert/strict");
const { computeLedgerDigest, buildLedgerProposal, buildLedgerReview } = require("../dist/core/trust/ledger");
const { sha256, ledgerStableStringify } = require("../dist/core/hash");

// computeLedgerDigest must equal sha256(ledgerStableStringify(entry)) exactly
// — it is defined as that composition, not an independent implementation.
{
  const content = {
    kind: "proposal",
    schemaVersion: 1,
    from: "cool-workflow",
    to: "chime",
    title: "Add retry",
    rationale: "flaky net",
    targetFiles: ["src/net.ts"],
    suggestedDiff: "@@ ... @@",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const digest = computeLedgerDigest(content);
  assert.equal(digest, sha256(ledgerStableStringify(content)), "computeLedgerDigest must equal sha256(ledgerStableStringify(entry))");
  assert.ok(digest.startsWith("sha256:"), "digest must carry the sha256: prefix");
  assert.equal(digest.length, "sha256:".length + 64, "digest must be 64 hex chars after the prefix");
}

// Key order must not matter (stableStringify sorts keys) — same content,
// different property insertion order, same digest.
{
  const a = computeLedgerDigest({
    kind: "proposal",
    schemaVersion: 1,
    from: "x",
    to: "y",
    title: "t",
    rationale: "r",
    targetFiles: [],
    suggestedDiff: "",
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  const b = computeLedgerDigest({
    createdAt: "2020-01-01T00:00:00.000Z",
    suggestedDiff: "",
    targetFiles: [],
    rationale: "r",
    title: "t",
    to: "y",
    from: "x",
    schemaVersion: 1,
    kind: "proposal",
  });
  assert.equal(a, b, "field insertion order must not affect the digest");
}

// targetFiles ARRAY order DOES matter (only object keys are sorted, not
// array elements) — this is the general stableStringify array-order rule.
{
  const base = {
    kind: "proposal",
    schemaVersion: 1,
    from: "x",
    to: "y",
    title: "t",
    rationale: "r",
    suggestedDiff: "",
    createdAt: "2020-01-01T00:00:00.000Z",
  };
  const a = computeLedgerDigest({ ...base, targetFiles: ["a.ts", "b.ts"] });
  const b = computeLedgerDigest({ ...base, targetFiles: ["b.ts", "a.ts"] });
  assert.notEqual(a, b, "targetFiles array order must affect the digest (arrays are not sorted)");
}

// id = "ldg-" + first 16 hex chars of the digest, derived through the real
// buildLedgerProposal/buildLedgerReview seal path.
{
  const proposal = buildLedgerProposal({
    from: "a",
    to: "b",
    title: "t",
    rationale: "r",
    targetFiles: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const expectedId = `ldg-${proposal.digest.replace(/^sha256:/, "").slice(0, 16)}`;
  assert.equal(proposal.id, expectedId, "proposal id must be ldg- + first 16 hex chars of its own digest");
  assert.equal(proposal.id.length, "ldg-".length + 16, "id must be exactly ldg- plus 16 hex chars");

  const review = buildLedgerReview({
    from: "a",
    to: "b",
    target: "ldg-0000000000000000",
    verdict: "APPROVED",
    findings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const expectedReviewId = `ldg-${review.digest.replace(/^sha256:/, "").slice(0, 16)}`;
  assert.equal(review.id, expectedReviewId, "review id must be ldg- + first 16 hex chars of its own digest");
}

// Different content produces different ids/digests (distinctness).
{
  const a = buildLedgerProposal({ from: "a", to: "b", title: "t1", rationale: "r", targetFiles: [], createdAt: "2026-01-01T00:00:00.000Z" });
  const b = buildLedgerProposal({ from: "a", to: "b", title: "t2", rationale: "r", targetFiles: [], createdAt: "2026-01-01T00:00:00.000Z" });
  assert.notEqual(a.digest, b.digest, "different title must produce a different digest");
  assert.notEqual(a.id, b.id, "different content must produce a different id");
}

process.stdout.write("trustcore-ledger-digest-and-id: ok\n");
