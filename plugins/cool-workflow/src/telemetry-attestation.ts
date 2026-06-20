// Telemetry attestation (Track 1) — make "auditable" a FACT, not a claim.
//
// The agent self-reports its token usage on stdout (parseAgentReport). A control
// plane that records that number verbatim is recording a CLAIM: a tampered or
// fabricated usage survives untouched. This module is the verify gate that turns
// the claim into an attestation:
//
//   - The EXECUTOR signs a canonical payload binding {usage, runId, taskId,
//     promptDigest} with its private key (ed25519). The binding context is what
//     stops one task's signature being replayed onto another.
//   - CW VERIFIES that signature against an operator-provisioned PUBLIC key.
//     CW holds ONLY the public key — it can verify, but can neither forge a
//     signature nor (the red line) call a model to measure usage itself. A
//     third-party auditor with the same public key can re-verify independently.
//
// HONEST CEILING [load-bearing]: a signature proves the usage came from the
// keyholder and was not tampered in transit — NON-REPUDIABLE ATTRIBUTION, not
// ground-truth measurement. A dishonest keyholder can still sign a lie, but the
// lie is now cryptographically bound to its signer. That is strictly stronger
// than self-signed sha256 (which any party can recompute) and is the most a
// delegating control-plane can claim without measuring (which it must not).
//
// Default is honest: no signature ⇒ `unattested`, no usage ⇒ `absent`. Usage is
// NEVER silently recorded as trusted.

import crypto from "node:crypto";
import type { TelemetryAttestationStatus } from "./types";

export interface TelemetryAttestationContext {
  runId: string;
  taskId: string;
  /** sha256 of the worker prompt CW handed the agent — binds the signature to
   *  THIS hop so it cannot be replayed onto a different task/run. */
  promptDigest: string;
  /** sha256 of the agent's result.md. Optional, and included in the canonical
   *  payload ONLY when present, so a signer/bundle that predates result coverage
   *  (a 4-field signature) still verifies. When the executor signs it, editing
   *  the result — the findings — is detected, not just the usage. */
  resultDigest?: string;
}

export interface TelemetryVerification {
  status: TelemetryAttestationStatus;
  /** Why a result is `unattested`/`absent` — surfaced loudly, never swallowed. */
  reason?: string;
  algorithm?: "ed25519";
  /** True when the verified signature covered the result digest (the findings),
   *  not just the usage — i.e. the result-bound arm matched. */
  coversResult?: boolean;
}

