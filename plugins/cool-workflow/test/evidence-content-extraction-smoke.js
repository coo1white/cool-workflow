#!/usr/bin/env node
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { extractEvidenceContent, resolveEvidenceLocator } = require("../dist/evidence-grounding");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-evidence-content-"));
const testFile = path.join(tmp, "test.ts");
fs.writeFileSync(testFile, "line one\nline two\nline three has evidence\nline four\n", "utf8");

// File-style locator with line number
const content = extractEvidenceContent(`${testFile}:3`, [tmp]);
assert.equal(content, "line three has evidence", "should extract line 3 content");

// File without line number
const preview = extractEvidenceContent(testFile, [tmp]);
assert.ok(preview, "should preview file without line number");
assert.ok(preview.length <= 200, "preview should be capped at 200 chars");

// Missing file
const missing = extractEvidenceContent("/no/such/file.ts:42", [tmp]);
assert.equal(missing, undefined, "missing file should return undefined");

// Non-file locator
const url = extractEvidenceContent("https://example.com", [tmp]);
assert.equal(url, undefined, "URL should return undefined");

// Line number out of range
const outOfRange = extractEvidenceContent(`${testFile}:999`, [tmp]);
assert.equal(outOfRange, undefined, "out of range line should return undefined");

// --- Evidence resolution in default strict mode ---
// This test runs in the smoke runner sandbox with CW_REQUIRE_RESOLVABLE_EVIDENCE=0,
// so unresolvedFileEvidence returns [] (shape-only check). We verify the resolution
// primitives directly instead, which are pure functions unaffected by the env var.
const resolvedR = resolveEvidenceLocator(testFile, [tmp]);
assert.equal(resolvedR, "resolved", "existing file locator must resolve");

const unresolvedR = resolveEvidenceLocator("/no/such/file.ts:42", [tmp]);
assert.equal(unresolvedR, "unresolved", "missing file locator must be unresolved");

// unresolvedFileEvidence is gated by requireResolvableEvidence(). In the smoke
// sandbox (CW_REQUIRE_RESOLVABLE_EVIDENCE=0) it always returns []. In production
// (default) it would return the unresolved entries. Verify the primitive instead.
const file = path.join(tmp, "real.txt");
fs.writeFileSync(file, "evidence content\n", "utf8");
const locators = [`${file}:1`, `https://example.com`, `exitCode:0`];
for (const loc of locators) {
  const r = resolveEvidenceLocator(loc, [tmp]);
  if (loc === `${file}:1`) assert.equal(r, "resolved", `"${loc}" must resolve`);
  else assert.notEqual(r, "unresolved", `"${loc}" must not be flagged unresolved`);
}

// --- Strict mode (default production path) verification ---
// Spawn a child with CW_REQUIRE_RESOLVABLE_EVIDENCE=1 to verify the production
// gate rejects unresolvable file-style evidence.
const strictProbe = [
  'const assert = require("node:assert/strict");',
  `const { unresolvedFileEvidence } = require("${path.join(__dirname, "..", "dist", "evidence-grounding.js")}");`,
  "const file = process.env.CW_EVIDENCE_FILE;",
  "const unresolved = unresolvedFileEvidence([file + ':1', '/no/such/path.ts:42', 'https://example.com', 'exitCode:0'], [process.env.CW_EVIDENCE_DIR]);",
  "assert.deepEqual(unresolved, ['/no/such/path.ts:42'], 'only the non-existent file must be flagged');",
  'process.stdout.write("evidence-strict-probe: ok\\n");',
  ""
].join("\n");
const probeFile = path.join(tmp, "probe.js");
fs.writeFileSync(probeFile, strictProbe, "utf8");
execFileSync(process.execPath, [probeFile], {
  env: { ...process.env, CW_REQUIRE_RESOLVABLE_EVIDENCE: "1", CW_EVIDENCE_FILE: file, CW_EVIDENCE_DIR: tmp },
  encoding: "utf8"
});

process.stdout.write("evidence-content-extraction-smoke: ok\n");
