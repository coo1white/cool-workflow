#!/usr/bin/env node
// trustcore-ledger-verify-checks-order — pins verifyLedgerEntry's fail-closed
// check order and exact failure codes (SPEC/ledger-trust.md "Handoff ledger
// entry": "Check names run in this order and stop at the first failure:
// structure, kind, schema, digest-present, fields, digest, id").

const assert = require("node:assert/strict");
const { verifyLedgerEntry, buildLedgerProposal, buildLedgerReview } = require("../dist/core/trust/ledger");

// A verified, untampered proposal passes clean: ok:true, checks all pass,
// failedChecks empty, id/kind reflect the content-addressed values.
{
  const p = buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: ["x.ts"], createdAt: "2026-01-01T00:00:00.000Z" });
  const result = verifyLedgerEntry(p);
  assert.equal(result.ok, true, "an untampered proposal must verify ok");
  assert.equal(result.id, p.id);
  assert.equal(result.kind, "proposal");
  assert.deepEqual(result.failedChecks, [], "failedChecks must be empty on a clean verify");
  assert.ok(result.checks.every((c) => c.pass), "every check must pass on a clean verify");
}

// structure: not a JSON object -> ledger-not-object, id/kind both null.
{
  for (const bad of [null, undefined, "a string", 42, ["array"]]) {
    const result = verifyLedgerEntry(bad);
    assert.equal(result.ok, false, `non-object ${JSON.stringify(bad)} must fail verify`);
    assert.equal(result.failedChecks[0].code, "ledger-not-object");
    assert.equal(result.id, null, "id must be null when structure check fails");
    assert.equal(result.kind, null, "kind must be null when structure check fails");
  }
}

// kind: unknown kind value -> ledger-unknown-kind, stops before schema check.
{
  const result = verifyLedgerEntry({ kind: "bogus", schemaVersion: 1, digest: "sha256:abc" });
  assert.equal(result.ok, false);
  assert.equal(result.failedChecks[0].code, "ledger-unknown-kind");
  assert.equal(result.checks.length, 2, "must stop right after the structure pass + kind fail (2 checks total)");
}

// schema: schemaVersion != 1 -> ledger-bad-schema.
{
  const result = verifyLedgerEntry({ kind: "proposal", schemaVersion: 2, digest: "sha256:abc" });
  assert.equal(result.ok, false);
  assert.equal(result.failedChecks[0].code, "ledger-bad-schema");
}

// digest-present: digest absent or non-string -> ledger-missing-digest.
{
  const missing = verifyLedgerEntry({ kind: "proposal", schemaVersion: 1 });
  assert.equal(missing.failedChecks[0].code, "ledger-missing-digest");

  const notString = verifyLedgerEntry({ kind: "proposal", schemaVersion: 1, digest: 12345 });
  assert.equal(notString.failedChecks[0].code, "ledger-missing-digest");

  const empty = verifyLedgerEntry({ kind: "proposal", schemaVersion: 1, digest: "" });
  assert.equal(empty.failedChecks[0].code, "ledger-missing-digest", "empty-string digest counts as absent");
}

// fields: a required content field absent -> ledger-missing-field.
{
  const result = verifyLedgerEntry({ kind: "proposal", schemaVersion: 1, digest: "sha256:abc", from: "a", to: "b" });
  assert.equal(result.ok, false);
  assert.equal(result.failedChecks[0].code, "ledger-missing-field");
}

// review verdict check is nested inside "fields": bad verdict ->
// ledger-bad-verdict, only checked once every REVIEW_FIELDS is present.
{
  const result = verifyLedgerEntry({
    kind: "review",
    schemaVersion: 1,
    digest: "sha256:abc",
    from: "a",
    to: "b",
    target: "ldg-x",
    verdict: "MAYBE",
    findings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedChecks[0].code, "ledger-bad-verdict");
}

// digest: stored digest does not match recomputed content -> ledger-digest-mismatch,
// with a detail string naming the recomputed value.
{
  const p = buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: [], createdAt: "2026-01-01T00:00:00.000Z" });
  const tampered = { ...p, title: "TAMPERED" };
  const result = verifyLedgerEntry(tampered);
  assert.equal(result.ok, false);
  assert.equal(result.failedChecks[0].code, "ledger-digest-mismatch");
  assert.ok(result.failedChecks[0].detail.includes("stored digest does not match content"), "detail must name the mismatch");
  assert.ok(result.failedChecks[0].detail.includes("recomputed"), "detail must include the recomputed digest");
}

// id: id is not deriveId(digest) -> ledger-id-mismatch (digest itself is
// untouched and correct, only id was forged/mismatched).
{
  const p = buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: [], createdAt: "2026-01-01T00:00:00.000Z" });
  const spoofed = { ...p, id: "ldg-0000000000000000" };
  const result = verifyLedgerEntry(spoofed);
  assert.equal(result.ok, false);
  assert.equal(result.failedChecks[0].code, "ledger-id-mismatch");
  assert.ok(result.failedChecks[0].detail.includes("expected"), "detail must name the expected id");
}

// checks array preserves pass:true entries for every check that ran before
// the first failure (not just the final failing one).
{
  const p = buildLedgerProposal({ from: "a", to: "b", title: "t", rationale: "r", targetFiles: [], createdAt: "2026-01-01T00:00:00.000Z" });
  const tampered = { ...p, id: "ldg-0000000000000000" };
  const result = verifyLedgerEntry(tampered);
  const names = result.checks.map((c) => c.name);
  assert.deepEqual(names, ["structure", "kind", "schema", "digest-present", "fields", "digest", "id"], "all prior checks must be recorded as passing before the final id failure");
  assert.ok(result.checks.slice(0, 6).every((c) => c.pass), "every check before id must have passed");
  assert.equal(result.checks[6].pass, false);
}

process.stdout.write("trustcore-ledger-verify-checks-order: ok\n");
