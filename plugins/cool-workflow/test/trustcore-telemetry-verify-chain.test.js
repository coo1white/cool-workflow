#!/usr/bin/env node
// trustcore-telemetry-verify-chain — pins verifyTelemetryLedgerRecords: chain
// linkage + independent per-record hash recompute (SPEC/ledger-trust.md
// "Telemetry ledger record" verify section, invariant 3 "absent vs corrupt",
// invariant 4 "verify never trusts a stored hash").

const assert = require("node:assert/strict");
const {
  genesisPrevHash,
  computeRecordHash,
  recordId,
  verifyTelemetryLedgerRecords,
  corruptTelemetryLedgerVerification,
} = require("../dist/core/trust/telemetry-ledger");

const RUN_ID = "run-verify";

function buildChain(hops) {
  const records = [];
  let prevHash = genesisPrevHash(RUN_ID);
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const partial = {
      schemaVersion: 1,
      runId: RUN_ID,
      recordId: recordId(i + 1),
      recordedAt: "2026-01-01T00:00:00.000Z",
      workerId: hop.workerId,
      taskId: hop.taskId,
      promptDigest: "sha256:" + "a".repeat(64),
      reportedUsageDigest: "sha256:" + "b".repeat(64),
      attestation: hop.attestation,
      prevHash,
    };
    const recordHash = computeRecordHash(partial);
    const record = { ...partial, recordHash };
    records.push(record);
    prevHash = recordHash;
  }
  return records;
}

// An empty ledger verifies as present:false, verified:true, zero checks —
// nothing to prove is a clean pass, not a failure.
{
  const result = verifyTelemetryLedgerRecords(RUN_ID, []);
  assert.equal(result.present, false);
  assert.equal(result.verified, true);
  assert.deepEqual(result.checks, []);
  assert.equal(result.attested, 0);
  assert.equal(result.unattested, 0);
  assert.equal(result.absent, 0);
}

// A clean, untampered 3-record chain verifies present:true, verified:true,
// with both chain-link and record-hash checks all passing.
{
  const records = buildChain([
    { workerId: "w-map", taskId: "map:server-api", attestation: "attested" },
    { workerId: "w-assess", taskId: "assess:security", attestation: "unattested" },
    { workerId: "w-verdict", taskId: "verdict:synthesis", attestation: "attested" },
  ]);
  const result = verifyTelemetryLedgerRecords(RUN_ID, records);
  assert.equal(result.present, true);
  assert.equal(result.verified, true);
  assert.equal(result.attested, 2);
  assert.equal(result.unattested, 1);
  assert.equal(result.absent, 0);
  assert.ok(result.checks.every((c) => c.pass), "every check must pass on a clean chain");
  // 3 chain-link checks + 3 record-hash checks.
  assert.equal(result.checks.filter((c) => c.name.startsWith("chain-link")).length, 3);
  assert.equal(result.checks.filter((c) => c.name.startsWith("record-hash")).length, 3);
}

// The first record's prevHash must equal genesisPrevHash(runId) exactly —
// verified structurally via chain-link[0].
{
  const records = buildChain([{ workerId: "w1", taskId: "t1", attestation: "attested" }]);
  assert.equal(records[0].prevHash, genesisPrevHash(RUN_ID));
  const result = verifyTelemetryLedgerRecords(RUN_ID, records);
  const link0 = result.checks.find((c) => c.name === "chain-link[0]");
  assert.equal(link0.pass, true);
}

// Tamper case: flip attestation and re-seal that record's OWN recordHash
// (the "attacker re-seals the local hash" case from the demo-tamper SPEC
// text). The per-record digest check for the tampered record itself
// passes (it was re-sealed), but the chain check FAILS at the NEXT record
// because it was linked to the OLD hash.
{
  const records = buildChain([
    { workerId: "w-map", taskId: "map:server-api", attestation: "attested" },
    { workerId: "w-assess", taskId: "assess:security", attestation: "unattested" },
    { workerId: "w-verdict", taskId: "verdict:synthesis", attestation: "attested" },
  ]);
  // Forge record[1]: unattested -> attested, recompute ITS OWN recordHash
  // (attacker re-seals locally) but do NOT touch record[2]'s prevHash.
  const { recordHash: _drop, ...rest } = records[1];
  const forgedPartial = { ...rest, attestation: "attested" };
  records[1] = { ...forgedPartial, recordHash: computeRecordHash(forgedPartial) };

  const result = verifyTelemetryLedgerRecords(RUN_ID, records);
  assert.equal(result.verified, false, "the re-sealed forgery must still be caught overall");
  const link1 = result.checks.find((c) => c.name === "chain-link[1]");
  const digest1 = result.checks.find((c) => c.name === "record-hash[1]");
  const link2 = result.checks.find((c) => c.name === "chain-link[2]");
  assert.equal(digest1.pass, true, "the forged record's own recomputed digest matches (attacker re-sealed it)");
  assert.equal(link1.pass, true, "record[1]'s own prevHash link to record[0] is untouched, still passes");
  assert.equal(link2.pass, false, "record[2] was linked to the OLD hash, so chain-link[2] must fail");
  assert.equal(link2.code, "telemetry-chain-broken");
}

// Tamper case: mutate a field WITHOUT recomputing recordHash — the
// record-hash check for that exact record must fail (digest integrity,
// never trusts the stored hash).
{
  const records = buildChain([
    { workerId: "w1", taskId: "t1", attestation: "attested" },
    { workerId: "w2", taskId: "t2", attestation: "attested" },
  ]);
  records[0].workerId = "w-tampered"; // recordHash NOT recomputed
  const result = verifyTelemetryLedgerRecords(RUN_ID, records);
  assert.equal(result.verified, false);
  const digest0 = result.checks.find((c) => c.name === "record-hash[0]");
  assert.equal(digest0.pass, false);
  assert.equal(digest0.code, "telemetry-digest-mismatch");
}

// Attestation tally counts every distinct status, including "absent".
{
  const records = buildChain([
    { workerId: "w1", taskId: "t1", attestation: "attested" },
    { workerId: "w2", taskId: "t2", attestation: "absent" },
  ]);
  const result = verifyTelemetryLedgerRecords(RUN_ID, records);
  assert.equal(result.attested, 1);
  assert.equal(result.absent, 1);
  assert.equal(result.unattested, 0);
}

// corruptTelemetryLedgerVerification: the fixed shared shape for a present
// but unparseable ledger (present:true, verified:false, one failed
// ledger-load/telemetry-ledger-corrupt check) — the split from "absent"
// (present:false) must be exact.
{
  const result = corruptTelemetryLedgerVerification();
  assert.equal(result.present, true, "corrupt must be present:true, NOT the same as absent");
  assert.equal(result.verified, false);
  assert.deepEqual(result.records, []);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].name, "ledger-load");
  assert.equal(result.checks[0].pass, false);
  assert.equal(result.checks[0].code, "telemetry-ledger-corrupt");
  assert.equal(result.attested, 0);
  assert.equal(result.unattested, 0);
  assert.equal(result.absent, 0);
}

// corrupt and empty/absent must be DISTINGUISHABLE by present flag even
// though both eventually reach "records:[]" — this is invariant 3's "hard
// split", the single most historically-buggy edge in this subsystem.
{
  const absent = verifyTelemetryLedgerRecords(RUN_ID, []);
  const corrupt = corruptTelemetryLedgerVerification();
  assert.notEqual(absent.present, corrupt.present, "absent (present:false) and corrupt (present:true) must never collapse to the same present flag");
}

process.stdout.write("trustcore-telemetry-verify-chain: ok\n");
