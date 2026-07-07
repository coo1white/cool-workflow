#!/usr/bin/env node
// trustcore-telemetry-attestation-signature-verify — pins the two-arm
// telemetry signature verify (v2/PLAN.md byte-compat item 11,
// SPEC/ledger-trust.md rebuild risk #3): try the 5-field payload (with
// resultDigest) first, retry the 4-field payload on a miss, and set
// coversResult ONLY on a first-arm match. Uses node:crypto's ed25519
// directly to build real signed/tampered payloads, matching how
// demo-tamper constructs its fixtures.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  verifyTelemetryAttestation,
  canonicalTelemetryPayload,
  signTelemetry,
} = require("../dist/core/trust/telemetry-attestation");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" });

const CTX_BASE = { runId: "demo-tamper-run", taskId: "map:server-api", promptDigest: "sha256:" + "a".repeat(64) };
const USAGE = { input_tokens: 2117, output_tokens: 1911 };

function sign(payloadString) {
  return crypto.sign(null, Buffer.from(payloadString, "utf8"), privateKey).toString("base64");
}

// --- absent/unattested short-circuits (never reach crypto at all) ---

// No usage at all -> absent, exact reason string.
{
  const result = verifyTelemetryAttestation(undefined, undefined, PUBLIC_PEM, CTX_BASE);
  assert.deepEqual(result, { status: "absent", reason: "agent reported no usage" });
}

// Empty usage object -> also absent (Object.keys length 0).
{
  const result = verifyTelemetryAttestation({}, "somesig", PUBLIC_PEM, CTX_BASE);
  assert.equal(result.status, "absent");
  assert.equal(result.reason, "agent reported no usage");
}

// Usage present, no signature -> unattested, exact reason.
{
  const result = verifyTelemetryAttestation(USAGE, undefined, PUBLIC_PEM, CTX_BASE);
  assert.deepEqual(result, { status: "unattested", reason: "reported usage carries no signature" });
}

// Usage + signature, no trust key configured -> unattested, exact reason.
{
  const result = verifyTelemetryAttestation(USAGE, "sig", undefined, CTX_BASE);
  assert.deepEqual(result, { status: "unattested", reason: "no trust key configured (set agent attestPublicKey / CW_AGENT_ATTEST_PUBKEY)" });
}

// Unreadable trust key -> unattested, reason names the parse error.
{
  const result = verifyTelemetryAttestation(USAGE, "sig", "not a real pem", CTX_BASE);
  assert.equal(result.status, "unattested");
  assert.ok(result.reason.startsWith("trust key unreadable:"), "reason must start with the exact prefix");
}

// Empty-string signature -> unattested. `!signatureB64` catches "" before
// the base64-decode step, so this actually resolves via the earlier
// "carries no signature" branch, not "signature is empty" (that reason is
// reachable only when signatureB64 is truthy but decodes to zero bytes,
// e.g. a signature made of only base64 padding/whitespace).
{
  const result = verifyTelemetryAttestation(USAGE, "", PUBLIC_PEM, CTX_BASE);
  assert.deepEqual(result, { status: "unattested", reason: "reported usage carries no signature" });
}

// A truthy signature string that base64-decodes to zero bytes DOES hit
// the "signature is empty" reason.
{
  const result = verifyTelemetryAttestation(USAGE, "====", PUBLIC_PEM, CTX_BASE);
  assert.deepEqual(result, { status: "unattested", reason: "signature is empty" });
}

// --- the two-arm real-crypto verify ---

// ARM 1 (5-field, WITH resultDigest): a valid signature over the 5-field
// payload verifies attested with coversResult:true.
{
  const ctx = { ...CTX_BASE, resultDigest: "sha256:" + "c".repeat(64) };
  const payload = canonicalTelemetryPayload(USAGE, ctx);
  const sig = sign(payload);
  const result = verifyTelemetryAttestation(USAGE, sig, PUBLIC_PEM, ctx);
  assert.equal(result.status, "attested");
  assert.equal(result.algorithm, "ed25519");
  assert.equal(result.coversResult, true, "a first-arm (5-field) match must set coversResult:true");
  assert.equal(result.reason, undefined, "an attested result must carry no reason");
}

