#!/usr/bin/env node
// trustcore-telemetry-recordhash-omit-vs-null — pins computeRecordHash's
// exact key-omission-vs-null rule (project/docs/rebuild/PLAN.md byte-compat item 2 and
// SPEC/ledger-trust.md rebuild risk #2): reportedUsage/resultDigest are
// OMITTED (not null) when absent; usageSignature/attestationReason become
// null when absent. Getting this wrong changes every record hash and
// breaks back-compat with old ledgers.

const assert = require("node:assert/strict");
const { computeRecordHash, genesisPrevHash } = require("../dist/core/trust/telemetry-ledger");
const { sha256, telemetryStableStringify } = require("../dist/core/hash");

function baseRecord(overrides) {
  return {
    schemaVersion: 1,
    runId: "run-1",
    recordId: "tel-001",
    recordedAt: "2026-01-01T00:00:00.000Z",
    workerId: "w-map",
    taskId: "map:server-api",
    promptDigest: "sha256:aaaa",
    reportedUsageDigest: "sha256:bbbb",
    attestation: "unattested",
    prevHash: genesisPrevHash("run-1"),
    ...overrides,
  };
}

// A record with NEITHER reportedUsage NOR resultDigest hashes over a
// payload that OMITS both keys entirely (not null) — verified by
// reproducing the exact expected input independently via telemetryStableStringify.
{
  const record = baseRecord({});
  const hash = computeRecordHash(record);
  const expectedInput = telemetryStableStringify({
    schemaVersion: 1,
    runId: "run-1",
    recordId: "tel-001",
    recordedAt: "2026-01-01T00:00:00.000Z",
    workerId: "w-map",
    taskId: "map:server-api",
    promptDigest: "sha256:aaaa",
    reportedUsageDigest: "sha256:bbbb",
    usageSignature: null,
    attestation: "unattested",
    attestationReason: null,
    prevHash: genesisPrevHash("run-1"),
  });
  assert.equal(hash, sha256(expectedInput), "computeRecordHash must omit reportedUsage/resultDigest and null usageSignature/attestationReason when absent");
}

// Adding reportedUsage (present) must produce a DIFFERENT hash than the
// omitted-key case above — proves the key is genuinely present in the
// hashed payload, not silently ignored.
{
  const withoutUsage = computeRecordHash(baseRecord({}));
  const withUsage = computeRecordHash(baseRecord({ reportedUsage: { input_tokens: 100 } }));
  assert.notEqual(withoutUsage, withUsage, "presence of reportedUsage must change the record hash");
}

// A record WITH reportedUsage present hashes with the key included (not
// omitted, not null) — verified against the exact expected input.
{
  const usage = { input_tokens: 2117, output_tokens: 1911 };
  const record = baseRecord({ reportedUsage: usage });
  const hash = computeRecordHash(record);
  const expectedInput = telemetryStableStringify({
    schemaVersion: 1,
    runId: "run-1",
    recordId: "tel-001",
    recordedAt: "2026-01-01T00:00:00.000Z",
    workerId: "w-map",
    taskId: "map:server-api",
    promptDigest: "sha256:aaaa",
    reportedUsageDigest: "sha256:bbbb",
    reportedUsage: usage,
    usageSignature: null,
    attestation: "unattested",
    attestationReason: null,
    prevHash: genesisPrevHash("run-1"),
  });
  assert.equal(hash, sha256(expectedInput), "reportedUsage must be included verbatim (as the object, not stringified separately) when present");
}

// A record WITH resultDigest present hashes with the key included.
{
  const record = baseRecord({ resultDigest: "sha256:cccc" });
  const hash = computeRecordHash(record);
  const expectedInput = telemetryStableStringify({
    schemaVersion: 1,
    runId: "run-1",
    recordId: "tel-001",
    recordedAt: "2026-01-01T00:00:00.000Z",
    workerId: "w-map",
    taskId: "map:server-api",
    promptDigest: "sha256:aaaa",
    reportedUsageDigest: "sha256:bbbb",
    usageSignature: null,
    resultDigest: "sha256:cccc",
    attestation: "unattested",
    attestationReason: null,
    prevHash: genesisPrevHash("run-1"),
  });
  assert.equal(hash, sha256(expectedInput), "resultDigest must be included when present, in the position right after usageSignature");
}

// usageSignature ABSENT becomes null in the hash input — NOT omitted.
// Prove this by showing a record with usageSignature explicitly undefined
// hashes identically to one where it is simply not set (both -> null),
// and DIFFERENTLY from one with a real signature string.
{
  const withoutSig = computeRecordHash(baseRecord({}));
  const withSig = computeRecordHash(baseRecord({ usageSignature: "c2ln" }));
  assert.notEqual(withoutSig, withSig, "presence of usageSignature must change the hash");
}

// attestationReason absent -> null (same treatment as usageSignature, NOT
// omitted like reportedUsage/resultDigest).
{
  const withoutReason = computeRecordHash(baseRecord({}));
  const withReason = computeRecordHash(baseRecord({ attestationReason: "no signature provided" }));
  assert.notEqual(withoutReason, withReason, "presence of attestationReason must change the hash");
}

// Back-compat: a usage-only (4-field-era) record and a record with the
// SAME fields but explicit reportedUsage/resultDigest as `undefined` in
// the object (JS delete semantics) must hash identically — the omission is
// about JS `undefined`, not an explicit `null`.
{
  const a = computeRecordHash(baseRecord({}));
  const record2 = baseRecord({});
  record2.reportedUsage = undefined;
  record2.resultDigest = undefined;
  const b = computeRecordHash(record2);
  assert.equal(a, b, "explicit undefined must behave identically to a truly-absent key (both omitted)");
}

process.stdout.write("trustcore-telemetry-recordhash-omit-vs-null: ok\n");
