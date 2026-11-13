// core/trust/telemetry-attestation.ts — ed25519 usage/result attestation.
// The agent signs; CW only verifies, with an operator-given PUBLIC key.
// Pure but for crypto and resolveTrustPublicKey's lazy fs read.
import * as crypto from "node:crypto";
import { messageOf } from "../util/cli-args.js";
/** core/hash.ts's telemetryStableStringify, under the name the spec gives. */
export function stableStringify(value) {
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
export function canonicalTelemetryPayload(usage, ctx) {
    return stableStringify({
        usage: usage ?? null,
        runId: ctx.runId,
        taskId: ctx.taskId,
        promptDigest: ctx.promptDigest,
        // Omitted when absent, so 4-field signatures still verify.
        ...(ctx.resultDigest !== undefined ? { resultDigest: ctx.resultDigest } : {}),
    });
}
/** Verify a signed usage record. Tries the 5-field payload (with
 *  resultDigest), then the 4-field one; only a 5-field match sets
 *  `coversResult`. Never throws. */
export function verifyTelemetryAttestation(usage, signatureB64, trustPublicKeyPem, ctx) {
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
        // First arm: the signature covered the result.
        coversResult = ok && ctx.resultDigest !== undefined;
        // Old signers signed 4 fields. An edited result fails both arms.
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
/** A public key from an inline PEM or a `.pem` path; undefined when
 *  absent or unreadable (the run reads `unattested`). */
export function resolveTrustPublicKey(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.includes("BEGIN") && trimmed.includes("KEY"))
        return trimmed;
    try {
        const fs = process.getBuiltinModule("node:fs");
        if (fs.existsSync(trimmed))
            return fs.readFileSync(trimmed, "utf8");
    }
    catch {
        /* fall through to undefined */
    }
    return undefined;
}
// Signer side, for wrappers and tests only: the CW runtime never calls this.
export function signTelemetry(usage, privateKeyPem, ctx) {
    const payload = Buffer.from(canonicalTelemetryPayload(usage, ctx), "utf8");
    const key = crypto.createPrivateKey(privateKeyPem);
    return crypto.sign(null, payload, key).toString("base64");
}
function stableDigest(value) {
    return `sha256:${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}
export function verifyTelemetrySignatures(records, trustPublicKeyPem) {
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
