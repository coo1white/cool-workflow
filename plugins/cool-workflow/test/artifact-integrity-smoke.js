#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { hashArtifactFile } = require("../dist/state");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-artifact-hash-"));
const testFile = path.join(tmp, "test-artifact.txt");
fs.writeFileSync(testFile, "hello world\n", "utf8");

const artifact = {
  id: "test-artifact",
  kind: "markdown",
  path: testFile
};

const result = hashArtifactFile(artifact);

assert.ok(result.sha256, "artifact should have sha256 after hashing");
assert.ok(result.sizeBytes, "artifact should have sizeBytes after hashing");
assert.equal(typeof result.sha256, "string");
assert.ok(result.sha256.startsWith("sha256:"), "sha256 should have sha256: prefix");
assert.equal(result.sha256.length, 71, "sha256:hex should be 71 chars (7 prefix + 64 hex)");
assert.equal(result.sizeBytes, 12, "sizeBytes should match file content length");
assert.equal(result.id, "test-artifact", "hashArtifactFile should not mutate id");

// Missing file: should not throw
const missing = hashArtifactFile({ id: "nope", kind: "markdown", path: "/no/such/file" });
assert.equal(missing.sha256, undefined, "missing file should not set sha256");
assert.equal(missing.sizeBytes, undefined, "missing file should not set sizeBytes");

process.stdout.write("artifact-integrity-smoke: ok\n");
