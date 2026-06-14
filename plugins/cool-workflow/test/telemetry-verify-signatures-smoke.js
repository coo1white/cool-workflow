#!/usr/bin/env node
"use strict";

// telemetry-verify-signatures-smoke — `cw telemetry verify --pubkey` re-runs the
// ed25519 signature check, closing the gap a launch-claim audit proved: the verb
// re-proved only the hash chain and TRUSTED the stored `attested` verdict, so a
// record forged with a bogus signature rode a green chain undetected. Now, with
// the operator's public key, the verb RE-RUNS the crypto over each attested hop.
//
// Hermetic: ed25519 keypairs + the executor-side signTelemetry helper stand in for
// a signing agent. No live agent, no network, no model. Proves:
//   1. honest run, NO key  ⇒ verified (chain-only, backward compatible), the
//      attested record examined but not re-verified;
//   2. honest run, WITH key ⇒ the signature re-verifies (signaturesReverified);
//   3. FORGED signature (signs a lie, chain intact) — chain-only verify is GREEN
//      (the gap), but WITH the key it FAILS (telemetry-signature-mismatch);
//   4. WRONG key ⇒ an honest signature fails;
//   5. claimed-`attested` record with NO joinable raw usage ⇒ fails closed with a
//      key (telemetry-usage-unavailable) — a forged record cannot hide by omitting
//      its provenance;
//   6. raw usage tampering cannot bypass the digest/hash chain by making the raw
//      payload match the signature while leaving reportedUsageDigest stale;
//   7. explicit unreadable --pubkey fails closed instead of silently downgrading
//      to chain-only verification.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const ta = require(path.join(pluginRoot, "dist/telemetry-attestation.js"));
const ledger = require(path.join(pluginRoot, "dist/telemetry-ledger.js"));
const capCore = require(path.join(pluginRoot, "dist/capability-core.js"));

const cleanups = [];
function tmpRun(id) {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-tvs-smoke-")));
  cleanups.push(work);
  const run = { id, paths: { runDir: path.join(work, "run") } };
  fs.mkdirSync(run.paths.runDir, { recursive: true });
  return run;
}
function ed25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ type: "spki", format: "pem" }).toString(),
    priv: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}
// Append an `attested` ledger record. The raw usage is stored verbatim ON the
// record (in the hash-chained ledger), which is what `telemetry verify --pubkey`
// re-verifies. Pass usage: undefined to simulate a record with no re-verifiable
// usage (a pre-v0.1.80 / forged record).
function recordHop(run, { taskId, promptDigest, usage, signature }) {
  return ledger.appendTelemetryAttestation(run, {
    workerId: "w-" + taskId,
    taskId,
    promptDigest,
    reportedUsage: usage,
    usageSignature: signature,
    attestation: "attested"
  });
}
function verify(run, args) {
  return capCore.telemetryVerify({ loadRun: () => run }, { runId: run.id, ...args });
}

