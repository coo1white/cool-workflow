#!/usr/bin/env node
// trustcore-evidence-resolve-locator-states — pins resolveEvidenceLocator's
// four EvidenceResolution states directly: resolved, unresolved, external,
// opaque (SPEC/ledger-trust.md "Evidence gates"; core/trust/evidence-
// grounding.ts's own EvidenceResolution type union).

const assert = require("node:assert/strict");
const { resolveEvidenceLocator } = require("../dist/core/trust/evidence-grounding");

function ops({ existsSet = new Set(), isAbsolutePrefix = "/" } = {}) {
  return {
    exists: (p) => existsSet.has(p),
    isAbsolute: (p) => p.startsWith(isAbsolutePrefix),
    resolve: (base, rel) => `${base}/${rel}`,
  };
}

// A URL locator -> "external", regardless of baseDirs/exists.
{
  const o = ops();
  const result = resolveEvidenceLocator("https://example.com/x", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "external");
}

// Bare prose (no shape at all) -> "opaque".
{
  const o = ops();
  const result = resolveEvidenceLocator("just some prose here", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "opaque");
}

// A namespace:value token (grounded, but not file/URL shaped) -> "opaque".
{
  const o = ops();
  const result = resolveEvidenceLocator("commit:abc123", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "opaque");
}

// A relative file-style path that DOES exist under one of the baseDirs ->
// "resolved".
{
  const o = ops({ existsSet: new Set(["/repo/src/net.ts"]) });
  const result = resolveEvidenceLocator("src/net.ts", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "resolved");
}

// A relative file-style path that does NOT exist under any baseDir ->
// "unresolved".
{
  const o = ops({ existsSet: new Set() });
  const result = resolveEvidenceLocator("src/missing.ts", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "unresolved");
}

// Multiple baseDirs: resolves against the FIRST one that has the file —
// order matters, first match wins.
{
  const o = ops({ existsSet: new Set(["/second/src/net.ts"]) });
  const result = resolveEvidenceLocator("src/net.ts", ["/first", "/second"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "resolved", "must check every baseDir, not just the first");
}

// An absolute path locator bypasses baseDirs entirely — checked directly.
{
  const o = ops({ existsSet: new Set(["/abs/path/file.ts"]) });
  const result = resolveEvidenceLocator("/abs/path/file.ts", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "resolved");
}

// An absolute path that does not exist -> unresolved (still checked
// directly, baseDirs never consulted).
{
  const o = ops({ existsSet: new Set() });
  const result = resolveEvidenceLocator("/abs/missing.ts", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "unresolved");
}

// A locator with a :line suffix strips the suffix before resolving the
// path part against disk.
{
  const o = ops({ existsSet: new Set(["/repo/src/net.ts"]) });
  const result = resolveEvidenceLocator("src/net.ts:42", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "resolved", "the :line suffix must be stripped before checking existence");
}

// A locator with a :line-line RANGE suffix also strips correctly.
{
  const o = ops({ existsSet: new Set(["/repo/src/net.ts"]) });
  const result = resolveEvidenceLocator("src/net.ts:10-20", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "resolved");
}

// A path containing whitespace is classified opaque (not file-style) even
// if it superficially has a slash — the "no whitespace in pathPart" guard.
{
  const o = ops({ existsSet: new Set() });
  const result = resolveEvidenceLocator("some/path with spaces.ts", ["/repo"], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "opaque", "a path containing whitespace must not be treated as a resolvable file locator");
}

// Empty baseDirs array with a relative file-style locator -> unresolved
// (nothing to resolve against, never throws).
{
  const o = ops({ existsSet: new Set() });
  const result = resolveEvidenceLocator("src/net.ts", [], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "unresolved");
}

// Falsy entries in baseDirs are filtered out before resolving (guards
// against a stray empty-string/undefined base dir crashing resolve()).
{
  const o = ops({ existsSet: new Set(["/repo/src/net.ts"]) });
  const result = resolveEvidenceLocator("src/net.ts", ["", "/repo", null], o.exists, o.isAbsolute, o.resolve);
  assert.equal(result, "resolved", "falsy baseDirs entries must be filtered, not passed to resolve()");
}

process.stdout.write("trustcore-evidence-resolve-locator-states: ok\n");
