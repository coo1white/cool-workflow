#!/usr/bin/env node
// trustcore-telemetry-verify-signatures-resultbound — pins
// verifyTelemetrySignatures, with special focus on resultBound: it must
// include a record ONLY when the signature re-verified AND coversResult is
// true (first-arm/5-field match) — never on a 4-field fallback match, even
// when a resultDigest sits on the record (SPEC/ledger-trust.md
// "Attestation verify": "resultBound gets {taskId, resultDigest} ONLY when
// the signature re-verified AND coversResult is true — a 4-field signature
// never anchors a result digest, even if one is on the record").

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  verifyTelemetrySignatures,
  canonicalTelemetryPayload,
} = require("../dist/core/trust/telemetry-attestation");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });

function sign(payloadString) {
  return crypto.sign(null, Buffer.from(payloadString, "utf8"), privateKey).toString("base64");
}

function stableDigest(value) {
  // Mirrors the module's own private stableDigest (sha256 of
  // stableStringify) so records carry a genuinely-matching
  // reportedUsageDigest — required for the digest-mismatch gate not to
  // fire before we even reach the signature check.
  const { stableStringify } = require("../dist/core/trust/telemetry-attestation");
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

function record(overrides) {
  const usage = overrides.reportedUsage ?? { input_tokens: 1 };
  return {
    recordId: "tel-001",
    runId: "run-1",
    taskId: "task-1",
    promptDigest: "sha256:" + "a".repeat(64),
    reportedUsageDigest: stableDigest(usage),
    attestation: "attested",
    reportedUsage: usage,
    ...overrides,
  };
}

// No key provided: every attested record is "checked" but NOT re-verified —
// code signature-unchecked-no-key, pass:true (informational only).
{
  const rec = record({ usageSignature: "whatever" });
  const result = verifyTelemetrySignatures([rec], undefined);
  assert.equal(result.keyProvided, false);
  assert.equal(result.checked, 1);
  assert.equal(result.reverified, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.resultBound, []);
  assert.equal(result.checks[0].code, "signature-unchecked-no-key");
  assert.equal(result.checks[0].pass, true);
}

// Non-"attested" records are skipped entirely — not counted in checked.
{
  const rec = record({ attestation: "unattested" });
  const result = verifyTelemetrySignatures([rec], PUBLIC_PEM);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.checks, []);
}

// attested record with no reportedUsage stored -> telemetry-usage-unavailable, failed.
{
  const rec = record({});
  delete rec.reportedUsage;
  const result = verifyTelemetrySignatures([rec], PUBLIC_PEM);
  assert.equal(result.failed, 1);
  assert.equal(result.checks[0].code, "telemetry-usage-unavailable");
}

// Stored reportedUsageDigest does not match the stored reportedUsage ->
// telemetry-usage-digest-mismatch, failed.
{
  const rec = record({ reportedUsageDigest: "sha256:" + "0".repeat(64) });
  const result = verifyTelemetrySignatures([rec], PUBLIC_PEM);
  assert.equal(result.failed, 1);
  assert.equal(result.checks[0].code, "telemetry-usage-digest-mismatch");
}

// A record whose signature covers the result (5-field/first-arm match):
// reverified, and resultBound gets {taskId, resultDigest}.
{
  const usage = { input_tokens: 5 };
  const ctx = { runId: "run-1", taskId: "task-r", promptDigest: "sha256:" + "a".repeat(64), resultDigest: "sha256:" + "c".repeat(64) };
  const payload = canonicalTelemetryPayload(usage, ctx);
  const sig = sign(payload);
  const rec = record({ taskId: "task-r", reportedUsage: usage, reportedUsageDigest: stableDigest(usage), usageSignature: sig, resultDigest: ctx.resultDigest });
  const result = verifyTelemetrySignatures([rec], PUBLIC_PEM);
  assert.equal(result.reverified, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.resultBound, [{ taskId: "task-r", resultDigest: ctx.resultDigest }]);
}

// A record with a 4-field (usage-only) signature that ALSO happens to
// carry a resultDigest field (e.g. injected/attacker-added after the
// fact): the signature only verifies via the 4-field fallback arm, so
// coversResult must NOT be set, and resultBound must EXCLUDE it — this is
// the critical rebuild-risk case.
{
  const usage = { input_tokens: 7 };
  const signingCtx = { runId: "run-1", taskId: "task-inject", promptDigest: "sha256:" + "a".repeat(64) }; // no resultDigest at sign time
  const payload = canonicalTelemetryPayload(usage, signingCtx);
  const sig = sign(payload);
  const rec = record({
    taskId: "task-inject",
    reportedUsage: usage,
    reportedUsageDigest: stableDigest(usage),
    usageSignature: sig,
    resultDigest: "sha256:" + "d".repeat(64), // injected onto the record, NOT part of what was signed
  });
  const result = verifyTelemetrySignatures([rec], PUBLIC_PEM);
  assert.equal(result.reverified, 1, "the 4-field signature must still re-verify via the fallback arm");
  assert.equal(result.failed, 0);
  assert.deepEqual(result.resultBound, [], "an injected resultDigest riding a 4-field-only signature must NEVER appear in resultBound");
}

// A tampered signature (usage mutated after signing) -> failed, code
// telemetry-signature-mismatch, never added to resultBound.
{
  const usage = { input_tokens: 3 };
  const ctx = { runId: "run-1", taskId: "task-bad", promptDigest: "sha256:" + "a".repeat(64) };
  const payload = canonicalTelemetryPayload(usage, ctx);
  const sig = sign(payload);
  const tamperedUsage = { input_tokens: 30 };
  const rec = record({ taskId: "task-bad", reportedUsage: tamperedUsage, reportedUsageDigest: stableDigest(tamperedUsage), usageSignature: sig });
  const result = verifyTelemetrySignatures([rec], PUBLIC_PEM);
  assert.equal(result.failed, 1);
  assert.equal(result.checks[0].code, "telemetry-signature-mismatch");
  assert.deepEqual(result.resultBound, []);
}

// An unreadable public key surfaces as telemetry-pubkey-unreadable (pass
// through the "trust key unreadable" prefix check).
{
  const rec = record({ usageSignature: "irrelevant" });
  const result = verifyTelemetrySignatures([rec], "not a pem at all");
  assert.equal(result.failed, 1);
  assert.equal(result.checks[0].code, "telemetry-pubkey-unreadable");
}

// Mixed batch: tallies (checked/reverified/failed) must count independently
// per record, and resultBound must accumulate only the genuinely-bound ones.
{
  const usageA = { input_tokens: 1 };
  const ctxA = { runId: "run-1", taskId: "task-a", promptDigest: "sha256:" + "a".repeat(64), resultDigest: "sha256:" + "1".repeat(64) };
  const sigA = sign(canonicalTelemetryPayload(usageA, ctxA));
  const recA = record({ taskId: "task-a", reportedUsage: usageA, reportedUsageDigest: stableDigest(usageA), usageSignature: sigA, resultDigest: ctxA.resultDigest });

  const usageB = { input_tokens: 2 };
  const recB = record({ taskId: "task-b", reportedUsage: usageB, reportedUsageDigest: stableDigest(usageB), usageSignature: "garbage-sig" });

  const result = verifyTelemetrySignatures([recA, recB], PUBLIC_PEM);
  assert.equal(result.checked, 2);
  assert.equal(result.reverified, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.resultBound, [{ taskId: "task-a", resultDigest: ctxA.resultDigest }]);
}

process.stdout.write("trustcore-telemetry-verify-signatures-resultbound: ok\n");
