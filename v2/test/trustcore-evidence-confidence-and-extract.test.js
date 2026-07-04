#!/usr/bin/env node
// trustcore-evidence-confidence-and-extract — pins
// computeEvidenceConfidence's tiers (ungrounded < grounded < resolvable <
// verified; verified is NEVER auto-given) and extractEvidenceContent's
// line/prefix extraction (SPEC/ledger-trust.md "Evidence gates": "Confidence
// tiers, in order: ungrounded < grounded < resolvable < verified. verified is
// NEVER auto-given — only explicit host attestation sets it"; "extractEvidenceContent(...)
// returns line 42 (1-indexed) ... or the first 200 chars with no line
// number; undefined when it can not read — it never makes content up").

const assert = require("node:assert/strict");
const {
  computeEvidenceConfidence,
  requireResolvableEvidence,
  unresolvedFileEvidence,
  extractEvidenceContent,
} = require("../dist/core/trust/evidence-grounding");

function opsAlwaysExists() {
  return {
    exists: () => true,
    isAbsolute: (p) => p.startsWith("/"),
    resolve: (base, rel) => `${base}/${rel}`,
  };
}
function opsNeverExists() {
  return {
    exists: () => false,
    isAbsolute: (p) => p.startsWith("/"),
    resolve: (base, rel) => `${base}/${rel}`,
  };
}

// Bare prose (not grounded at all) -> ungrounded, regardless of baseDirs/ops.
{
  const tier = computeEvidenceConfidence("just some prose", ["/repo"], opsAlwaysExists());
  assert.equal(tier, "ungrounded");
}

// Grounded but no baseDirs/ops supplied (shape-only mode) -> grounded, never
// escalates to resolvable without a resolution attempt.
{
  const tier = computeEvidenceConfidence("src/net.ts", undefined, undefined);
  assert.equal(tier, "grounded");
}

// requireResolvableEvidence default (env unset) is ON (true) — file-style
// locators must exist on disk by default.
{
  assert.equal(requireResolvableEvidence({}), true, "unset env must default to strict/on");
  assert.equal(requireResolvableEvidence({ CW_REQUIRE_RESOLVABLE_EVIDENCE: "" }), true, "empty string must also default to on");
}

// requireResolvableEvidence: explicit off values.
{
  for (const off of ["0", "false", "no", "off", "FALSE", "Off"]) {
    assert.equal(requireResolvableEvidence({ CW_REQUIRE_RESOLVABLE_EVIDENCE: off }), false, `"${off}" must turn strict mode off`);
  }
}

// requireResolvableEvidence: any other truthy-looking value stays on.
{
  assert.equal(requireResolvableEvidence({ CW_REQUIRE_RESOLVABLE_EVIDENCE: "1" }), true);
  assert.equal(requireResolvableEvidence({ CW_REQUIRE_RESOLVABLE_EVIDENCE: "yes" }), true);
}

// A grounded URL never escalates past "grounded" even in strict mode with
// ops (URLs are not resolved against disk).
{
  const tier = computeEvidenceConfidence("https://example.com/x", ["/repo"], opsAlwaysExists(), {});
  assert.equal(tier, "grounded");
}

// A grounded namespace:value token (opaque shape) stays "grounded" — only
// file-style locators escalate to "resolvable".
{
  const tier = computeEvidenceConfidence("commit:abc123", ["/repo"], opsAlwaysExists(), {});
  assert.equal(tier, "grounded");
}

// A grounded file-style locator that DOES resolve on disk (strict mode on,
// exists() true) escalates to "resolvable".
{
  const tier = computeEvidenceConfidence("src/net.ts", ["/repo"], opsAlwaysExists(), {});
  assert.equal(tier, "resolvable");
}

// A grounded file-style locator that does NOT resolve on disk stays
// "grounded" (not downgraded to ungrounded — shape was still valid).
{
  const tier = computeEvidenceConfidence("src/missing.ts", ["/repo"], opsNeverExists(), {});
  assert.equal(tier, "grounded");
}

// With strict mode explicitly OFF via env, a file locator stays "grounded"
// even when it WOULD resolve — the strict escalation path is skipped
// entirely, by design.
{
  const tier = computeEvidenceConfidence("src/net.ts", ["/repo"], opsAlwaysExists(), { CW_REQUIRE_RESOLVABLE_EVIDENCE: "0" });
  assert.equal(tier, "grounded", "strict mode off must skip the resolution escalation entirely");
}

