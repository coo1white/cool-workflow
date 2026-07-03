#!/usr/bin/env node
"use strict";

// The 5-field/4-field signature verify fallback and the coversResult /
// resultBound split (ledger-trust.md Rebuild risk #3). A resultDigest
// present on a telemetry record must only be TRUSTED (surfaced as
// trustLevel:"signed" via report verify-bundle's resultBound-driven
// cross-check) when the signature actually COVERED it -- a bare 4-field
// signature match, even with a resultDigest sitting right there on the
// record, must never anchor that digest. Otherwise an attacker could inject
// an arbitrary resultDigest onto an old-style (usage-only) signed record
// and have it silently trusted downstream.
//
// This drives a REAL stub-agent run + `cw report bundle` to get a correctly
// shaped, digest-consistent archive, then hand-forges ONLY the telemetry
// record for one task two different ways (5-field vs 4-field-plus-injection)
// via fixtures/telemetry-sign.js, re-sealing the archive so its OTHER
// integrity machinery (already covered by report-verify-bundle-smoke /
// report-bundle-smoke cases) stays untouched. `cw report verify-bundle` is
// then the only thing under test.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");
const {
  sha256,
  generateTrustKeypair,
  signUsagePayload,
  replaceTelemetryRecord,
  resultFileContent,
} = require("./fixtures/telemetry-sign");

const TASK_ID = "map:server-api";
const USAGE = { input_tokens: 100, output_tokens: 50 };

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const ask = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(ask.status, 0);
  const runId = JSON.parse(ask.stdout).runId;

  const bundleOut = run(["report", "bundle", runId, "--json"], { cwd: repo });
  assert.equal(bundleOut.status, 0);
  const archivePath = JSON.parse(bundleOut.stdout).archivePath;
  assert.equal(JSON.parse(bundleOut.stdout).verification.trustLevel, "unsigned", "the stub agent signs nothing on its own");

  const baseBundleText = fs.readFileSync(archivePath, "utf8");

  // ---- Arm A: a genuine 5-field signature (covers the result) ----
  {
    const bundle = JSON.parse(baseBundleText);
    const key = generateTrustKeypair();
    const resultDigest = sha256(resultFileContent(bundle, TASK_ID));

    const original = replaceTelemetryRecord(bundle, TASK_ID, (rec) => {
      const promptDigest = rec.promptDigest;
      const usageSignature = signUsagePayload(key.privateKey, { usage: USAGE, runId, taskId: TASK_ID, promptDigest, resultDigest });
      const next = Object.assign({}, rec, {
        reportedUsage: USAGE,
        reportedUsageDigest: sha256(USAGE),
        usageSignature,
        resultDigest,
        attestation: "attested",
      });
      delete next.attestationReason;
      return next;
    });
    assert.equal(original.attestation, "absent", "sanity: the stub agent's real hop reported no usage");

    bundle.trust = { publicKeyPem: key.publicKeyPem, algorithm: "ed25519" };
    const forgedPath = path.join(path.dirname(archivePath), "signed-5field.cwrun.json");
    fs.writeFileSync(forgedPath, JSON.stringify(bundle));

    const verify = run(["report", "verify-bundle", forgedPath, "--json"], { cwd: repo });
    assert.equal(verify.status, 0);
    const result = JSON.parse(verify.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.archiveOk, true, "the reseal must keep archive integrity intact -- only the record content is under test");
    assert.equal(result.signaturesChecked, 1);
    assert.equal(result.signaturesReverified, 1);
    assert.equal(result.signaturesFailed, 0);
    assert.equal(result.reportFindingsVerified, true);
    assert.equal(result.trustLevel, "signed", "a signature that actually covered the result must anchor it as signed");
  }

  // ---- Arm B: a genuine OLD-STYLE 4-field signature (usage only), then an
  // attacker injects a resultDigest onto the record afterward. The signature
  // still re-verifies (the 4-field fallback arm exists for real back-compat
  // reasons), but the injected digest must NEVER be trusted as resultBound. ----
  {
    const bundle = JSON.parse(baseBundleText);
    const key = generateTrustKeypair();
    const forgedResultDigest = sha256("Finding: INJECTED, never signed by anyone");

    const original = replaceTelemetryRecord(bundle, TASK_ID, (rec) => {
      const promptDigest = rec.promptDigest;
      // sign ONLY the 4-field payload -- no resultDigest in the signed bytes.
      const usageSignature = signUsagePayload(key.privateKey, { usage: USAGE, runId, taskId: TASK_ID, promptDigest });
      const next = Object.assign({}, rec, {
        reportedUsage: USAGE,
        reportedUsageDigest: sha256(USAGE),
        usageSignature,
        // the record carries a resultDigest, but it was NEVER part of what
        // was signed -- this is the forgery under test.
        resultDigest: forgedResultDigest,
        attestation: "attested",
      });
      delete next.attestationReason;
      return next;
    });
    assert.equal(original.attestation, "absent");

    bundle.trust = { publicKeyPem: key.publicKeyPem, algorithm: "ed25519" };
    const forgedPath = path.join(path.dirname(archivePath), "signed-4field-injected.cwrun.json");
    fs.writeFileSync(forgedPath, JSON.stringify(bundle));

    const verify = run(["report", "verify-bundle", forgedPath, "--json"], { cwd: repo });
    // the signature itself is genuine over the 4-field payload, so the
    // chain + signature re-check both still pass -- this is NOT a rejected
    // bundle. The only thing that must differ from Arm A is trustLevel.
    assert.equal(verify.status, 0);
    const result = JSON.parse(verify.stdout);
    assert.equal(result.telemetryVerified, true);
    assert.equal(result.signaturesChecked, 1);
    assert.equal(result.signaturesReverified, 1, "the 4-field fallback arm must still re-verify a genuine old-style signature");
    assert.equal(result.signaturesFailed, 0);
    assert.equal(
      result.trustLevel,
      "unsigned",
      "a resultDigest that rode in on a 4-field (usage-only) signature must NEVER be trusted as resultBound"
    );
  }
});
