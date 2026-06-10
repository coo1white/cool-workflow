#!/usr/bin/env node
"use strict";

// telemetry-metrics-coverage-smoke (Track 1) — attestation coverage in the
// MetricsReport. Proves:
//   1. deriveAttestationCoverage buckets units by cryptographic verdict
//      (attested / unattested / absent / unverified) over the SAME units as
//      UsageTotals, with verifiedCoverage = attested/units;
//   2. this is a DIFFERENT axis from usage.coverage (has-a-usage-record);
//   3. the ledger sub-block reflects the tamper-evident chain (present/verified/
//      records), and flips verified:false when the on-disk ledger is edited;
//   4. deriveMetricsReport wires the block in (report.attestation), and it stays
//      deterministic (no now-derived number) for CLI<->MCP parity.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const obs = require(path.join(pluginRoot, "dist/observability.js"));
const ledger = require(path.join(pluginRoot, "dist/telemetry-ledger.js"));

const FIXED_NOW = "2026-06-10T12:00:00.000Z";
const cleanups = [];

function usage(attestation, extra = {}) {
  return { schemaVersion: 1, source: "host-attested", inputTokens: 4, outputTokens: 2, attestedAt: "2026-06-10T10:00:00.000Z", ...(attestation ? { attestation } : {}), ...extra };
}

// Fixture: 4 agent workers (attested×2, unattested, absent) + a task with an
// operator-recorded usage record carrying NO verdict (unverified) + a task with
// no usage (unreported). units = 6.
function fixtureRun(runDir) {
  return {
    schemaVersion: 1,
    id: "fixture-attest",
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:10:00.000Z",
    cwd: "/tmp/fixture",
    workflow: { id: "architecture-review", title: "t", summary: "s", limits: {}, app: { id: "architecture-review", version: "0.1.76" } },
    loopStage: "observe",
    phases: [],
    paths: { runDir },
    tasks: [
      { id: "t-operator", status: "completed", dispatchedAt: "2026-06-10T10:01:00.000Z", completedAt: "2026-06-10T10:02:00.000Z", backendId: "node", usage: usage(undefined, { source: "operator-recorded" }) },
      { id: "t-unreported", status: "completed", dispatchedAt: "2026-06-10T10:03:00.000Z", completedAt: "2026-06-10T10:04:00.000Z", backendId: "node" }
    ],
    workers: [
      mkWorker("w-att1", "tw-att1", usage("attested")),
      mkWorker("w-att2", "tw-att2", usage("attested")),
      mkWorker("w-unatt", "tw-unatt", usage("unattested", { attestationReason: "reported usage carries no signature" })),
      mkWorker("w-absent", "tw-absent", usage("absent", { attestationReason: "agent reported no usage" }))
    ],
    nodes: [],
    candidates: [],
    feedback: [],
    multiAgent: { schemaVersion: 1, runs: [], roles: [], groups: [], memberships: [], fanouts: [], fanins: [] }
  };
}
function mkWorker(id, taskId, u) {
  return {
    id,
    status: "completed",
    taskId,
    createdAt: "2026-06-10T10:02:00.000Z",
    updatedAt: "2026-06-10T10:04:00.000Z",
    backendId: "agent",
    feedbackIds: [],
    errors: [],
    output: { workerId: id, taskId, resultPath: "x", recordedAt: "2026-06-10T10:04:00.000Z" },
    usage: u
  };
}

function main() {
  const runDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-metrics-cov-smoke-")));
  cleanups.push(runDir);
  const run = fixtureRun(runDir);

  // 1+2. bucket counts + verifiedCoverage, distinct from usage.coverage
  const cov = obs.deriveAttestationCoverage(run);
  assert.equal(cov.units, 6, "units = workers(4) + standalone completed tasks(2)");
  assert.equal(cov.attested, 2, "two attested");
  assert.equal(cov.unattested, 1, "one unattested");
  assert.equal(cov.absent, 1, "one absent");
  assert.equal(cov.unverified, 1, "one operator-recorded usage with no verdict");
  assert.ok(Math.abs(cov.verifiedCoverage - 2 / 6) < 1e-6, "verifiedCoverage = attested/units");

  const { totals } = obs.deriveUsageTotals(run);
  // usage.coverage counts units WITH a usage record (5/6); attestation.verifiedCoverage
  // counts cryptographically-attested (2/6) — a strictly different axis.
  assert.equal(totals.attestedUnits, 5, "5 units carry a usage record");
  assert.ok(cov.verifiedCoverage < totals.coverage, "verified coverage is the stricter axis");

  // 3. ledger sub-block: absent → present (records) → tampered
  assert.deepEqual(cov.ledger, { present: false, verified: true, records: 0 }, "no ledger ⇒ present:false, vacuously verified");
  ledger.appendTelemetryAttestation(run, { workerId: "w-att1", taskId: "tw-att1", promptDigest: "sha256:p", reportedUsage: { input_tokens: 4 }, usageSignature: "s", attestation: "attested", now: "2026-06-10T10:05:00.000Z" });
  ledger.appendTelemetryAttestation(run, { workerId: "w-unatt", taskId: "tw-unatt", promptDigest: "sha256:q", attestation: "unattested", attestationReason: "no signature", now: "2026-06-10T10:06:00.000Z" });
  let cov2 = obs.deriveAttestationCoverage(run);
  assert.deepEqual(cov2.ledger, { present: true, verified: true, records: 2 }, "ledger present + chain verified");

  const lfile = ledger.telemetryLedgerPath(run);
  const raw = JSON.parse(fs.readFileSync(lfile, "utf8"));
  raw.records[0].attestation = "unattested"; // tamper a recorded verdict (no recompute)
  fs.writeFileSync(lfile, JSON.stringify(raw), "utf8");
  cov2 = obs.deriveAttestationCoverage(run);
  assert.equal(cov2.ledger.verified, false, "tampered ledger ⇒ verified:false in metrics");

  // 4. deriveMetricsReport wires the block; deterministic across two `now`.
  const r1 = obs.deriveMetricsReport(run, { now: FIXED_NOW });
  assert.deepEqual(r1.attestation, obs.deriveAttestationCoverage(run), "report.attestation === deriveAttestationCoverage");
  const r2 = obs.deriveMetricsReport(run, { now: "2030-01-01T00:00:00.000Z" });
  assert.deepEqual(r1.attestation, r2.attestation, "attestation block is byte-stable across injected now (parity-safe)");

  for (const dir of cleanups) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  console.log("telemetry-metrics-coverage-smoke: ok (bucketed coverage, stricter-than-usage axis, ledger present/tamper, deterministic wiring)");
}

main();
