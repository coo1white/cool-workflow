#!/usr/bin/env node
"use strict";

// Key-omission-vs-null in hash inputs (ledger-trust.md Rebuild risk #2).
// recordHashInput must OMIT absent reportedUsage/resultDigest keys, never
// serialize them as null -- getting this wrong changes every record hash and
// breaks back-compat with pre-upgrade (usage-only) ledgers. This is verified
// black-box: a real stub-agent run reports NO usage at all (attestation
// "absent"), so its telemetry record must have neither a "reportedUsage" nor
// a "resultDigest" KEY on disk (not even set to null) -- and the record must
// still independently re-hash clean, proving the recompute uses the same
// omit-don't-null rule the writer used.

const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const runId = JSON.parse(r.stdout).runId;

  const telemetryPath = path.join(repo, ".cw", "runs", runId, "telemetry.json");
  const telemetry = readJson(telemetryPath);
  assert.ok(telemetry.records.length > 0, "a full run must record at least one telemetry hop");

  for (const rec of telemetry.records) {
    // the stub agent reports no usage at all -> every hop must be "absent"
    assert.equal(rec.attestation, "absent");
    // KEY OMISSION, not null: neither key is present at all on disk.
    assert.ok(!("reportedUsage" in rec), "reportedUsage key must be OMITTED, not present as null, when the agent reports no usage");
    assert.ok(!("resultDigest" in rec), "resultDigest key must be OMITTED, not present as null, on a hop with no signature covering a result");
    // usageSignature and attestationReason, by contrast, ARE always-present
    // keys that fall back to null/a string -- they are NOT omitted.
    assert.ok("attestationReason" in rec, "attestationReason is a present key (string), unlike the omitted pair");
    assert.equal(typeof rec.attestationReason, "string");
  }

  // Independent recompute must agree exactly -- proving verify uses the same
  // omit-don't-null rule the writer used (a null-vs-omit mismatch would show
  // up here as a spurious record-hash mismatch on every clean absent-usage
  // record, since old usage-only ledgers must hash byte-identical).
  const verify = run(["telemetry", "verify", runId, "--json"], { cwd: repo });
  assert.equal(verify.status, 0);
  const verifyResult = JSON.parse(verify.stdout);
  assert.equal(verifyResult.verified, true);
  assert.deepEqual(verifyResult.failedChecks, []);

  // Cross-check: reportedUsageDigest is still present (it digests the
  // OMITTED usage as stableStringify(null), i.e. "the agent reported
  // nothing" is itself bound) -- it is not itself omitted.
  for (const rec of telemetry.records) {
    assert.ok("reportedUsageDigest" in rec);
    assert.match(rec.reportedUsageDigest, /^sha256:[0-9a-f]{64}$/);
  }
});
