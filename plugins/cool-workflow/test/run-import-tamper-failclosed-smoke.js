"use strict";
// run-import-tamper-failclosed-smoke: importing a tampered run archive must FAIL
// CLOSED — refuse with a non-zero exit, a single `cw:` stderr line, silent stdout,
// and NOTHING written to disk (the digest/size/count/manifest checks run BEFORE
// ensureRunDirs). Plus the opt-in CW_REQUIRE_ARCHIVE_INTEGRITY=1 hardening: an
// archive whose integrity block was stripped is refused when the env is set, while
// the default (unset) preserves byte-identical legacy import.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { importRun } = require("../dist/run-export");
const cli = path.join(__dirname, "..", "dist", "cli.js");
const node = process.execPath;

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cw-import-${tag}-`));
}

// Build one real run and export a canonical archive once; each case mutates a copy.
const src = freshDir("src");
const runId = JSON.parse(
  execFileSync(node, [cli, "plan", "architecture-review", "--repo", src, "--question", "tamper fail-closed"], { cwd: src, encoding: "utf8" })
).runId;
const exported = JSON.parse(execFileSync(node, [cli, "run", "export", runId, "--json"], { cwd: src, encoding: "utf8" }));
const goodArchive = exported.path || exported.archivePath;
const goodJson = fs.readFileSync(goodArchive, "utf8");

// Tamper a NON-EMPTY file (files[0] is often the empty state.json placeholder, whose
// digest is the empty-string hash — flipping a zero-length buffer is a no-op).
const targetIdx = JSON.parse(goodJson).files.findIndex((f) => f.sizeBytes > 0);
assert.ok(targetIdx >= 0, "archive carries at least one non-empty file to tamper");

// Sanity: the clean archive imports fine via the CLI (proves the harness is sound).
{
  const dir = freshDir("ok");
  const r = spawnSync(node, [cli, "run", "import", goodArchive, "--target", dir, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, "clean archive imports (exit 0)");
}

// Write a mutated copy of the archive and return its path.
function writeTampered(tag, mutate) {
  const a = JSON.parse(goodJson);
  mutate(a);
  const p = path.join(freshDir(`t-${tag}`), "tampered.cwrun.json");
  fs.writeFileSync(p, JSON.stringify(a));
  return p;
}

// Assert BOTH the direct importRun() and the `cw run import` CLI refuse the archive,
// matching `re`, writing nothing to the (fresh, separate) target dirs.
function assertRefused(label, archivePath, re) {
  // (1) direct API throws (env unset in this process).
  const apiDir = freshDir("api");
  assert.throws(() => importRun(archivePath, apiDir), re, `${label}: importRun throws`);
  assert.ok(!fs.existsSync(path.join(apiDir, ".cw", "runs", runId)), `${label}: no partial restore (direct)`);

  // (2) CLI exits non-zero, single cw: stderr line, silent stdout, nothing on disk.
  const cliDir = freshDir("cli");
  const r = spawnSync(node, [cli, "run", "import", archivePath, "--target", cliDir, "--json"], { encoding: "utf8" });
  assert.notEqual(r.status, 0, `${label}: CLI import exits non-zero`);
  assert.match(r.stderr, /^cw: /m, `${label}: stderr carries the cw: diagnostic`);
  assert.match(r.stderr, re, `${label}: stderr matches ${re}`);
  assert.equal(r.stdout.trim(), "", `${label}: stdout silent on failure (Rule of Silence)`);
  const restored = path.join(cliDir, ".cw", "runs", runId);
  assert.ok(!fs.existsSync(restored) || fs.readdirSync(restored).length === 0, `${label}: no partial restore (CLI)`);
}

// (1) digest mismatch: flip a byte in a file's content, leave its sha256 stale.
assertRefused("digest", writeTampered("digest", (a) => {
  const bytes = Buffer.from(a.files[targetIdx].contentBase64, "base64");
  bytes[0] = bytes[0] ^ 0xff; // same length -> size check passes, digest fails
  a.files[targetIdx].contentBase64 = bytes.toString("base64");
}), /digest mismatch/i);

// (2) manifest mismatch: replace content AND recompute the per-file sha256/size
// correctly, but leave integrity.manifestSha256 stale.
assertRefused("manifest", writeTampered("manifest", (a) => {
  const bytes = Buffer.from("totally-different-bytes-of-the-same-handling", "utf8");
  a.files[targetIdx].contentBase64 = bytes.toString("base64");
  a.files[targetIdx].sha256 = sha256Hex(bytes);
  a.files[targetIdx].sizeBytes = bytes.length;
  // integrity.manifestSha256 untouched -> manifest digest mismatch
}), /manifest digest mismatch/i);

// (3) size mismatch: truncate the content and recompute sha256 over the TRUNCATED
// bytes (digest passes) but keep the ORIGINAL sizeBytes.
assertRefused("size", writeTampered("size", (a) => {
  const bytes = Buffer.from(a.files[targetIdx].contentBase64, "base64");
  const truncated = bytes.subarray(0, Math.max(0, bytes.length - 3));
  a.files[targetIdx].contentBase64 = truncated.toString("base64");
  a.files[targetIdx].sha256 = sha256Hex(truncated); // digest now matches truncated bytes
  // sizeBytes left at the original -> size mismatch
}), /size mismatch/i);

// (4) file-count mismatch: append a self-consistent extra file entry without
// bumping integrity.fileCount.
assertRefused("count", writeTampered("count", (a) => {
  a.files.push({ ...a.files[targetIdx], relativePath: a.files[targetIdx].relativePath + ".dup" });
  // integrity.fileCount unchanged -> file count mismatch (checked before manifest)
}), /file count mismatch/i);

// (5) malformed base64 is refused before any restore write.
assertRefused("bad-base64", writeTampered("bad-base64", (a) => {
  a.files[targetIdx].contentBase64 = "not base64!!!!";
}), /base64 invalid/i);

// --- Env-gated hardening: a stripped-integrity archive ---
const stripped = writeTampered("stripped", (a) => { delete a.integrity; });

// (a) default (env unset): legacy compat — importRun SUCCEEDS, nothing refused.
{
  const dir = freshDir("legacy");
  const result = importRun(stripped, dir); // process env has no CW_REQUIRE_ARCHIVE_INTEGRITY
  assert.ok(result, "stripped-integrity archive imports by default (legacy compat)");
  assert.ok(fs.existsSync(path.join(dir, ".cw", "runs", runId)), "legacy import actually restores the run");
}

// (b) CW_REQUIRE_ARCHIVE_INTEGRITY=1: the stripped archive is refused.
{
  const dir = freshDir("strict");
  const r = spawnSync(node, [cli, "run", "import", stripped, "--target", dir, "--json"], {
    encoding: "utf8",
    env: { ...process.env, CW_REQUIRE_ARCHIVE_INTEGRITY: "1" }
  });
  assert.notEqual(r.status, 0, "strict mode refuses a stripped-integrity archive (exit non-zero)");
  assert.match(r.stderr, /integrity block required/i, "strict refusal explains the missing integrity block");
  const restored = path.join(dir, ".cw", "runs", runId);
  assert.ok(!fs.existsSync(restored) || fs.readdirSync(restored).length === 0, "strict refusal leaves nothing on disk");
}

process.stdout.write("run-import-tamper-failclosed-smoke: ok (4 tamper modes refused, env-gate hardening proven)\n");
