#!/usr/bin/env node
"use strict";

// `cw audit verify` and `cw telemetry verify` against a real stub-agent
// run: both fail-closed verbs recompute their hash chains independently
// and exit 0 on a clean chain. Also pins the "absent ledger" honest
// default (no signed usage from the stub agent -> attestation "absent",
// never silently trusted) and the exact human-readable telemetry lines.

const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const runId = payload.runId;

  const auditVerify = run(["audit", "verify", runId], { cwd: repo });
  assert.equal(auditVerify.status, 0);
  const auditResult = JSON.parse(auditVerify.stdout);
  assert.equal(auditResult.schemaVersion, 1);
  assert.equal(auditResult.runId, runId);
  assert.equal(auditResult.present, true);
  assert.equal(auditResult.verified, true);
  assert.ok(auditResult.eventCount > 0, "a full run must record trust-audit events");
  assert.equal(auditResult.chained, auditResult.eventCount, "every event in a fresh run must be chained");
  assert.equal(auditResult.unchained, 0);
  assert.equal(auditResult.corruptLines, 0);
  assert.deepEqual(auditResult.failedChecks, []);

  const telemetryVerify = run(["telemetry", "verify", runId], { cwd: repo });
  assert.equal(telemetryVerify.status, 0);
  assert.match(telemetryVerify.stdout, new RegExp(`^telemetry verify ${runId}\\n`));
  assert.match(telemetryVerify.stdout, /✓ VERIFIED — \d+ record\(s\), chain intact, every hash recomputed independently/);
  // the stub agent reports no usage at all -> every hop is "absent", never
  // silently trusted as attested.
  assert.match(telemetryVerify.stdout, /attested 0 · unattested 0 · absent \d+/);

  const telemetryJson = run(["telemetry", "verify", runId, "--json"], { cwd: repo });
  assert.equal(telemetryJson.status, 0);
  const telemetryResult = JSON.parse(telemetryJson.stdout);
  assert.equal(telemetryResult.schemaVersion, 1);
  assert.equal(telemetryResult.present, true);
  assert.equal(telemetryResult.verified, true);
  assert.equal(telemetryResult.attested, 0);
  assert.equal(telemetryResult.absent, telemetryResult.records);
  assert.equal(telemetryResult.signatureKeyProvided, false);
  assert.equal(telemetryResult.signaturesFailed, 0);

  // a run id with no run directory at all is a hard load failure, not an
  // "absent, verified:true" result -- absence-is-ok only applies once a
  // run exists but never wrote a chain file.
  const emptyRepo = gitRepo({ "b.txt": "hi\n" });
  const bareAuditVerify = run(["audit", "verify", "no-such-run"], { cwd: emptyRepo });
  assert.equal(bareAuditVerify.status, 1);
  // the CLI may realpath the cwd (e.g. macOS /tmp -> /private/tmp), so match
  // the tail of the path rather than a byte-exact prefix.
  const expectedTail = path.join(".cw", "runs", "no-such-run", "state.json");
  assert.match(bareAuditVerify.stderr, /^cw: File not found: .*no-such-run\/state\.json\n$/);
  assert.ok(bareAuditVerify.stderr.includes(expectedTail));
});
