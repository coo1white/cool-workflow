#!/usr/bin/env node
"use strict";

// cw run export / import / verify-import / inspect-archive / restore — the
// portable archive family, reachable from any completed run id. Uses the
// single-task end-to-end-golden-path app (fast) as the source run.
//
// Note: there is no "cw compare" command in the old build (only
// src/compare.ts's internal compareBytes helper, which is not a CLI verb).
// Asserted below as an explicit unknown-command check rather than silently
// skipped, per the FOCUS note to check reachability.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, freshDir, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  const payload = JSON.parse(drive.stdout);
  const runId = payload.runId;

  // --- "cw compare" is not a real command: it fails like any unknown verb ---
  const compare = run(["compare"], { cwd: repo });
  assert.equal(compare.status, 1);
  assert.equal(compare.stdout, "");
  assert.equal(compare.stderr, "cw: Unknown command: compare\n  Try: cw help\n");

  // --- cw run export <id> ---
  const exp = run(["run", "export", runId], { cwd: repo });
  assert.equal(exp.status, 0);
  assert.equal(exp.stderr, "");
  const expResult = JSON.parse(exp.stdout);
  assert.equal(expResult.runId, runId);
  // Default output name is <runId>.cwrun.json in the caller's cwd; compare
  // by basename since the OS may resolve the cwd through a symlink (e.g.
  // macOS /var -> /private/var) that the CLI reports with realpath.
  assert.equal(path.basename(expResult.path), `${runId}.cwrun.json`);
  assert.equal(fs.realpathSync(path.dirname(expResult.path)), fs.realpathSync(repo));
  assert.equal(expResult.taskCount, 1);
  assert.equal(expResult.trustKeyEmbedded, false);
  assert.match(expResult.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(expResult.archiveSha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(expResult.path));

  // The archive is one JSON document with the documented top-level shape.
  const archive = readJson(expResult.path);
  assert.equal(archive.schemaVersion, 1);
  assert.ok(Array.isArray(archive.files));
  assert.ok(archive.integrity && typeof archive.integrity.fileCount === "number");
  // state.json / import-manifest.json / *.lock are never packed.
  const packedPaths = archive.files.map((f) => f.relativePath);
  assert.ok(!packedPaths.includes("state.json"));
  assert.ok(!packedPaths.some((p) => p.endsWith(".lock")));
  // Files sort by compareBytes (code-point order) on relativePath.
  const sorted = packedPaths.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(packedPaths, sorted, "archive files[] must be in code-point order");

  // --- cw run inspect-archive <path>: read-only, never throws, all-pass ---
  const insp = run(["run", "inspect-archive", expResult.path], { cwd: repo });
  assert.equal(insp.status, 0);
  const inspResult = JSON.parse(insp.stdout);
  assert.equal(inspResult.ok, true);
  assert.equal(inspResult.schemaSupported, true);
  assert.equal(inspResult.runId, runId);
  assert.equal(inspResult.manifestSha256, expResult.manifestSha256);
  assert.ok(inspResult.checks.every((c) => c.pass === true));

  // --- cw run inspect-archive on a missing file: structured failure, never
  // a thrown exception; stdout is still valid JSON; exit 1.
  const inspMissing = run(["run", "inspect-archive", path.join(repo, "does-not-exist.cwrun.json")], {
    cwd: repo,
  });
  assert.equal(inspMissing.status, 1);
  const inspMissingResult = JSON.parse(inspMissing.stdout);
  assert.equal(inspMissingResult.ok, false);
  assert.equal(inspMissingResult.checks[0].code, "archive-unreadable");

  // --- cw run import <archive> --target <dir> ---
  const target = freshDir("import-target");
  const imp = run(["run", "import", expResult.path, "--target", target], { cwd: repo });
  assert.equal(imp.status, 0, "import exits 0 even if inner verification were false");
  const impResult = JSON.parse(imp.stdout);
  assert.equal(impResult.run.id, runId);
  assert.ok(impResult.verifyCommand.includes("run verify-import"));
  assert.ok(impResult.verification);
  assert.ok(impResult.registry);

  const importedManifest = path.join(target, ".cw", "runs", runId, "import-manifest.json");
  assert.ok(fs.existsSync(importedManifest));
  const manifest = readJson(importedManifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.runId, runId);
  assert.ok(!("contentBase64" in (manifest.files[0] || {})), "import-manifest.json strips contentBase64");

  // --- cw run verify-import <id> --cwd <target> --json ---
  const verify = run(["run", "verify-import", runId, "--cwd", target, "--json"], { cwd: repo });
  assert.equal(verify.status, 0, "verify-import without --strict exits 0 regardless of ok");
  const verifyResult = JSON.parse(verify.stdout);
  assert.equal(verifyResult.runId, runId);
  assert.equal(verifyResult.ok, true);
  assert.ok(verifyResult.checkedFiles > 0);
  assert.ok(verifyResult.checks.every((c) => c.pass === true));

  // --- cw run restore <archive> --target <dir>: inspect + import + verify
  // in one fail-closed step ---
  const target2 = freshDir("restore-target");
  const restore = run(["run", "restore", expResult.path, "--target", target2], { cwd: repo });
  assert.equal(restore.status, 0);
  const restoreResult = JSON.parse(restore.stdout);
  assert.equal(restoreResult.schemaVersion, 1);
  assert.equal(restoreResult.ok, true);
  assert.equal(restoreResult.target, target2);
  assert.equal(restoreResult.inspect.ok, true);
  assert.ok(restoreResult.imported);
  assert.ok(restoreResult.verify);
  assert.ok(fs.existsSync(path.join(target2, ".cw", "runs", runId, "state.json")));

  // --- cw run restore on a tampered archive: fail closed, nothing written ---
  const tamperedPath = path.join(repo, "tampered.cwrun.json");
  const tampered = JSON.parse(JSON.stringify(archive));
  tampered.integrity.manifestSha256 = "0".repeat(64);
  fs.writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));
  const target3 = freshDir("restore-tampered-target");
  const badRestore = run(["run", "restore", tamperedPath, "--target", target3], { cwd: repo });
  assert.equal(badRestore.status, 1, "restore must exit 1 on a false verdict");
  const badRestoreResult = JSON.parse(badRestore.stdout);
  assert.equal(badRestoreResult.ok, false);
  assert.equal(badRestoreResult.inspect.ok, false);
  assert.equal(badRestoreResult.imported, null, "a bad inspect must leave imported null");
  assert.equal(badRestoreResult.verify, null, "a bad inspect must leave verify null");
  assert.ok(!fs.existsSync(path.join(target3, ".cw")), "nothing may be written on a refused restore");
});
