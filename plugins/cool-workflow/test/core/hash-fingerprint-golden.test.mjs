#!/usr/bin/env node
// hash-fingerprint-golden (milestone 0) — pins the exact fingerprint bytes
// against the SPEC's own worked examples (SPEC/types-util.md "Exact outputs").
// These literal values were extracted from the real running old build; if a
// derived value here does not match, the SPEC is trusted and the
// implementation is adjusted — never the assertion.

import assert from "node:assert/strict";
import { fingerprintStrings } from "../../dist/core/hash.js";

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

process.stdout.write("hash-fingerprint-golden: ok\n");