/** Deterministic, key-sorted JSON so signer and verifier hash byte-identical
 *  input regardless of object key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

/** The exact bytes the executor signs and CW verifies. */
export function canonicalTelemetryPayload(
  usage: Record<string, unknown> | undefined,
  ctx: TelemetryAttestationContext
): string {
  return stableStringify({
    usage: usage ?? null,
    runId: ctx.runId,
    taskId: ctx.taskId,
    promptDigest: ctx.promptDigest,
    // Present ONLY when the signer covered the result. Omitting the key keeps the
    // canonical bytes byte-identical to the original 4-field payload, so every
    // pre-result-coverage signature still verifies (POLA / back-compat).
    ...(ctx.resultDigest !== undefined ? { resultDigest: ctx.resultDigest } : {})
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function numberAt(usage: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = usage[key];
    const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

/** Map the agent's free-form usage report onto UsageRecord token buckets, tolerating
 *  snake_case / camelCase variants (input_tokens vs inputTokens, etc.). CW never
 *  invents a number — an unreported bucket stays undefined, never zero. */
export function normalizeReportedUsage(
  usage: Record<string, unknown> | undefined
): { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number } {
  if (!usage) return {};
  return {
    inputTokens: numberAt(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"),
    outputTokens: numberAt(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens"),
    cacheReadTokens: numberAt(usage, "cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cache_read_input_tokens"),
    cacheWriteTokens: numberAt(usage, "cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cache_creation_input_tokens"),
    totalTokens: numberAt(usage, "totalTokens", "total_tokens")
  };
}

/** Verify the agent's signed usage against the operator-provisioned public key.
 *  Pure + deterministic (no clock, no env). Returns a status, never throws. */
export function verifyTelemetryAttestation(
  usage: Record<string, unknown> | undefined,
  signatureB64: string | undefined,
  trustPublicKeyPem: string | undefined,
  ctx: TelemetryAttestationContext
): TelemetryVerification {
  if (!usage || Object.keys(usage).length === 0) {
    return { status: "absent", reason: "agent reported no usage" };
  }
  if (!signatureB64) {
    return { status: "unattested", reason: "reported usage carries no signature" };
  }
  if (!trustPublicKeyPem) {
    return { status: "unattested", reason: "no trust key configured (set agent attestPublicKey / CW_AGENT_ATTEST_PUBKEY)" };
  }
  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey(trustPublicKeyPem);
  } catch (error) {
    return { status: "unattested", reason: `trust key unreadable: ${messageOf(error)}` };
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureB64, "base64");
    if (signature.length === 0) return { status: "unattested", reason: "signature is empty" };
  } catch {
    return { status: "unattested", reason: "signature is not valid base64" };
  }
  const matches = (c: TelemetryAttestationContext): boolean =>
    crypto.verify(null, Buffer.from(canonicalTelemetryPayload(usage, c), "utf8"), publicKey, signature);
  let ok = false;
  let coversResult = false;
  try {
    ok = matches(ctx);
    // A match on the first arm (which carries resultDigest when CW has one) means
    // the signature covered the result — the findings — not just the usage.
    coversResult = ok && ctx.resultDigest !== undefined;
    // Back-compat: a signer that predates result coverage signed only the 4-field
    // payload, so on a miss retry WITHOUT resultDigest. A NEW signer who covered
    // the result fails BOTH arms when the result is edited (its resultDigest no
    // longer matches), so result tampering is still caught.
    if (!ok && ctx.resultDigest !== undefined) ok = matches({ ...ctx, resultDigest: undefined });
  } catch (error) {
    return { status: "unattested", reason: `verification error: ${messageOf(error)}` };
  }
  return ok
    ? { status: "attested", algorithm: "ed25519", ...(coversResult ? { coversResult: true } : {}) }
    : { status: "unattested", reason: "signature does not match reported usage (tampered, replayed, or wrong key)" };
}

/** Resolve a trust key from a config value that is EITHER an inline PEM or a path
 *  to a `.pem` file. Returns undefined when absent/unreadable (⇒ `unattested`,
 *  never a hard throw). CW only ever loads a PUBLIC key here. */
export function resolveTrustPublicKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("BEGIN") && trimmed.includes("KEY")) return trimmed;
  try {
    // Lazy require so a bundle that never resolves a key path pays no fs cost.
    const fs = require("node:fs") as typeof import("node:fs");
    if (fs.existsSync(trimmed)) return fs.readFileSync(trimmed, "utf8");
  } catch {
    /* fall through to undefined */
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// EXECUTOR-SIDE HELPER — the CW RUNTIME NEVER CALLS THIS.
// Provided for signing wrappers around `claude -p`/endpoints and for tests. It
// touches a private key, never a model, so it does not cross the red line; it is
// kept here only so signer and verifier share one canonicalization.
// ---------------------------------------------------------------------------
export function signTelemetry(
  usage: Record<string, unknown> | undefined,
  privateKeyPem: string,
  ctx: TelemetryAttestationContext
): string {
  const payload = Buffer.from(canonicalTelemetryPayload(usage, ctx), "utf8");
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, payload, key).toString("base64");
}

// ---------------------------------------------------------------------------
// INDEPENDENT SIGNATURE RE-VERIFICATION (operator-side, opt-in)
// ---------------------------------------------------------------------------
// `verifyTelemetryLedger` re-proves the ledger's INTEGRITY (chain linkage + hash
// recompute), which confirms the record-time attestation verdicts were not edited.
// It does NOT re-run the ed25519 check — it trusts the stored `attestation` string
// (protected by the chain). This helper closes that gap when an operator supplies
// the trust public key: it RE-RUNS the crypto over each `attested` record, using the
// raw reported usage stored verbatim on the record (the signature signs the raw
// usage; it lives in the hash-chained ledger, so it is itself tamper-evident).
//
// Opt-in + fail-closed: with NO key every attested record is reported
// `signature-unchecked-no-key` (informational, never failed → default behavior is
// the unchanged chain-only re-proof). WITH a key, a record the ledger calls
// `attested` whose signature does not re-verify — OR which carries no raw usage to
// re-verify against (a pre-v0.1.80 / forged record) — FAILS, so a forged signature
// can no longer ride a green chain.

export interface TelemetrySignatureCheck {
  name: string;
  pass: boolean;
  code?: string;
}

export interface TelemetrySignatureVerification {
  /** Whether a trust public key was supplied (else every check is informational). */
  keyProvided: boolean;
  /** Records the ledger marks `attested` that we examined. */
  checked: number;
  /** Of those, how many re-verified against the key. */
  reverified: number;
  /** Of those, how many FAILED (signature mismatch or no re-verifiable usage). */
  failed: number;
  /** Records whose signature RE-VERIFIED and actually COVERED the result digest
   *  (a genuine 5-field result-bound signature). Their resultDigest is therefore
   *  signature-anchored — usable to bind the restored result file. A usage-only
   *  (4-field) signature is excluded even if a resultDigest is present on the
   *  record, so an injected digest cannot be trusted. */
  resultBound: Array<{ taskId: string; resultDigest: string }>;
  checks: TelemetrySignatureCheck[];
}

/** The minimal record shape this re-verifier needs (satisfied by
 *  TelemetryAttestationRecord). */
export interface ReverifiableRecord {
  recordId: string;
  runId: string;
  taskId: string;
  promptDigest: string;
  reportedUsageDigest?: string;
  usageSignature?: string;
  /** sha256 of the result the signature covered — needed to reconstruct the
   *  signed payload offline. Absent for usage-only (4-field) signatures. */
  resultDigest?: string;
  attestation: string;
  reportedUsage?: Record<string, unknown>;
}

function stableDigest(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function verifyTelemetrySignatures(
  records: ReverifiableRecord[],
  trustPublicKeyPem: string | undefined
): TelemetrySignatureVerification {
  const checks: TelemetrySignatureCheck[] = [];
  const resultBound: Array<{ taskId: string; resultDigest: string }> = [];
  let checked = 0;
  let reverified = 0;
  let failed = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.attestation !== "attested") continue;
    checked += 1;
    if (!trustPublicKeyPem) {
      checks.push({ name: `signature[${i}]`, pass: true, code: "signature-unchecked-no-key" });
      continue;
    }
    if (!record.reportedUsage) {
      // A claimed-`attested` record with no re-verifiable raw usage cannot be
      // independently checked — fail closed rather than trust the stored verdict.
      failed += 1;
      checks.push({ name: `signature[${i}]`, pass: false, code: "telemetry-usage-unavailable" });
      continue;
    }
    if (record.reportedUsageDigest !== stableDigest(record.reportedUsage)) {
      // The raw usage is stored so a public-key verifier can re-run ed25519.
      // The hash-chained record binds its digest; verify the two still match
      // before trusting the raw payload for signature re-verification.
      failed += 1;
      checks.push({ name: `signature[${i}]`, pass: false, code: "telemetry-usage-digest-mismatch" });
      continue;
    }
    const result = verifyTelemetryAttestation(record.reportedUsage, record.usageSignature, trustPublicKeyPem, {
      runId: record.runId,
      taskId: record.taskId,
      promptDigest: record.promptDigest,
      // Result-bound records carry the signed digest; verifyTelemetryAttestation
      // reconstructs the 5-field payload (and falls back to 4-field for old records).
      resultDigest: record.resultDigest
    });
    if (result.status === "attested") {
      reverified += 1;
      checks.push({ name: `signature[${i}]`, pass: true });
      // Only a signature that actually COVERED the result digest anchors it — a
      // 4-field fallback (coversResult false) must not let an injected resultDigest
      // be trusted downstream.
      if (result.coversResult && record.resultDigest) {
        resultBound.push({ taskId: record.taskId, resultDigest: record.resultDigest });
      }
    } else {
      failed += 1;
      checks.push({
        name: `signature[${i}]`,
        pass: false,
        code: result.reason && result.reason.startsWith("trust key unreadable")
          ? "telemetry-pubkey-unreadable"
          : "telemetry-signature-mismatch"
      });
    }
  }
  return { keyProvided: Boolean(trustPublicKeyPem), checked, reverified, failed, resultBound, checks };
}
