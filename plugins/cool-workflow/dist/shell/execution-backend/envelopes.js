"use strict";
// shell/execution-backend/envelopes.ts — shared envelope builders used by
// every delegating driver (container/remote/ci/agent) plus the registry's
// own refusal path.
//
// MILESTONE 5 (PLAN.md (project/docs/rebuild) build order, step 5). Byte-exact port of the
// old build's `delegatedEnvelope` and
// `refusedEnvelope` helpers, factored into one shared module
// since every delegating driver builds the identical shape (byte-stable
// evidence triple across backends — see SPEC/execution-backend.md invariant
// 2 "Same envelopes, any backend").
Object.defineProperty(exports, "__esModule", { value: true });
exports.delegatedEnvelope = delegatedEnvelope;
exports.refusedEnvelope = refusedEnvelope;
const hash_1 = require("../../core/hash");
/** Build the canonical completed/failed envelope shared by every real
 *  backend — identical to executeLocal's, so evidence is byte-stable across
 *  backends. The handle is recorded in provenance only. */
function delegatedEnvelope(descriptor, label, handle, attestation, command, args, exitCode, stdout) {
    const digest = (0, hash_1.sha256)(stdout);
    const status = exitCode === 0 ? "completed" : "failed";
    const evidence = [`command:${[command, ...args].join(" ")}`, `exitCode:${exitCode === null ? "null" : exitCode}`, `stdoutSha256:${digest}`];
    const summary = status === "completed" ? `${label}: completed (exit 0)` : `${label}: failed (exit ${exitCode === null ? "null" : exitCode})`;
    return {
        schemaVersion: 1,
        status,
        result: { summary, findings: [], evidence },
        evidence,
        provenance: {
            schemaVersion: 1,
            backendId: descriptor.id,
            locality: descriptor.locality,
            kind: descriptor.kind,
            attestation,
            handle,
        },
    };
}
function refusedEnvelope(descriptor, policy, label, code, reason, attestation) {
    const evidence = [`refused:${code}`, `backend:${descriptor.id}`, `sandbox:${policy.id}`];
    return {
        schemaVersion: 1,
        status: "refused",
        result: { summary: `${label}: refused (${code}) — ${reason}`, findings: [], evidence },
        evidence,
        provenance: {
            schemaVersion: 1,
            backendId: descriptor.id,
            locality: descriptor.locality,
            kind: descriptor.kind,
            attestation: { ...attestation, status: "refused", notes: [...(attestation.notes || []), `refused: ${code}`] },
            handle: attestation.handle,
        },
    };
}
