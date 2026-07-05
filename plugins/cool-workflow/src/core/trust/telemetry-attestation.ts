// core/trust/telemetry-attestation.ts — ed25519 usage/result attestation.
//
// MILESTONE 8. The AGENT (executor) signs; CW only VERIFIES with an
// operator-given PUBLIC key — CW holds no private key, ever. Uses
// node:crypto's built-in ed25519 sign/verify (no npm dependency).
//
// `crypto.verify`/`crypto.createPublicKey` are allowed here per
// v2/PLAN.md's lint carve-out for this exact file (Target shape,
// core/trust/telemetry-attestation.ts comment) — this remains otherwise
// pure (no fs, no process.env, no clock; `resolveTrustPublicKey`'s lazy
// `require("node:fs")` is the one exception, ported byte-identically
// from the old build's own lazy-require pattern so a bundle that never
// resolves a key path pays no fs cost).
//
// Evidence: SPEC/ledger-trust.md "The signing model", "Attestation
// verify", byte-compat items 2 and 11;
// plugins/cool-workflow/src/telemetry-attestation.ts:1-319.

import * as crypto from "node:crypto";

export type TelemetryAttestationStatus = "attested" | "unattested" | "absent";

export interface TelemetryAttestationContext {
  runId: string;
  taskId: string;
  /** sha256 of the worker prompt CW handed the agent. */
  promptDigest: string;
  /** sha256 of the agent's result.md. Included in the canonical payload
   *  ONLY when present, so a 4-field (pre-result-coverage) signer still
   *  verifies. */
  resultDigest?: string;
}

export interface TelemetryVerification {
  status: TelemetryAttestationStatus;
  reason?: string;
  algorithm?: "ed25519";
  /** True when the verified signature covered the result digest, not
   *  just the usage — i.e. the result-bound (first) arm matched. */
  coversResult?: boolean;
}

/** `src/telemetry-attestation.ts`'s `stableStringify` — sorts keys
 *  recursively, AND maps a top-level `undefined` input to the literal
 *  string `"null"`. Divergent from `core/hash.ts`'s
 *  `ledgerStableStringify` exactly at the top-level-undefined edge (see
 *  v2/PLAN.md byte-compat item 2). Re-exported under this file's own
 *  name (rather than importing `telemetryStableStringify` from
 *  core/hash.ts) because SPEC/ledger-trust.md's "Exported functions"
 *  list names `stableStringify` as a real export of THIS module — the
 *  two are byte-identical behavior, kept as separate named exports per
 *  their separate call sites. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return (JSON.stringify(value) as string | undefined) ?? "null";
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
    // Present ONLY when the signer covered the result — omitting the key
    // keeps the canonical bytes byte-identical to the original 4-field
    // payload, so every pre-result-coverage signature still verifies.
    ...(ctx.resultDigest !== undefined ? { resultDigest: ctx.resultDigest } : {}),
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

/** Map the agent's free-form usage report onto token buckets, tolerating
 *  snake_case / camelCase variants. CW never invents a number — an
 *  unreported bucket stays `undefined`, never 0. */
