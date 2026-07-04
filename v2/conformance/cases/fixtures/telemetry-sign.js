"use strict";

// telemetry-sign — small black-box helpers a case uses to hand-build a
// forged, but internally-consistent-where-it-should-be, telemetry ledger
// record and re-seal it into a real exported bundle. Mirrors EXACTLY the
// documented canonical forms from ledger-trust.md so a forged record is
// indistinguishable from a genuine one except in the one dimension under
// test (e.g. "signature covers a 4-field payload but a resultDigest was
// injected onto the record afterward").
//
// This is case-side machinery, not the code under test: cases still only
// ever exercise CW through `run(...)` on the CLI; this file just builds the
// INPUT bytes (a tampered/hand-signed telemetry.json, embedded in a bundle
// exported by the real `cw report bundle`).

const crypto = require("node:crypto");

function sha256(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return "sha256:" + crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function sha256Bytes(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// stableStringify — recursively key-sorted JSON, matching
// src/telemetry-attestation.ts's canonical form (a top-level undefined maps
// to the string "null").
function stableStringify(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

// recordHashInput — the exact field set + omit-don't-null rule from
// src/telemetry-ledger.ts: reportedUsage/resultDigest are OMITTED when
// absent; usageSignature/attestationReason fall back to null.
function recordHashInput(rec) {
  const o = {
    schemaVersion: rec.schemaVersion,
    runId: rec.runId,
    recordId: rec.recordId,
    recordedAt: rec.recordedAt,
    workerId: rec.workerId,
    taskId: rec.taskId,
    promptDigest: rec.promptDigest,
    reportedUsageDigest: rec.reportedUsageDigest,
  };
  if (rec.reportedUsage !== undefined) o.reportedUsage = rec.reportedUsage;
  o.usageSignature = rec.usageSignature === undefined ? null : rec.usageSignature;
  if (rec.resultDigest !== undefined) o.resultDigest = rec.resultDigest;
  o.attestation = rec.attestation;
  o.attestationReason = rec.attestationReason === undefined ? null : rec.attestationReason;
  o.prevHash = rec.prevHash;
  return o;
}

function computeRecordHash(rec) {
  return sha256(stableStringify(recordHashInput(rec)));
}

// generateTrustKeypair — a fresh ephemeral ed25519 keypair, PEM-encoded, the
// same discipline `cw demo tamper` uses (hermetic, never leaves the case).
function generateTrustKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey,
  };
}

// signUsagePayload — sign the canonical payload EXACTLY as
// canonicalTelemetryPayload does: stableStringify({usage, runId, taskId,
// promptDigest, [resultDigest if given]}), raw ed25519 (crypto.sign(null,...)).
function signUsagePayload(privateKey, { usage, runId, taskId, promptDigest, resultDigest }) {
  const payload =
    resultDigest !== undefined
      ? { usage, runId, taskId, promptDigest, resultDigest }
      : { usage, runId, taskId, promptDigest };
  const canonical = stableStringify(payload);
  return crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
}

// digestManifest — same manifest shape/order as src/run-export.ts's
// digestManifest, over the archive's `files` array.
function digestManifest(files) {
  const manifest = files
    .map((f) => ({ relativePath: f.relativePath, role: f.role, sha256: f.sha256, sizeBytes: f.sizeBytes }))
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return sha256Bytes(Buffer.from(JSON.stringify(manifest), "utf8"));
}

// replaceTelemetryRecord — mutate one record in-place inside a REAL exported
// bundle's embedded telemetry.json file entry, re-link every record after it
// (prevHash + recordHash), and reseal the archive's file entry + top-level
// manifest digest so `report verify-bundle` sees byte-consistent archive
// integrity (the only thing under test is the ONE record's forged content,
// never the archive integrity machinery itself, which real other cases pin).
function replaceTelemetryRecord(bundle, taskId, mutate) {
  const telemetryFile = bundle.files.find((f) => f.relativePath === "telemetry.json");
  const telemetry = JSON.parse(Buffer.from(telemetryFile.contentBase64, "base64").toString("utf8"));
  const idx = telemetry.records.findIndex((r) => r.taskId === taskId);
  if (idx < 0) throw new Error(`telemetry-sign: no record found for taskId ${taskId}`);

  const original = telemetry.records[idx];
  const mutated = mutate(original);
  delete mutated.recordHash;
  mutated.recordHash = computeRecordHash(mutated);
  telemetry.records[idx] = mutated;

  for (let i = idx + 1; i < telemetry.records.length; i++) {
    const relinked = Object.assign({}, telemetry.records[i], { prevHash: telemetry.records[i - 1].recordHash });
    delete relinked.recordHash;
    relinked.recordHash = computeRecordHash(relinked);
    telemetry.records[i] = relinked;
  }

  const newBytes = Buffer.from(JSON.stringify(telemetry), "utf8");
  telemetryFile.contentBase64 = newBytes.toString("base64");
  telemetryFile.sha256 = sha256Bytes(newBytes);
  telemetryFile.sizeBytes = newBytes.length;

  bundle.integrity.manifestSha256 = digestManifest(bundle.files);
  bundle.integrity.fileCount = bundle.files.length;

  return original;
}

function resultFileContent(bundle, taskId) {
  const resultFile = bundle.files.find((f) => f.relativePath === `results/${taskId}.md`);
  if (!resultFile) throw new Error(`telemetry-sign: no results/${taskId}.md in bundle`);
  return Buffer.from(resultFile.contentBase64, "base64").toString("utf8");
}

module.exports = {
  sha256,
  sha256Bytes,
  stableStringify,
  computeRecordHash,
  generateTrustKeypair,
  signUsagePayload,
  digestManifest,
  replaceTelemetryRecord,
  resultFileContent,
};
