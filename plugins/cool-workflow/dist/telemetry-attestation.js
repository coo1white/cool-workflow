"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableStringify = stableStringify;
exports.canonicalTelemetryPayload = canonicalTelemetryPayload;
exports.normalizeReportedUsage = normalizeReportedUsage;
exports.verifyTelemetryAttestation = verifyTelemetryAttestation;
exports.resolveTrustPublicKey = resolveTrustPublicKey;
exports.signTelemetry = signTelemetry;
const node_crypto_1 = __importDefault(require("node:crypto"));
/** Deterministic, key-sorted JSON so signer and verifier hash byte-identical
 *  input regardless of object key order. */
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
        promptDigest: ctx.promptDigest
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
/** Map the agent's free-form usage report onto UsageRecord token buckets, tolerating
 *  snake_case / camelCase variants (input_tokens vs inputTokens, etc.). CW never
 *  invents a number — an unreported bucket stays undefined, never zero. */
function normalizeReportedUsage(usage) {
    if (!usage)
        return {};
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
        publicKey = node_crypto_1.default.createPublicKey(trustPublicKeyPem);
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
    const payload = Buffer.from(canonicalTelemetryPayload(usage, ctx), "utf8");
    let ok = false;
    try {
        ok = node_crypto_1.default.verify(null, payload, publicKey, signature);
    }
    catch (error) {
        return { status: "unattested", reason: `verification error: ${messageOf(error)}` };
    }
    return ok
        ? { status: "attested", algorithm: "ed25519" }
        : { status: "unattested", reason: "signature does not match reported usage (tampered, replayed, or wrong key)" };
}
/** Resolve a trust key from a config value that is EITHER an inline PEM or a path
 *  to a `.pem` file. Returns undefined when absent/unreadable (⇒ `unattested`,
 *  never a hard throw). CW only ever loads a PUBLIC key here. */
function resolveTrustPublicKey(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.includes("BEGIN") && trimmed.includes("KEY"))
        return trimmed;
    try {
        // Lazy require so a bundle that never resolves a key path pays no fs cost.
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
// EXECUTOR-SIDE HELPER — the CW RUNTIME NEVER CALLS THIS.
// Provided for signing wrappers around `claude -p`/endpoints and for tests. It
// touches a private key, never a model, so it does not cross the red line; it is
// kept here only so signer and verifier share one canonicalization.
// ---------------------------------------------------------------------------
function signTelemetry(usage, privateKeyPem, ctx) {
    const payload = Buffer.from(canonicalTelemetryPayload(usage, ctx), "utf8");
    const key = node_crypto_1.default.createPrivateKey(privateKeyPem);
    return node_crypto_1.default.sign(null, payload, key).toString("base64");
}
