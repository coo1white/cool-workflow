#!/usr/bin/env node
// trustcore-evidence-grounded-shapes — pins isGroundedEvidence /
// hasGroundedEvidence's exact shape rules (SPEC/ledger-trust.md "Evidence
// gates": "Grounded shapes: a URL, a path (has / or \\), a file-ext locator,
// or a namespace:value token. Bare prose fails.").

const assert = require("node:assert/strict");
const { isGroundedEvidence, hasGroundedEvidence } = require("../dist/core/trust/evidence-grounding");

// URL shape: any scheme://... is grounded.
{
  assert.equal(isGroundedEvidence("https://example.com/page"), true);
  assert.equal(isGroundedEvidence("http://example.com"), true);
  assert.equal(isGroundedEvidence("file:///tmp/x"), true);
  assert.equal(isGroundedEvidence("s3://bucket/key"), true);
}

// Path shape: contains / or \.
{
  assert.equal(isGroundedEvidence("src/net.ts"), true);
  assert.equal(isGroundedEvidence("./relative/path"), true);
  assert.equal(isGroundedEvidence("C:\\Windows\\path"), true);
  assert.equal(isGroundedEvidence("a/b"), true);
}

// File-ext locator shape: ends with .ext (1-12 alnum chars), optionally
// followed by :line or :line-line.
{
  assert.equal(isGroundedEvidence("result.md"), true);
  assert.equal(isGroundedEvidence("file.ts:42"), true);
  assert.equal(isGroundedEvidence("file.ts:42-50"), true);
  assert.equal(isGroundedEvidence("config.yaml"), true);
}

// namespace:value token shape: identifier-like prefix, colon, non-whitespace value.
{
  assert.equal(isGroundedEvidence("commit:abc123"), true);
  assert.equal(isGroundedEvidence("issue:456"), true);
  assert.equal(isGroundedEvidence("cw:result"), true);
}

// Bare prose fails — no machine shape at all.
{
  assert.equal(isGroundedEvidence("this looks fine to me"), false);
  assert.equal(isGroundedEvidence("I checked and it works"), false);
  assert.equal(isGroundedEvidence("trust me"), false);
}

// Empty / whitespace-only / nullish values fail (trimmed to empty).
{
  assert.equal(isGroundedEvidence(""), false);
  assert.equal(isGroundedEvidence("   "), false);
  assert.equal(isGroundedEvidence(null), false);
  assert.equal(isGroundedEvidence(undefined), false);
}

// Non-string input is coerced via String(raw ?? "") — a number still gets
// evaluated as a string (edge case: a bare number has no grounded shape).
{
  assert.equal(isGroundedEvidence(42), false, "a bare number string has no URL/path/ext/namespace shape");
}

// Leading/trailing whitespace is trimmed before classification.
{
  assert.equal(isGroundedEvidence("   src/net.ts   "), true);
}

// A namespace:value token needs a non-whitespace value right after the
// colon — "namespace: value" (with a space) must NOT match the namespace
// token regex (though it may still match another shape).
{
  assert.equal(isGroundedEvidence("label: some text"), false, "a colon-space (not colon-nonspace) must not match the namespace:value shape, and has no other grounded shape either");
}

// hasGroundedEvidence: true if AT LEAST ONE entry is grounded.
{
  assert.equal(hasGroundedEvidence(["just prose", "src/net.ts"]), true);
  assert.equal(hasGroundedEvidence(["just prose", "more prose"]), false);
  assert.equal(hasGroundedEvidence([]), false, "an empty array has no grounded entry");
}

// hasGroundedEvidence: non-array input is not grounded (fails closed, no throw).
{
  assert.equal(hasGroundedEvidence(undefined), false);
  assert.equal(hasGroundedEvidence("src/net.ts"), false, "a bare string (not wrapped in an array) must not be treated as an evidence array");
  assert.equal(hasGroundedEvidence(null), false);
}

process.stdout.write("trustcore-evidence-grounded-shapes: ok\n");
