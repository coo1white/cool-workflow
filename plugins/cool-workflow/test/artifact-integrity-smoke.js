#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// REAL-GAP (v2 cutover): the old flat `src/state.ts` exported
// `hashArtifactFile(artifact)` — it read the file at `artifact.path`, stamped
// `sha256` (full `sha256:`+64 hex, via core sha256) and `sizeBytes` onto the
// StateArtifact, and silently skipped a missing file. See old source at
// commit c8a6265~1 src/state.ts:338.
//
// v2 split the old flat `state` into `../dist/shell/run-store` (shell side) +
// `../dist/core/state/*` (pure side). The StateArtifact type still carries
// `sha256?`/`sizeBytes?` (src/core/state/types.ts:69) and run-export still
// consumes them (src/shell/run-export.ts:620-621), BUT no v2 module reimplements
// the function that POPULATES those fields from disk. `hashArtifactFile` is gone
// from every dist module (grep -rl hashArtifactFile dist/ = empty), so the
// require below resolves the successor module but `hashArtifactFile` is
// undefined. This lands the failure on the genuine missing behavior, not an
// import crash. See src/core/hash.ts:sha256 (the still-present primitive the
// old wrapper used) — only the file-reading wrapper is missing.
const { hashArtifactFile } = require("../dist/shell/run-store");

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
