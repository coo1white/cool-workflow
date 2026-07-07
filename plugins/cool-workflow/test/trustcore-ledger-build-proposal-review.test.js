#!/usr/bin/env node
// trustcore-ledger-build-proposal-review — pins buildLedgerProposal /
// buildLedgerReview field shapes exactly (SPEC/ledger-trust.md "Handoff
// ledger entry" — the sealed proposal/review JSON field sets).

const assert = require("node:assert/strict");
const { buildLedgerProposal, buildLedgerReview } = require("../dist/core/trust/ledger");

// Sealed proposal: exact field set, per SPEC's worked JSON block.
{
  const p = buildLedgerProposal({
    from: "cool-workflow",
    to: "chime",
    title: "Add retry",
    rationale: "flaky net",
    targetFiles: ["src/net.ts"],
    suggestedDiff: "@@ ... @@",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(
    Object.keys(p).sort(),
    ["kind", "schemaVersion", "from", "to", "title", "rationale", "targetFiles", "suggestedDiff", "createdAt", "id", "digest"].sort(),
    "sealed proposal must have exactly this field set"
  );
  assert.equal(p.kind, "proposal");
  assert.equal(p.schemaVersion, 1);
  assert.equal(p.from, "cool-workflow");
  assert.equal(p.to, "chime");
  assert.equal(p.title, "Add retry");
  assert.equal(p.rationale, "flaky net");
  assert.deepEqual(p.targetFiles, ["src/net.ts"]);
  assert.equal(p.suggestedDiff, "@@ ... @@");
  assert.equal(p.createdAt, "2026-01-01T00:00:00.000Z");
  assert.ok(p.id.startsWith("ldg-"), "id must start with ldg-");
  assert.ok(p.digest.startsWith("sha256:"), "digest must start with sha256:");
}

// A missing suggestedDiff on build becomes the empty string "" (SPEC:
// "A missing suggestedDiff on build becomes the empty string").
{
  const p = buildLedgerProposal({
    from: "a",
    to: "b",
    title: "t",
    rationale: "r",
    targetFiles: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(p.suggestedDiff, "", "absent suggestedDiff must become the empty string, never undefined");
}

// buildLedgerProposal must not mutate the caller's targetFiles array (it
// copies with [...input.targetFiles]).
{
  const files = ["a.ts", "b.ts"];
  buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: files, createdAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(files, ["a.ts", "b.ts"], "buildLedgerProposal must not mutate the caller's targetFiles array");
}

// Sealed review: exact field set, verdict/target/findings replace
// title/rationale/targetFiles/suggestedDiff.
{
  const r = buildLedgerReview({
    from: "chime",
    to: "cool-workflow",
    target: "ldg-abc123",
    verdict: "APPROVED",
    findings: ["looks good"],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(
    Object.keys(r).sort(),
    ["kind", "schemaVersion", "from", "to", "target", "verdict", "findings", "createdAt", "id", "digest"].sort(),
    "sealed review must have exactly this field set"
  );
  assert.equal(r.kind, "review");
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.target, "ldg-abc123");
  assert.equal(r.verdict, "APPROVED");
  assert.deepEqual(r.findings, ["looks good"]);
}

// buildLedgerReview must not mutate the caller's findings array.
{
  const findings = ["a", "b"];
  buildLedgerReview({ from: "a", to: "b", target: "t", verdict: "REJECTED", findings, createdAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(findings, ["a", "b"], "buildLedgerReview must not mutate the caller's findings array");
}

// REJECTED verdict is a normal, legal value (not just APPROVED).
{
  const r = buildLedgerReview({ from: "a", to: "b", target: "ldg-xyz", verdict: "REJECTED", findings: [], createdAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(r.verdict, "REJECTED");
}

// Empty findings/targetFiles are legal edge cases (empty array, not absent).
{
  const p = buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: [], createdAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(p.targetFiles, [], "empty targetFiles must round-trip as an empty array");
}

process.stdout.write("trustcore-ledger-build-proposal-review: ok\n");
