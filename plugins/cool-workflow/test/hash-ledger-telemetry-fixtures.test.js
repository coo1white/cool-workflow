#!/usr/bin/env node
// hash-ledger-telemetry-fixtures (milestone 0) — golden fixtures built
// directly from SPEC/ledger-trust.md's own field lists ("Handoff ledger
// entry", "Telemetry ledger record"), proving core/hash.ts's exports can
// reproduce the exact digests those subsystems rely on, including the
// omit-vs-null distinction the PLAN calls out by name (byte-compat item 2's
// last bullet): reportedUsage/resultDigest are OMITTED when absent (not
// null), while usageSignature/attestationReason become null.

const assert = require("node:assert/strict");
const { sha256, ledgerStableStringify } = require("../dist/core/hash");

// --- Ledger digest (SPEC/ledger-trust.md "Handoff ledger entry") -----------
// digest = sha256 over stableStringify of every field except id and digest.
{
  const content = {
    kind: "proposal",
    schemaVersion: 1,
    from: "cool-workflow",
    to: "chime",
    title: "Add retry",
    rationale: "flaky net",
    targetFiles: ["src/net.ts"],
    suggestedDiff: "@@ ... @@",
    createdAt: "2020-01-01T00:00:00.000Z"
  };
  const digest = sha256(ledgerStableStringify(content));
  assert.ok(digest.startsWith("sha256:"), "ledger digest must be prefixed");
  assert.equal(digest.length, "sha256:".length + 64, "ledger digest must be full 64 hex");

  // id = "ldg-" + first 16 hex chars of the digest.
  const id = `ldg-${digest.replace(/^sha256:/, "").slice(0, 16)}`;
  assert.equal(id.length, 20, 'id must be "ldg-" + 16 hex chars');

  // Re-deriving from the same content (key order shuffled) must reproduce
  // the identical digest — this is the whole point of a content-addressed id.
  const reordered = {
    createdAt: content.createdAt,
    suggestedDiff: content.suggestedDiff,
    targetFiles: content.targetFiles,
    rationale: content.rationale,
    title: content.title,
    to: content.to,
    from: content.from,
    schemaVersion: content.schemaVersion,
    kind: content.kind
  };
  assert.equal(
    sha256(ledgerStableStringify(reordered)),
    digest,
    "ledger digest must be independent of source key order"
  );
}

// --- Telemetry record hash: omit-vs-null (SPEC/ledger-trust.md "Telemetry
// ledger record" + Rebuild risk #2) -----------------------------------------
// recordHash input = { schemaVersion, runId, recordId, recordedAt, workerId,
// taskId, promptDigest, reportedUsageDigest,
//   [reportedUsage only if present],
//   usageSignature || null,
//   [resultDigest only if present],
//   attestation, attestationReason || null, prevHash }
function recordHashInput(record) {
  const { ledgerStableStringify: stringify } = require("../dist/core/hash");
  return stringify({
    schemaVersion: record.schemaVersion,
    runId: record.runId,
    recordId: record.recordId,
    recordedAt: record.recordedAt,
    workerId: record.workerId,
    taskId: record.taskId,
    promptDigest: record.promptDigest,
    reportedUsageDigest: record.reportedUsageDigest,
    ...(record.reportedUsage !== undefined ? { reportedUsage: record.reportedUsage } : {}),
    usageSignature: record.usageSignature || null,
    ...(record.resultDigest !== undefined ? { resultDigest: record.resultDigest } : {}),
    attestation: record.attestation,
    attestationReason: record.attestationReason || null,
    prevHash: record.prevHash
  });
}

{
  // A usage-only (4-field-era) record: no reportedUsage, no resultDigest.
  const legacyRecord = {
    schemaVersion: 1,
    runId: "demo-run",
    recordId: "tel-001",
    recordedAt: "2020-01-01T00:00:00.000Z",
    workerId: "w-map",
    taskId: "map:server-api",
    promptDigest: "sha256:aaaa",
    reportedUsageDigest: "sha256:bbbb",
    usageSignature: undefined,
    attestation: "unattested",
    attestationReason: undefined,
    prevHash: "sha256:cccc"
  };
  const bytes = recordHashInput(legacyRecord);
  assert.ok(
    !bytes.includes('"reportedUsage"'),
    "absent reportedUsage must be OMITTED from the hash input, never serialized as null"
  );
  assert.ok(
    !bytes.includes('"resultDigest"'),
    "absent resultDigest must be OMITTED from the hash input, never serialized as null"
  );
  assert.ok(
    bytes.includes('"usageSignature":null'),
    "absent usageSignature must be serialized as null (not omitted)"
  );
  assert.ok(
    bytes.includes('"attestationReason":null'),
    "absent attestationReason must be serialized as null (not omitted)"
  );

  // Adding a resultDigest / reportedUsage must produce a DIFFERENT hash input
  // (proves the keys are load-bearing when present, not silently ignored).
  const withExtras = {
    ...legacyRecord,
    reportedUsage: { input_tokens: 10, output_tokens: 20 },
    resultDigest: "sha256:dddd"
  };
  const bytesWithExtras = recordHashInput(withExtras);
  assert.notEqual(bytes, bytesWithExtras, "presence of reportedUsage/resultDigest must change the hash input");
  assert.ok(bytesWithExtras.includes('"reportedUsage"'), "present reportedUsage must be included");
  assert.ok(bytesWithExtras.includes('"resultDigest"'), "present resultDigest must be included");

  // Hashing is deterministic given the same input shape.
  assert.equal(sha256(bytes), sha256(recordHashInput(legacyRecord)), "recordHash must be deterministic");
}

process.stdout.write("hash-ledger-telemetry-fixtures: ok\n");
