#!/usr/bin/env node
"use strict";

// cw report bundle / cw report verify-bundle — export + immediate offline
// self-verify, then a byte-tamper on the sealed archive must be caught by
// verify-bundle alone (no network, no agent, just the archive + the
// checked-in verifier).

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, freshDir, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  const payload = JSON.parse(drive.stdout);
  const runId = payload.runId;

  // --- cw report bundle <id>: export + self-verify in one step ---
  const bundle = run(["report", "bundle", runId], { cwd: repo });
  assert.equal(bundle.status, 0);
  assert.equal(bundle.stderr, "");
  const bundleResult = JSON.parse(bundle.stdout);
  assert.equal(bundleResult.schemaVersion, 1);
  assert.equal(bundleResult.runId, runId);
  assert.equal(bundleResult.trustKeyEmbedded, false);
  assert.equal(bundleResult.ok, true);
  assert.ok(fs.existsSync(bundleResult.archivePath));

  const v = bundleResult.verification;
  assert.equal(v.ok, true);
  assert.equal(v.archiveOk, true);
  assert.equal(v.telemetryVerified, true);
  assert.equal(v.trustAuditVerified, true);
  assert.equal(v.trustKeySource, "none", "no --with-trust-key was used");
  assert.equal(v.trustLevel, "unsigned", "no signature-covered result was ever produced");
  assert.equal(v.reportFindingsVerified, true);
  assert.deepEqual(v.failedChecks, []);

  // --- cw report verify-bundle <path>: byte-identical verification,
  // callable standalone from just the archive on disk ---
  const standalone = run(["report", "verify-bundle", bundleResult.archivePath], { cwd: repo });
  assert.equal(standalone.status, 0);
  assert.equal(standalone.stderr, "");
  assert.deepEqual(JSON.parse(standalone.stdout), v);

  // --- --extract-report writes report.md bytes to the given path ---
  const extractDir = freshDir("extract");
  const extractPath = path.join(extractDir, "extracted-report.md");
  const withExtract = run(
    ["report", "verify-bundle", bundleResult.archivePath, "--extract-report", extractPath],
    { cwd: repo }
  );
  assert.equal(withExtract.status, 0);
  const withExtractResult = JSON.parse(withExtract.stdout);
  assert.equal(withExtractResult.reportExtractedTo, extractPath);
  assert.ok(fs.existsSync(extractPath));
  assert.match(fs.readFileSync(extractPath, "utf8"), /^# End-to-End Golden Path\n/);

  // --- --require-signatures refuses this unsigned bundle ---
  const requireSig = run(["report", "verify-bundle", bundleResult.archivePath, "--require-signatures"], {
    cwd: repo,
  });
  assert.equal(requireSig.status, 1);
  const requireSigResult = JSON.parse(requireSig.stdout);
  assert.equal(requireSigResult.ok, false);
  assert.ok(requireSigResult.failedChecks.some((c) => c.code === "signatures-required"));

  // --- tamper: flip one byte of a packed result file's content, keep the
  // rest of the archive as-is. verify-bundle must catch it via the file
  // digest mismatch (archiveOk:false) — the "public key only" trust proof.
  const archive = JSON.parse(fs.readFileSync(bundleResult.archivePath, "utf8"));
  const resultFile = archive.files.find((f) => f.relativePath === "results/golden:path.md");
  assert.ok(resultFile, "the golden:path result file must be packed in the archive");
  const original = Buffer.from(resultFile.contentBase64, "base64").toString("utf8");
  const tampered = original.replace("P2", "P0");
  assert.notEqual(tampered, original, "the tamper substitution must actually change bytes");
  resultFile.contentBase64 = Buffer.from(tampered, "utf8").toString("base64");
  const tamperedPath = path.join(repo, "tampered-bundle.cwrun.json");
  fs.writeFileSync(tamperedPath, JSON.stringify(archive, null, 2));

  const tamperedVerify = run(["report", "verify-bundle", tamperedPath], { cwd: repo });
  assert.equal(tamperedVerify.status, 1, "a tampered bundle must fail closed with exit 1");
  const tamperedResult = JSON.parse(tamperedVerify.stdout);
  assert.equal(tamperedResult.ok, false);
  assert.equal(tamperedResult.archiveOk, false);
  assert.ok(
    tamperedResult.failedChecks.some((c) => c.code === "digest-mismatch"),
    "the tamper must surface as a digest-mismatch failed check"
  );

  // --- bundle verify restores into an auto-removed temp dir; nothing is
  // left behind under the caller's own tmp after a verify call.
  const tmpBefore = fs.readdirSync(require("node:os").tmpdir()).filter((n) => n.startsWith("cw-verify-bundle-"));
  run(["report", "verify-bundle", bundleResult.archivePath], { cwd: repo });
  const tmpAfter = fs.readdirSync(require("node:os").tmpdir()).filter((n) => n.startsWith("cw-verify-bundle-"));
  assert.equal(tmpAfter.length, tmpBefore.length, "verify-bundle must clean up its temp restore dir");
});
