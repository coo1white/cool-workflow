#!/usr/bin/env node
// hash-fingerprint-golden (milestone 0) — pins the exact fingerprint bytes
// against the SPEC's own worked examples (SPEC/types-util.md "Exact outputs").
// These literal values were extracted from the real running old build; if a
// derived value here does not match, the SPEC is trusted and the
// implementation is adjusted — never the assertion.

const assert = require("node:assert/strict");
const { fingerprintStrings, fingerprintRecords } = require("../dist/core/hash");

// SPEC/types-util.md: fingerprintStrings(["a","b"]) = sha256:0473ef2dc0d324ab659d3580c1134e9d
{
  const fp = fingerprintStrings(["a", "b"]);
  assert.equal(fp, "sha256:0473ef2dc0d324ab659d3580c1134e9d", "fingerprintStrings([a,b]) golden value");
}

// SPEC/types-util.md: fingerprintStrings([]) = sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5
{
  const fp = fingerprintStrings([]);
  assert.equal(fp, "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5", "fingerprintStrings([]) golden value");
}

// SPEC/types-util.md: fingerprintRecords([{id:"b",status:"ok"},{id:"a",status:"fail"}]) = sha256:f0dd656217111ba9ceb4a09791a2a21c
{
  const fp = fingerprintRecords([
    { id: "b", status: "ok" },
    { id: "a", status: "fail" }
  ]);
  assert.equal(fp, "sha256:f0dd656217111ba9ceb4a09791a2a21c", "fingerprintRecords golden value");
}

// Format invariants: sha256: prefix + 32 hex chars = 39 total.
{
  const fp = fingerprintStrings(["x"]);
  assert.ok(fp.startsWith("sha256:"), "must have sha256: prefix");
  assert.equal(fp.length, "sha256:".length + 32, "must be exactly 32 hex chars after the prefix");
}

// Order-independence: same values, different input order, same fingerprint.
{
  const a = fingerprintStrings(["b", "a", "c"]);
  const b = fingerprintStrings(["c", "b", "a"]);
  assert.equal(a, b, "same values in different order must produce same fingerprint");
}

// Distinctness: different inputs give different fingerprints.
{
  const a = fingerprintStrings(["x"]);
  const b = fingerprintStrings(["y"]);
  assert.notEqual(a, b, "different inputs must produce different fingerprints");
}

// fingerprintStrings must not mutate its input array (sorts a copy).
{
  const input = ["b", "a"];
  fingerprintStrings(input);
  assert.deepEqual(input, ["b", "a"], "fingerprintStrings must not mutate the caller's array");
}

// fingerprintRecords: missing status folds to empty string; updatedAt is ignored.
{
  const a = fingerprintRecords([{ id: "x" }]);
  const b = fingerprintRecords([{ id: "x", status: "" }]);
  assert.equal(a, b, "missing status must fold to the same fingerprint as an explicit empty string");

  const c = fingerprintRecords([{ id: "x", status: "ok", updatedAt: "2020-01-01T00:00:00.000Z" }]);
  const d = fingerprintRecords([{ id: "x", status: "ok", updatedAt: "2099-01-01T00:00:00.000Z" }]);
  assert.equal(c, d, "updatedAt must be ignored by fingerprintRecords");
}

// fingerprintRecords is order-independent too (folds through fingerprintStrings' sort).
{
  const a = fingerprintRecords([{ id: "a", status: "1" }, { id: "b", status: "2" }]);
  const b = fingerprintRecords([{ id: "b", status: "2" }, { id: "a", status: "1" }]);
  assert.equal(a, b, "fingerprintRecords must be order-independent");
}

// Duplicate records are NOT de-duplicated before hashing (distinct from a single copy).
{
  const one = fingerprintRecords([{ id: "a", status: "ok" }]);
  const two = fingerprintRecords([{ id: "a", status: "ok" }, { id: "a", status: "ok" }]);
  assert.notEqual(one, two, "duplicate records must NOT collapse to the same fingerprint as one record");
}

process.stdout.write("hash-fingerprint-golden: ok\n");