export function normalizeReportedUsage(
  usage: Record<string, unknown> | undefined
): { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number } {
  if (!usage) return {};
  return {
    inputTokens: numberAt(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"),
    outputTokens: numberAt(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens"),
    cacheReadTokens: numberAt(usage, "cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cache_read_input_tokens"),
    cacheWriteTokens: numberAt(usage, "cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cache_creation_input_tokens"),
    totalTokens: numberAt(usage, "totalTokens", "total_tokens"),
  };
}

/** Verify the agent's signed usage against the operator-provisioned
 *  public key. Two-arm check (v2/PLAN.md byte-compat item 11): try the
 *  5-field payload (with resultDigest) first; on a miss, retry the
 *  4-field payload (old signers still verify). `coversResult` is set
 *  ONLY on a first-arm match — a 4-field fallback match never covers the
 *  result, even when a resultDigest sits on the record. Never throws. */
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
    // A match on the first arm (which carries resultDigest when CW has
    // one) means the signature covered the result, not just the usage.
    coversResult = ok && ctx.resultDigest !== undefined;
    // Back-compat: a signer that predates result coverage signed only
    // the 4-field payload, so on a miss retry WITHOUT resultDigest. A NEW
    // signer who covered the result fails BOTH arms when the result is
    // edited (its resultDigest no longer matches).
    if (!ok && ctx.resultDigest !== undefined) ok = matches({ ...ctx, resultDigest: undefined });
  } catch (error) {
    return { status: "unattested", reason: `verification error: ${messageOf(error)}` };
  }
  return ok
    ? { status: "attested", algorithm: "ed25519", ...(coversResult ? { coversResult: true } : {}) }
    : { status: "unattested", reason: "signature does not match reported usage (tampered, replayed, or wrong key)" };
}

/** Resolve a trust key from a config value that is EITHER an inline PEM
 *  or a path to a `.pem` file. Returns undefined when absent/unreadable
 *  (⇒ `unattested`, never a hard throw). CW only ever loads a PUBLIC key
 *  here. */
export function resolveTrustPublicKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("BEGIN") && trimmed.includes("KEY")) return trimmed;
  try {
    // Lazy require so a bundle that never resolves a key path pays no
    // fs cost — byte-identical pattern to the old build's own lazy
    // require here.
    const fs = require("node:fs") as typeof import("node:fs");
    if (fs.existsSync(trimmed)) return fs.readFileSync(trimmed, "utf8");
  } catch {
    /* fall through to undefined */
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// EXECUTOR-SIDE HELPER — the CW RUNTIME NEVER CALLS THIS. Provided for
// signing wrappers and tests; touches a private key, never a model.
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

export interface TelemetrySignatureCheck {
  name: string;
  pass: boolean;
  code?: string;
}

export interface TelemetrySignatureVerification {
  keyProvided: boolean;
  checked: number;
  reverified: number;
  failed: number;
  /** Records whose signature RE-VERIFIED and actually COVERED the result
   *  digest. A usage-only (4-field) signature is excluded even if a
   *  resultDigest is present on the record, so an injected digest cannot
   *  be trusted. */
  resultBound: Array<{ taskId: string; resultDigest: string }>;
  checks: TelemetrySignatureCheck[];
}

export interface ReverifiableRecord {
  recordId: string;
  runId: string;
  taskId: string;
  promptDigest: string;
  reportedUsageDigest?: string;
  usageSignature?: string;
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
      failed += 1;
      checks.push({ name: `signature[${i}]`, pass: false, code: "telemetry-usage-unavailable" });
      continue;
    }
    if (record.reportedUsageDigest !== stableDigest(record.reportedUsage)) {
      failed += 1;
      checks.push({ name: `signature[${i}]`, pass: false, code: "telemetry-usage-digest-mismatch" });
      continue;
    }
    const result = verifyTelemetryAttestation(record.reportedUsage, record.usageSignature, trustPublicKeyPem, {
      runId: record.runId,
      taskId: record.taskId,
      promptDigest: record.promptDigest,
      resultDigest: record.resultDigest,
    });
    if (result.status === "attested") {
      reverified += 1;
      checks.push({ name: `signature[${i}]`, pass: true });
      if (result.coversResult && record.resultDigest) {
        resultBound.push({ taskId: record.taskId, resultDigest: record.resultDigest });
      }
    } else {
      failed += 1;
      checks.push({
        name: `signature[${i}]`,
        pass: false,
        code:
          result.reason && result.reason.startsWith("trust key unreadable")
            ? "telemetry-pubkey-unreadable"
            : "telemetry-signature-mismatch",
      });
    }
  }
  return { keyProvided: Boolean(trustPublicKeyPem), checked, reverified, failed, resultBound, checks };
}
