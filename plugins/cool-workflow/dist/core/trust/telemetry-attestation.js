"use strict";
// core/trust/telemetry-attestation.ts — ed25519 usage/result attestation.
//
// MILESTONE 8. The AGENT (executor) signs; CW only VERIFIES with an
// operator-given PUBLIC key — CW holds no private key, ever. Uses
// node:crypto's built-in ed25519 sign/verify (no npm dependency).
//
// `crypto.verify`/`crypto.createPublicKey` are allowed here per
// PLAN.md (project/docs/rebuild)'s lint carve-out for this exact file (Target shape,
// core/trust/telemetry-attestation.ts comment) — this remains otherwise
// pure (no fs, no process.env, no clock; `resolveTrustPublicKey`'s lazy
// `require("node:fs")` is the one exception, ported byte-identically
// from the old build's own lazy-require pattern so a bundle that never
// resolves a key path pays no fs cost).
//
// Evidence: SPEC/ledger-trust.md "The signing model", "Attestation
// verify", byte-compat items 2 and 11.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableStringify = stableStringify;
exports.canonicalTelemetryPayload = canonicalTelemetryPayload;
exports.normalizeReportedUsage = normalizeReportedUsage;
exports.verifyTelemetryAttestation = verifyTelemetryAttestation;
exports.resolveTrustPublicKey = resolveTrustPublicKey;
exports.signTelemetry = signTelemetry;
exports.verifyTelemetrySignatures = verifyTelemetrySignatures;
const crypto = __importStar(require("node:crypto"));
/** `telemetry-attestation module`'s `stableStringify` — sorts keys
 *  recursively, AND maps a top-level `undefined` input to the literal
 *  string `"null"`. Divergent from `core/hash.ts`'s
 *  `ledgerStableStringify` exactly at the top-level-undefined edge (see
 *  PLAN.md (project/docs/rebuild) byte-compat item 2). Re-exported under this file's own
 *  name (rather than importing `telemetryStableStringify` from
 *  core/hash.ts) because SPEC/ledger-trust.md's "Exported functions"
 *  list names `stableStringify` as a real export of THIS module — the
 *  two are byte-identical behavior, kept as separate named exports per
 *  their separate call sites. */
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
}
/** The exact bytes the executor signs and CW verifies. */
function canonicalTelemetryPayload(usage, ctx) {
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
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function numberAt(usage, ...keys) {
    for (const key of keys) {
        const value = usage[key];
        const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (Number.isFinite(num))
            return num;
    }
    return undefined;
}
/** Map the agent's free-form usage report onto token buckets, tolerating
 *  snake_case / camelCase variants. CW never invents a number — an
 *  unreported bucket stays `undefined`, never 0. */
function normalizeReportedUsage(usage) {
    if (!usage)
        return {};
    return {
        inputTokens: numberAt(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"),
        outputTokens: numberAt(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens"),
        cacheReadTokens: numberAt(usage, "cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cache_read_input_tokens"),
        cacheWriteTokens: numberAt(usage, "cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cache_creation_input_tokens"),
        totalTokens: numberAt(usage, "totalTokens", "total_tokens"),
    };
}
/** Verify the agent's signed usage against the operator-provisioned
 *  public key. Two-arm check (PLAN.md (project/docs/rebuild) byte-compat item 11): try the
 *  5-field payload (with resultDigest) first; on a miss, retry the
 *  4-field payload (old signers still verify). `coversResult` is set
 *  ONLY on a first-arm match — a 4-field fallback match never covers the
 *  result, even when a resultDigest sits on the record. Never throws. */
function verifyTelemetryAttestation(usage, signatureB64, trustPublicKeyPem, ctx) {
    if (!usage || Object.keys(usage).length === 0) {
        return { status: "absent", reason: "agent reported no usage" };
    }
    if (!signatureB64) {
        return { status: "unattested", reason: "reported usage carries no signature" };
    }
    if (!trustPublicKeyPem) {
        return { status: "unattested", reason: "no trust key configured (set agent attestPublicKey / CW_AGENT_ATTEST_PUBKEY)" };
    }
    let publicKey;
    try {
        publicKey = crypto.createPublicKey(trustPublicKeyPem);
    }
    catch (error) {
        return { status: "unattested", reason: `trust key unreadable: ${messageOf(error)}` };
    }
    let signature;
    try {
        signature = Buffer.from(signatureB64, "base64");
        if (signature.length === 0)
            return { status: "unattested", reason: "signature is empty" };
    }
    catch {
        return { status: "unattested", reason: "signature is not valid base64" };
    }
    const matches = (c) => crypto.verify(null, Buffer.from(canonicalTelemetryPayload(usage, c), "utf8"), publicKey, signature);
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
        if (!ok && ctx.resultDigest !== undefined)
            ok = matches({ ...ctx, resultDigest: undefined });
    }
    catch (error) {
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
function resolveTrustPublicKey(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.includes("BEGIN") && trimmed.includes("KEY"))
        return trimmed;
    try {
        // Lazy require so a bundle that never resolves a key path pays no
        // fs cost — byte-identical pattern to the old build's own lazy
        // require here.
        const fs = require("node:fs");
        if (fs.existsSync(trimmed))
            return fs.readFileSync(trimmed, "utf8");
    }
    catch {
        /* fall through to undefined */
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// EXECUTOR-SIDE HELPER — the CW RUNTIME NEVER CALLS THIS. Provided for
// signing wrappers and tests; touches a private key, never a model.
// ---------------------------------------------------------------------------
function signTelemetry(usage, privateKeyPem, ctx) {
    const payload = Buffer.from(canonicalTelemetryPayload(usage, ctx), "utf8");
    const key = crypto.createPrivateKey(privateKeyPem);
    return crypto.sign(null, payload, key).toString("base64");
}
function stableDigest(value) {
    return `sha256:${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}
function verifyTelemetrySignatures(records, trustPublicKeyPem) {
    const checks = [];
    const resultBound = [];
    let checked = 0;
    let reverified = 0;
    let failed = 0;
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record.attestation !== "attested")
            continue;
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
        }
        else {
            failed += 1;
            checks.push({
                name: `signature[${i}]`,
                pass: false,
                code: result.reason && result.reason.startsWith("trust key unreadable")
                    ? "telemetry-pubkey-unreadable"
                    : "telemetry-signature-mismatch",
            });
        }
    }
    return { keyProvided: Boolean(trustPublicKeyPem), checked, reverified, failed, resultBound, checks };
}
