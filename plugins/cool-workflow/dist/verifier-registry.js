"use strict";
// Verifier Registry — open pluggability for commit-gate verifiers.
//
// BSD discipline (mechanism separate from policy):
//  - MECHANISM: a Map<string, Verifier> with register + resolve.
//  - POLICY: which verifiers exist is declared via registerVerifier() at load time.
//  - FAIL CLOSED: unknown verifier id → named refusal.
//  - COMPOSABLE: multiple verifiers can be chained; each runs in registration order.
//
// From v0.1.58: the built-in verifier (validateResultEnvelope, validateRunGates,
// hasGroundedEvidence) remains the default. Registered verifiers run BEFORE the
// default — they can block or add evidence but cannot override the default gate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerVerifier = registerVerifier;
exports.getVerifier = getVerifier;
exports.listVerifiers = listVerifiers;
exports.runAllVerifiers = runAllVerifiers;
const _verifierRegistry = new Map();
function registerVerifier(verifier) {
    _verifierRegistry.set(verifier.id, verifier);
}
function getVerifier(id) {
    return _verifierRegistry.get(id);
}
function listVerifiers() {
    return [..._verifierRegistry.values()];
}
/** Run all registered verifiers against a run. Returns the aggregated verdict:
 *  "pass" if all pass, "block" if any block (first block reason wins). */
async function runAllVerifiers(input) {
    const reasons = [];
    const evidence = [];
    for (const verifier of _verifierRegistry.values()) {
        const result = await verifier.verify(input);
        if (result.evidence)
            evidence.push(...result.evidence);
        if (result.verdict === "block") {
            reasons.push(`[${verifier.id}] ${result.reason || "blocked by verifier"}`);
        }
        else if (result.verdict === "warn") {
            reasons.push(`[${verifier.id}] warn: ${result.reason || "warning"}`);
        }
    }
    const blocked = reasons.some((r) => !r.includes("warn:"));
    return { verdict: blocked ? "block" : "pass", reasons, evidence };
}
