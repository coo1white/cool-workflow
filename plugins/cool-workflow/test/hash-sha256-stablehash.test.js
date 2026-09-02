#!/usr/bin/env node
// hash-sha256-stablehash (milestone 0) — pins sha256/sha256Bytes/stableHash:
// the three OTHER hash spellings besides fingerprintStrings, per
// project/docs/rebuild/PLAN.md byte-compat item 2 ("Hash dedup — three shapes, not one edge
// case") and SPEC/ledger-trust.md "Hash form", SPEC/state-core.md
// "Fingerprint / hash formats".

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { sha256, sha256Bytes, stableHash, stableStringify } = require("../dist/core/hash");

// sha256: prefixed "sha256:" + all 64 hex chars.
{
  const h = sha256("hello");
  assert.ok(h.startsWith("sha256:"), "sha256() must have sha256: prefix");
  assert.equal(h.length, "sha256:".length + 64, "sha256() must be 64 hex chars after the prefix");
  // Golden value: crypto.createHash("sha256").update("hello","utf8").digest("hex")
  const expectedHex = crypto.createHash("sha256").update("hello", "utf8").digest("hex");
  assert.equal(h, `sha256:${expectedHex}`, "sha256() must match a direct node:crypto sha256 of the utf8 bytes");
}

// sha256Bytes: BARE hex, no prefix — archive digests only. Never mixed with
// the other three spellings.
{
  const buf = Buffer.from("archive-bytes", "utf8");
  const h = sha256Bytes(buf);
  assert.equal(h.length, 64, "sha256Bytes() must be exactly 64 hex chars");
  assert.ok(!h.startsWith("sha256:"), "sha256Bytes() must NOT carry the sha256: prefix");
  const expectedHex = crypto.createHash("sha256").update(buf).digest("hex");
  assert.equal(h, expectedHex, "sha256Bytes() must match a direct node:crypto sha256 of the raw bytes");
}

// stableHash: prefixed "sha256:" + all 64 hex chars, over KEY-SORTED JSON —
// order-independent across nested objects.
{
  const a = stableHash({ b: 1, a: { z: 1, y: 2 } });
  const b = stableHash({ a: { y: 2, z: 1 }, b: 1 });
  assert.equal(a, b, "stableHash must be independent of key insertion order, recursively");
  assert.ok(a.startsWith("sha256:"), "stableHash() must have sha256: prefix");
  assert.equal(a.length, "sha256:".length + 64, "stableHash() must be 64 hex chars after the prefix");
}

// stableHash over arrays preserves array ORDER (only object keys are sorted).
{
  const a = stableHash({ list: [1, 2, 3] });
  const b = stableHash({ list: [3, 2, 1] });
  assert.notEqual(a, b, "stableHash must NOT reorder array elements, only object keys");
}

// stableHash matches sha256(stableStringify(value)) exactly (it is defined as
// that composition, not an independent implementation).
{
  const value = { z: "last", a: "first", nested: { q: 1, p: 2 } };
  assert.equal(
    stableHash(value),
    sha256(stableStringify(value)),
    "stableHash(value) must equal sha256(stableStringify(value))"
  );
}

process.stdout.write("hash-sha256-stablehash: ok\n");
