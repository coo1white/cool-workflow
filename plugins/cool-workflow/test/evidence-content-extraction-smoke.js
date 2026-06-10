#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { extractEvidenceContent } = require("../dist/evidence-grounding");

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

process.stdout.write("evidence-content-extraction-smoke: ok\n");