// ARM 2 (4-field fallback): a signer that predates result coverage signs
// ONLY the 4-field payload (no resultDigest in ctx at signing time). CW
// still has a resultDigest to check (ctx carries one) — the 5-field arm
// misses, the 4-field retry matches, and coversResult must be FALSE (not
// true) even though a resultDigest sits on the record/ctx.
{
  const signingCtx = CTX_BASE; // no resultDigest — this IS the 4-field payload
  const payload = canonicalTelemetryPayload(USAGE, signingCtx);
  const sig = sign(payload);
  const verifyCtx = { ...CTX_BASE, resultDigest: "sha256:" + "d".repeat(64) }; // CW now has a resultDigest
  const result = verifyTelemetryAttestation(USAGE, sig, PUBLIC_PEM, verifyCtx);
  assert.equal(result.status, "attested", "an old 4-field signature must still verify via the fallback arm");
  assert.equal(result.coversResult, undefined, "a 4-field fallback match must NOT set coversResult (never true), even though verifyCtx carries a resultDigest");
}

// Genuinely old signer, and CW ALSO has no resultDigest (pure 4-field
// round trip, no fallback even needed) — must attest, coversResult unset.
{
  const payload = canonicalTelemetryPayload(USAGE, CTX_BASE);
  const sig = sign(payload);
  const result = verifyTelemetryAttestation(USAGE, sig, PUBLIC_PEM, CTX_BASE);
  assert.equal(result.status, "attested");
  assert.equal(result.coversResult, undefined);
}

// A NEW signer that covered the result, but the result was then edited
// (resultDigest changed) — must fail BOTH arms: the 5-field arm fails
// because resultDigest differs, and the 4-field retry ALSO fails because
// the signature was computed including resultDigest, so it does not match
// the 4-field payload's bytes either.
{
  const signedCtx = { ...CTX_BASE, resultDigest: "sha256:" + "e".repeat(64) };
  const payload = canonicalTelemetryPayload(USAGE, signedCtx);
  const sig = sign(payload);
  const editedCtx = { ...CTX_BASE, resultDigest: "sha256:" + "f".repeat(64) }; // finding edited after signing
  const result = verifyTelemetryAttestation(USAGE, sig, PUBLIC_PEM, editedCtx);
  assert.equal(result.status, "unattested");
  assert.equal(result.reason, "signature does not match reported usage (tampered, replayed, or wrong key)");
}

// Tampered usage (signature reused, usage field mutated) -> unattested,
// exact reason string — the "SIGNATURE layer" forge from demo-tamper.
{
  const payload = canonicalTelemetryPayload(USAGE, CTX_BASE);
  const sig = sign(payload);
  const tamperedUsage = { input_tokens: 2117, output_tokens: 19110 }; // x10 inflate
  const result = verifyTelemetryAttestation(tamperedUsage, sig, PUBLIC_PEM, CTX_BASE);
  assert.equal(result.status, "unattested");
  assert.equal(result.reason, "signature does not match reported usage (tampered, replayed, or wrong key)");
}

// Wrong key entirely (a second, unrelated keypair signs) -> unattested,
// same generic mismatch reason (verify does not distinguish "wrong key"
// from "tampered" in its reason text, by design).
{
  const other = crypto.generateKeyPairSync("ed25519");
  const payload = canonicalTelemetryPayload(USAGE, CTX_BASE);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), other.privateKey).toString("base64");
  const result = verifyTelemetryAttestation(USAGE, sig, PUBLIC_PEM, CTX_BASE);
  assert.equal(result.status, "unattested");
  assert.equal(result.reason, "signature does not match reported usage (tampered, replayed, or wrong key)");
}

// Non-base64 signature string -> unattested, exact reason (never throws).
{
  // Buffer.from(..., "base64") in Node does not throw on odd input — it
  // decodes leniently. Use a value that decodes to an empty buffer, which
  // legitimately hits the "signature is empty" path instead; assert no throw.
  assert.doesNotThrow(() => verifyTelemetryAttestation(USAGE, "@@@not-base64@@@", PUBLIC_PEM, CTX_BASE));
}

// signTelemetry (executor-side helper) round-trips with verify: sign with
// the private key, verify with the public key, matching demo-tamper's own
// signer usage pattern (used for signing wrappers/tests, never called by
// the CW runtime itself).
{
  const ctx = { ...CTX_BASE, resultDigest: "sha256:" + "9".repeat(64) };
  const sig = signTelemetry(USAGE, PRIVATE_PEM, ctx);
  const result = verifyTelemetryAttestation(USAGE, sig, PUBLIC_PEM, ctx);
  assert.equal(result.status, "attested");
  assert.equal(result.coversResult, true);
}

process.stdout.write("trustcore-telemetry-attestation-signature-verify: ok\n");
