#!/usr/bin/env node
"use strict";

// `cw report bundle` (export + self-verify) and `cw report verify-bundle`
// (offline re-verify), built from one real stub-agent run. Pins:
//   - ReportBundleResult / ReportBundleVerification field set, ok:true
//   - archive file digests are BARE 64-hex sha256 (no "sha256:" prefix) --
//     the one place this subsystem deliberately uses the other digest
//     spelling
//   - a tampered archive file fails closed: archiveOk:false, exit 1, with
//     an exact digest-mismatch failedCheck
//   - trustLevel is "unsigned" when nothing was signed (the stub agent
//     signs nothing), never silently "signed"

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, freshDir, caseMain, assert, stubAgentEnv } = require("../lib");

const BARE_SHA256 = /^[0-9a-f]{64}$/;

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);

  const bundleDir = freshDir("bundle-out");
  const archivePath = path.join(bundleDir, "run.cwrun.json");
  const bundle = run(["report", "bundle", payload.runId, "--output", archivePath], { cwd: repo });
  assert.equal(bundle.status, 0);
  const bundleResult = JSON.parse(bundle.stdout);
  assert.equal(bundleResult.schemaVersion, 1);
  assert.equal(bundleResult.runId, payload.runId);
  assert.equal(bundleResult.ok, true);
  assert.equal(bundleResult.verification.ok, true);
  assert.equal(bundleResult.verification.archiveOk, true);
  assert.equal(bundleResult.verification.telemetryVerified, true);
  assert.equal(bundleResult.verification.trustAuditVerified, true);
  assert.equal(bundleResult.verification.trustLevel, "unsigned", "the stub agent signs nothing");
  assert.deepEqual(bundleResult.verification.failedChecks, []);
  assert.ok(fs.existsSync(archivePath), "the archive file must exist at --output");

  // archive file digests are bare 64-hex sha256 -- NOT the "sha256:" family
  const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  assert.ok(Array.isArray(archive.files) && archive.files.length > 0);
  for (const f of archive.files.slice(0, 5)) {
    assert.match(f.sha256, BARE_SHA256, `${f.relativePath} sha256 must be bare 64 hex, no prefix`);
  }
  assert.equal(archive.integrity.fileCount, archive.files.length);
  assert.match(archive.integrity.manifestSha256, BARE_SHA256);

  // clean offline verify-bundle on the untouched archive
  const verifyClean = run(["report", "verify-bundle", archivePath]);
  assert.equal(verifyClean.status, 0);
  const cleanVerification = JSON.parse(verifyClean.stdout);
  assert.equal(cleanVerification.ok, true);
  assert.equal(cleanVerification.archiveOk, true);

  // tamper: flip one file's content, keep its recorded digest
  const tamperedPath = path.join(bundleDir, "tampered.cwrun.json");
  const tamperedArchive = JSON.parse(JSON.stringify(archive));
  tamperedArchive.files[0].contentBase64 = Buffer.from("tampered bytes").toString("base64");
  fs.writeFileSync(tamperedPath, JSON.stringify(tamperedArchive));

  const verifyTampered = run(["report", "verify-bundle", tamperedPath]);
  assert.equal(verifyTampered.status, 1);
  const tamperedVerification = JSON.parse(verifyTampered.stdout);
  assert.equal(tamperedVerification.ok, false);
  assert.equal(tamperedVerification.archiveOk, false);
  const digestFail = tamperedVerification.failedChecks.find(
    (c) => c.name === "archive-file" && c.code === "digest-mismatch"
  );
  assert.ok(digestFail, "a tampered archive file must fail with digest-mismatch");
});
