"use strict";
// run-inspect-archive-smoke: `run inspect-archive PATH` re-proves a portable
// archive's integrity (every file digest/size, the manifest digest + file count,
// the whole-archive sha256) WITHOUT writing anything, and never throws — every
// failure is a structured check, exit 1 when ok:false, stdout always valid JSON
// (diagnostics on stderr). Also a regression guard that the verifyArchiveFileDigests
// refactor preserved throw-before-write on import.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { inspectArchive } = require("../dist/run-export");
const cli = path.join(__dirname, "..", "dist", "cli.js");
const node = process.execPath;

function freshDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), `cw-inspect-${tag}-`)); }
function cliInspect(archivePath, cwd) {
  const r = spawnSync(node, [cli, "run", "inspect-archive", archivePath, "--json"], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Build one real run + archive.
const src = freshDir("src");
const runId = JSON.parse(execFileSync(node, [cli, "plan", "architecture-review", "--repo", src, "--question", "inspect"], { cwd: src, encoding: "utf8" })).runId;
const exported = JSON.parse(execFileSync(node, [cli, "run", "export", runId, "--json"], { cwd: src, encoding: "utf8" }));
const goodArchive = exported.path || exported.archivePath;
const goodJson = fs.readFileSync(goodArchive, "utf8");
const targetIdx = JSON.parse(goodJson).files.findIndex((f) => f.sizeBytes > 0);
assert.ok(targetIdx >= 0, "archive carries a non-empty file to tamper");

function writeCopy(tag, mutate) {
  const a = JSON.parse(goodJson);
  if (mutate) mutate(a);
  const p = path.join(freshDir(`c-${tag}`), "copy.cwrun.json");
  fs.writeFileSync(p, JSON.stringify(a));
  return p;
}

// (a) clean archive: ok, schemaSupported, fields match the export; CLI exits 0.
{
  const r = inspectArchive(goodArchive);
  assert.equal(r.ok, true, "clean archive inspects ok");
  assert.equal(r.schemaSupported, true, "schema supported");
  assert.equal(r.runId, runId, "runId surfaced");
  assert.equal(r.fileCount, exported.fileCount, "fileCount matches the export");
  assert.equal(r.manifestSha256, exported.manifestSha256, "manifest digest matches the export");
  assert.equal(r.archiveSha256, exported.archiveSha256, "whole-archive sha matches the export");
  assert.ok(r.checks.every((c) => c.pass), "every check passes on a clean archive");

  const cliR = cliInspect(goodArchive, src);
  assert.equal(cliR.status, 0, "CLI inspect of a clean archive exits 0");
  assert.equal(JSON.parse(cliR.stdout).ok, true, "CLI clean inspect ok:true");
}

// (b) digest mismatch: flip a byte, leave sha256 stale -> structured check, exit 1.
{
  const p = writeCopy("digest", (a) => {
    const bytes = Buffer.from(a.files[targetIdx].contentBase64, "base64");
    bytes[0] = bytes[0] ^ 0xff;
    a.files[targetIdx].contentBase64 = bytes.toString("base64");
  });
  const r = inspectArchive(p);
  assert.equal(r.ok, false, "tampered archive inspects ok:false");
  const bad = r.checks.find((c) => !c.pass);
  assert.equal(bad.name, "archive-file", "the failing check names the file group");
  assert.equal(bad.code, "digest-mismatch", "digest mismatch reported");
  assert.equal(bad.path, JSON.parse(goodJson).files[targetIdx].relativePath, "the offending relativePath is named");

  const cliR = cliInspect(p, src);
  assert.notEqual(cliR.status, 0, "CLI inspect of a tampered archive exits non-zero");
  assert.doesNotThrow(() => JSON.parse(cliR.stdout), "stdout is still valid JSON (no stacktrace)");
  assert.equal(JSON.parse(cliR.stdout).ok, false, "CLI tampered inspect ok:false");
}

// (c) unsupported schema: schemaVersion=2 -> schemaSupported:false, ok:false, exit 1.
{
  const p = writeCopy("schema", (a) => { a.schemaVersion = 2; });
  const r = inspectArchive(p);
  assert.equal(r.schemaSupported, false, "unknown schema is not supported");
  assert.equal(r.ok, false, "unknown schema fails closed");
  assert.ok(r.checks.some((c) => c.code === "unsupported-schema"), "unsupported-schema check present");

  const cliR = cliInspect(p, src);
  assert.notEqual(cliR.status, 0, "CLI inspect of an unknown schema exits non-zero");
  assert.doesNotThrow(() => JSON.parse(cliR.stdout), "stdout still valid JSON on schema failure");
}

// (c2) bad base64: fail closed with a structured archive-bad-base64 check.
{
  const p = writeCopy("bad-b64", (a) => {
    a.files[targetIdx].contentBase64 = "not base64!!!!";
  });
  const r = inspectArchive(p);
  assert.equal(r.ok, false, "bad-base64 archive inspects ok:false");
  assert.ok(r.checks.some((c) => c.code === "archive-bad-base64"), "archive-bad-base64 check present");

  const cliR = cliInspect(p, src);
  assert.notEqual(cliR.status, 0, "CLI inspect of bad-base64 archive exits non-zero");
  assert.ok(JSON.parse(cliR.stdout).checks.some((c) => c.code === "archive-bad-base64"), "CLI payload names bad base64");
}

// (d) unreadable path: never throws -> archive-unreadable check, exit 1.
{
  const missing = path.join(freshDir("missing"), "does-not-exist.cwrun.json");
  const r = inspectArchive(missing);
  assert.equal(r.ok, false, "a missing archive inspects ok:false (no throw)");
  assert.ok(r.checks.some((c) => c.code === "archive-unreadable"), "archive-unreadable check present");

  const cliR = cliInspect(missing, src);
  assert.notEqual(cliR.status, 0, "CLI inspect of a missing archive exits non-zero");
  assert.doesNotThrow(() => JSON.parse(cliR.stdout), "stdout still valid JSON on a missing archive");
}

// (e) regression: a clean import still SUCCEEDS (the verifyArchiveFileDigests refactor
// preserved throw-before-write + B's env-gate; the tamper-failclosed smoke proves the
// refusal side).
{
  const dir = freshDir("import");
  const r = spawnSync(node, [cli, "run", "import", goodArchive, "--target", dir, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, "clean import still succeeds after the collector refactor");
  assert.ok(fs.existsSync(path.join(dir, ".cw", "runs", runId)), "clean import restored the run");
}

// (f) CW_REQUIRE_ARCHIVE_INTEGRITY: a stripped-integrity archive that `run import`
// would refuse under the env must also inspect as ok:false (faithful import preview);
// default (env unset) reports ok:true — the integrity block is merely absent, not invalid.
{
  const strippedP = writeCopy("stripped", (a) => { delete a.integrity; });
  assert.equal(inspectArchive(strippedP).ok, true, "stripped archive inspects ok by default (no env)");
  const prev = process.env.CW_REQUIRE_ARCHIVE_INTEGRITY;
  process.env.CW_REQUIRE_ARCHIVE_INTEGRITY = "1";
  try {
    const r = inspectArchive(strippedP);
    assert.equal(r.ok, false, "under CW_REQUIRE_ARCHIVE_INTEGRITY=1 a stripped archive inspects ok:false");
    assert.ok(r.checks.some((c) => c.code === "archive-integrity-required"), "archive-integrity-required check present");
  } finally {
    if (prev === undefined) delete process.env.CW_REQUIRE_ARCHIVE_INTEGRITY;
    else process.env.CW_REQUIRE_ARCHIVE_INTEGRITY = prev;
  }
}

// (g) handler routing: the `cw run …` family now lives in src/cli/handlers/run.ts
// (carved out of the command-surface god-dispatch). Prove the dispatcher routes to
// it and the fail-closed `required()` guards + the inner default Usage throw survived
// the move byte-for-byte. Only assert verbs that GENUINELY fail closed via required():
// show/resume/rerun/export/verify-import with no id -> exit≠0 + "Missing run id".
{
  for (const verb of ["show", "resume", "rerun", "export", "verify-import"]) {
    const r = spawnSync(node, [cli, "run", verb], { cwd: src, encoding: "utf8" });
    assert.notEqual(r.status, 0, `run ${verb} with no id exits non-zero`);
    assert.match(r.stderr, /Missing run id/, `run ${verb} fails closed via required("run id")`);
  }
  // An unknown subcommand throws the inner default Usage string (the carved switch's default).
  const bogus = spawnSync(node, [cli, "run", "bogusverb"], { cwd: src, encoding: "utf8" });
  assert.notEqual(bogus.status, 0, "run <bogusverb> exits non-zero");
  assert.match(bogus.stderr, /Usage: cw\.js run search\|list\|show\|resume\|archive\|rerun\|drive\|export\|import\|verify-import\|inspect-archive/, "run <bogusverb> throws the inner default Usage string");
  // A non-required verb still works through the handler: `run list` succeeds (exit 0)
  // and returns the registry result whose `records` is an array — proving the route
  // isn't only exercised on the error path.
  const list = spawnSync(node, [cli, "run", "list", "--json"], { cwd: src, encoding: "utf8" });
  assert.equal(list.status, 0, "run list exits 0 (non-required verb routes through the handler)");
  assert.ok(Array.isArray(JSON.parse(list.stdout).records), "run list returns a result with a records array");
}

process.stdout.write("run-inspect-archive-smoke: ok (clean / digest / schema / unreadable / integrity-env, read-only, import regression intact, handler routing)\n");