function main() {
  const key = ed25519();

  // 1+2. HONEST run: one correctly-signed attested hop.
  const honest = tmpRun("run-honest");
  const usage = { input_tokens: 120, output_tokens: 48 };
  const goodSig = ta.signTelemetry(usage, key.priv, { runId: honest.id, taskId: "map:a", promptDigest: "digest-a" });
  recordHop(honest, { taskId: "map:a", promptDigest: "digest-a", usage, signature: goodSig });

  const v0 = verify(honest, {});
  assert.equal(v0.verified, true, "honest ledger verifies chain-only (no key)");
  assert.equal(v0.signatureKeyProvided, false, "no key reported");
  assert.equal(v0.signaturesChecked, 1, "one attested record examined");
  assert.equal(v0.signaturesReverified, 0, "nothing re-verified without a key");
  assert.equal(v0.signaturesFailed, 0, "no failures without a key (informational only)");

  const v1 = verify(honest, { pubkey: key.pub });
  assert.equal(v1.verified, true, "honest signature re-verifies WITH the public key");
  assert.equal(v1.signatureKeyProvided, true, "key reported");
  assert.equal(v1.signaturesReverified, 1, "the attested hop re-verified against the key");
  assert.equal(v1.signaturesFailed, 0, "no failures on an honest ledger");

  // 3. FORGED signature: signs a LIE (different usage), stored as attested over the
  //    reported usage. Chain is intact (appended normally).
  const forged = tmpRun("run-forged");
  const realUsage = { input_tokens: 120, output_tokens: 48 };
  const sigOverLie = ta.signTelemetry({ input_tokens: 999999 }, key.priv, { runId: forged.id, taskId: "map:b", promptDigest: "digest-b" });
  recordHop(forged, { taskId: "map:b", promptDigest: "digest-b", usage: realUsage, signature: sigOverLie });

  const f0 = verify(forged, {});
  assert.equal(f0.verified, true, "DISPROOF: chain-only verify green-lights a forged signature");

  const f1 = verify(forged, { pubkey: key.pub });
  assert.equal(f1.verified, false, "forged signature is CAUGHT when re-verified with the public key");
  assert.equal(f1.signaturesFailed, 1, "exactly the forged hop failed");
  assert.ok(
    f1.failedChecks.some((c) => c.code === "telemetry-signature-mismatch"),
    "signature-mismatch code surfaced"
  );

  // 4. WRONG key: an honest signature does not verify against a different key.
  const otherKey = ed25519();
  const w1 = verify(honest, { pubkey: otherKey.pub });
  assert.equal(w1.verified, false, "honest signature does NOT verify against the wrong public key");
  assert.equal(w1.signaturesFailed, 1, "the hop failed against the wrong key");

  // 5. NO re-verifiable usage: claimed-attested record carrying no raw usage →
  //    cannot be re-verified → fail closed (a forged record cannot hide by omitting
  //    its raw usage; a pre-v0.1.80 record is honestly un-re-verifiable).
  const orphan = tmpRun("run-orphan");
  const oSig = ta.signTelemetry({ input_tokens: 5 }, key.priv, { runId: orphan.id, taskId: "map:c", promptDigest: "digest-c" });
  recordHop(orphan, { taskId: "map:c", promptDigest: "digest-c", usage: undefined, signature: oSig });

  const o0 = verify(orphan, {});
  assert.equal(o0.verified, true, "chain-only stays green without a key (no signature re-check)");
  const o1 = verify(orphan, { pubkey: key.pub });
  assert.equal(o1.verified, false, "claimed-attested record with no joinable raw usage fails closed with a key");
  assert.ok(
    o1.failedChecks.some((c) => c.code === "telemetry-usage-unavailable"),
    "usage-unavailable code surfaced"
  );

  // 6. RAW usage tamper: edit the stored raw payload so it matches a signature
  //    over a lie while leaving the original digest/hash behind. The verifier must
  //    fail closed; otherwise raw payload tampering could ride a green signature.
  const rawTampered = tmpRun("run-raw-tampered");
  const rawUsage = { input_tokens: 12 };
  const rawSig = ta.signTelemetry({ input_tokens: 999999 }, key.priv, { runId: rawTampered.id, taskId: "map:d", promptDigest: "digest-d" });
  recordHop(rawTampered, { taskId: "map:d", promptDigest: "digest-d", usage: rawUsage, signature: rawSig });
  const rawLedgerPath = ledger.telemetryLedgerPath(rawTampered);
  const rawLedger = JSON.parse(fs.readFileSync(rawLedgerPath, "utf8"));
  rawLedger.records[0].reportedUsage = { input_tokens: 999999 };
  fs.writeFileSync(rawLedgerPath, JSON.stringify(rawLedger, null, 2));
  const rt = verify(rawTampered, { pubkey: key.pub });
  assert.equal(rt.verified, false, "raw reportedUsage tampering fails closed");
  assert.ok(
    rt.failedChecks.some((c) => c.code === "telemetry-digest-mismatch" || c.code === "telemetry-usage-digest-mismatch"),
    "raw-usage tamper surfaced by hash or digest check"
  );

  // 7. Explicit bad key input is invalid input, not an implicit request for
  //    backward-compatible chain-only verification.
  const badKey = verify(honest, { pubkey: path.join(os.tmpdir(), "cw-missing-telemetry-key.pem") });
  assert.equal(badKey.verified, false, "explicit unreadable --pubkey fails closed");
  assert.ok(
    badKey.failedChecks.some((c) => c.code === "telemetry-pubkey-unreadable"),
    "unreadable-key code surfaced"
  );

  console.log(
    "telemetry-verify-signatures-smoke: ok (chain-only default; --pubkey re-verifies ed25519; forged sig / wrong key / un-joinable usage all fail closed)"
  );
}

try {
  main();
} finally {
  for (const dir of cleanups) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}