// "verified" tier is never produced by computeEvidenceConfidence itself —
// it is not one of the possible return values for ANY input this pure
// function can construct (only explicit host attestation elsewhere sets it).
{
  const allPossibleTiers = new Set();
  for (const raw of ["prose", "src/x.ts", "https://x.com", "commit:1", "src/missing.ts"]) {
    for (const ops of [opsAlwaysExists(), opsNeverExists(), undefined]) {
      allPossibleTiers.add(computeEvidenceConfidence(raw, ["/repo"], ops, {}));
    }
  }
  assert.ok(!allPossibleTiers.has("verified"), "computeEvidenceConfidence must never itself produce the verified tier");
}

// unresolvedFileEvidence: returns [] when strict mode is off, regardless of
// resolution state.
{
  const result = unresolvedFileEvidence(["src/missing.ts"], ["/repo"], opsNeverExists(), { CW_REQUIRE_RESOLVABLE_EVIDENCE: "0" });
  assert.deepEqual(result, []);
}

// unresolvedFileEvidence: strict mode on, all resolve -> [].
{
  const result = unresolvedFileEvidence(["src/a.ts", "src/b.ts"], ["/repo"], opsAlwaysExists(), {});
  assert.deepEqual(result, []);
}

// unresolvedFileEvidence: strict mode on, some fail to resolve -> those exact entries.
{
  const result = unresolvedFileEvidence(["src/a.ts", "https://url.example"], ["/repo"], opsNeverExists(), {});
  assert.deepEqual(result, ["src/a.ts"], "a URL is 'external', never counted as unresolved; only file-style locators that fail to resolve are listed");
}

// unresolvedFileEvidence: non-array input -> [].
{
  assert.deepEqual(unresolvedFileEvidence(undefined, ["/repo"], opsNeverExists(), {}), []);
}

// --- extractEvidenceContent ---

function fakeReadFile(contentByPath) {
  return (p) => contentByPath[p];
}

// A file-style locator with a line suffix returns that 1-indexed line.
{
  const ops = { exists: (p) => p === "/repo/file.ts", isAbsolute: (p) => p.startsWith("/"), resolve: (base, rel) => `${base}/${rel}` };
  const content = "line1\nline2\nline3\n";
  const readFile = fakeReadFile({ "/repo/file.ts": content });
  const result = extractEvidenceContent("file.ts:2", ["/repo"], ops, readFile);
  assert.equal(result, "line2", "line number is 1-indexed");
}

// A file-style locator with NO line suffix returns the first 200 chars.
{
  const ops = { exists: (p) => p === "/repo/file.ts", isAbsolute: (p) => p.startsWith("/"), resolve: (base, rel) => `${base}/${rel}` };
  const content = "x".repeat(500);
  const readFile = fakeReadFile({ "/repo/file.ts": content });
  const result = extractEvidenceContent("file.ts", ["/repo"], ops, readFile);
  assert.equal(result, "x".repeat(200), "no line number must yield exactly the first 200 chars");
  assert.equal(result.length, 200);
}

// A locator whose file does not exist -> undefined, never fabricated content.
{
  const ops = { exists: () => false, isAbsolute: (p) => p.startsWith("/"), resolve: (base, rel) => `${base}/${rel}` };
  const readFile = fakeReadFile({});
  const result = extractEvidenceContent("file.ts:5", ["/repo"], ops, readFile);
  assert.equal(result, undefined);
}

// A non-file-style locator (e.g. a URL) -> undefined (extraction only
// applies to file-style locators).
{
  const ops = { exists: () => true, isAbsolute: () => false, resolve: (b, r) => `${b}/${r}` };
  const readFile = fakeReadFile({});
  const result = extractEvidenceContent("https://example.com/page", ["/repo"], ops, readFile);
  assert.equal(result, undefined, "a URL locator must never attempt file extraction");
}

// A line number requested beyond the file's actual line count -> undefined
// (never fabricates a line that is not there).
{
  const ops = { exists: (p) => p === "/repo/file.ts", isAbsolute: (p) => p.startsWith("/"), resolve: (base, rel) => `${base}/${rel}` };
  const content = "only one line\n";
  const readFile = fakeReadFile({ "/repo/file.ts": content });
  const result = extractEvidenceContent("file.ts:99", ["/repo"], ops, readFile);
  assert.equal(result, undefined);
}

// readFile itself returning undefined (unreadable) -> undefined propagates,
// never throws.
{
  const ops = { exists: (p) => p === "/repo/file.ts", isAbsolute: (p) => p.startsWith("/"), resolve: (base, rel) => `${base}/${rel}` };
  const readFile = () => undefined;
  const result = extractEvidenceContent("file.ts", ["/repo"], ops, readFile);
  assert.equal(result, undefined);
}

process.stdout.write("trustcore-evidence-confidence-and-extract: ok\n");
