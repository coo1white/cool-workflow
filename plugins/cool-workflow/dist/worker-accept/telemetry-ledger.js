"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attestWorkerDelegation = attestWorkerDelegation;
exports.recordWorkerDelegationLedger = recordWorkerDelegationLedger;
const execution_backend_1 = require("../execution-backend");
const telemetry_attestation_1 = require("../telemetry-attestation");
const telemetry_ledger_1 = require("../telemetry-ledger");
const trust_audit_1 = require("../trust-audit");
const helpers_1 = require("../worker-isolation/helpers");
/** Step 2 — attestSandbox/attestDelegation: verify the agent's signed telemetry
 *  BEFORE recording it, enforce the opt-in require-attested-telemetry gate (still
 *  fail-closed, pre-mutation), and build the agent-hop provenance. Non-agent hops
 *  return an empty delegation. */
function attestWorkerDelegation(accept, deps) {
    const { run, workerId, options, task, absoluteResultPath, rawResult } = accept;
    // Agent Delegation Drive (v0.1.38): if this worker's result.md was produced by an
    // EXTERNAL agent, record the agent-hop attestation AS PROVENANCE — the agent
    // (kind:process) handle, the agent-REPORTED model (never CW_AGENT_MODEL), the
    // prompt digest, the secret-stripped args, and the result digest computed HERE
    // from the accepted result.md. These live in the result node's metadata (covered
    // by the v0.1.35 snapshot body) + a trust-audit event, NEVER in `evidence`.
    // Track 1: verify the agent's signed telemetry BEFORE recording it. CW holds
    // only the operator's PUBLIC key — it verifies attribution, never measures
    // usage. Absent/invalid signature => `unattested`/`absent`, surfaced loudly,
    // NEVER silently recorded as trusted.
    const telemetry = options.agentDelegation
        ? (0, telemetry_attestation_1.verifyTelemetryAttestation)(options.agentDelegation.reportedUsage, options.agentDelegation.usageSignature, (0, telemetry_attestation_1.resolveTrustPublicKey)(options.agentDelegation.usageTrustPublicKey), 
        // resultDigest binds the agent's findings into the signature: CW recomputes
        // the digest from the accepted result (the SAME raw bytes the executor
        // signed) so a result edited after signing fails verification. A signer
        // that did not cover the result still verifies (verifier back-compat).
        { runId: run.id, taskId: task.id, promptDigest: options.agentDelegation.promptDigest, resultDigest: (0, execution_backend_1.sha256)(rawResult) })
        : undefined;
    // Track 1 fail-closed (Decision 2 — OPT-IN, off by default). When the operator
    // requires attested telemetry, a delegated hop whose verdict is not `attested`
    // is REJECTED here — BEFORE any accept-side state mutation — so the drive parks
    // it instead of recording unverifiable usage. Default behavior is unchanged
    // (flag-and-surface). Non-agent hops carry no verdict and are never blocked.
    if (options.requireAttestedTelemetry && telemetry && telemetry.status !== "attested") {
        const error = (0, helpers_1.structuredError)("telemetry-unattested-blocked", `Worker ${workerId} telemetry is ${telemetry.status} (${telemetry.reason || "unverified"}) and require-attested-telemetry is enabled — refusing to accept a hop whose usage cannot be cryptographically verified`, { path: absoluteResultPath, retryable: false });
        deps.recordWorkerFailure(run, workerId, error, { ...options, persist: options.persist });
        throw new Error(error.message);
    }
    const agentDelegation = options.agentDelegation
        ? {
            schemaVersion: 1,
            backendId: "agent",
            handle: options.agentDelegation.handle,
            model: options.agentDelegation.model,
            promptDigest: options.agentDelegation.promptDigest,
            resultDigest: (0, execution_backend_1.sha256)(rawResult),
            command: options.agentDelegation.command,
            args: options.agentDelegation.args,
            exitCode: options.agentDelegation.exitCode,
            ...(options.agentDelegation.reportedUsage ? { reportedUsage: options.agentDelegation.reportedUsage } : {}),
            ...(options.agentDelegation.usageSignature ? { usageSignature: options.agentDelegation.usageSignature } : {}),
            ...(telemetry ? { usageAttestation: telemetry.status, usageAttestationReason: telemetry.reason } : {})
        }
        : undefined;
    return { agentDelegation, telemetry };
}
/** Step 4 — recordTelemetryLedger: the agent-hop attestation. Binds the telemetry
 *  verdict into the append-only hash-chained ledger BEFORE the audit event (so the
 *  event can cross-link the record hash), then emits the worker.agent-delegation
 *  audit event. No-op for non-agent hops. */
function recordWorkerDelegationLedger(accept, delegation) {
    const { agentDelegation, telemetry } = delegation;
    // The agent-hop attestation event — hung off worker.output, alongside
    // worker.backend. Recorded in trust-audit/provenance, NEVER in node evidence.
    if (!agentDelegation)
        return;
    const { run, workerId, scope, task, resultNode, acceptedAuditId } = accept;
    // Track 1 (tamper-evidence): bind this verdict into the append-only,
    // hash-chained telemetry ledger BEFORE the audit event, so the event can
    // cross-link the record hash. Editing the recorded verdict/usage later breaks
    // the chain (verifyTelemetryLedger). Only when a verdict was computed.
    const ledgerRecord = agentDelegation.usageAttestation
        ? (0, telemetry_ledger_1.appendTelemetryAttestation)(run, {
            workerId,
            taskId: task.id,
            promptDigest: agentDelegation.promptDigest,
            reportedUsage: agentDelegation.reportedUsage,
            usageSignature: agentDelegation.usageSignature,
            // Store the signed result digest ONLY when the signature actually covered
            // it, so the offline re-verifier (telemetry verify --pubkey / report verify)
            // can reconstruct the 5-field payload. A usage-only signature stores none
            // (its record stays byte-identical to a pre-result-coverage one).
            resultDigest: telemetry?.coversResult ? agentDelegation.resultDigest : undefined,
            attestation: agentDelegation.usageAttestation,
            attestationReason: agentDelegation.usageAttestationReason
        })
        : undefined;
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "worker.agent-delegation",
        decision: "recorded",
        source: "host-attested",
        workerId,
        taskId: task.id,
        nodeId: resultNode.id,
        sandboxProfileId: scope.sandboxProfileId,
        policySnapshot: scope.sandboxPolicy,
        parentEventIds: [acceptedAuditId],
        metadata: {
            backendId: agentDelegation.backendId,
            handleKind: agentDelegation.handle.kind,
            handleRef: agentDelegation.handle.ref,
            model: agentDelegation.model,
            promptDigest: agentDelegation.promptDigest,
            resultDigest: agentDelegation.resultDigest,
            command: agentDelegation.command,
            args: agentDelegation.args,
            exitCode: agentDelegation.exitCode,
            // Track 1: the telemetry verdict travels with the agent-hop event so the
            // audit report can surface `unattested` usage loudly. Absent => no usage.
            ...(agentDelegation.usageAttestation
                ? {
                    telemetryAttestation: agentDelegation.usageAttestation,
                    ...(agentDelegation.usageAttestationReason ? { telemetryAttestationReason: agentDelegation.usageAttestationReason } : {}),
                    ...(agentDelegation.reportedUsage ? { reportedUsage: agentDelegation.reportedUsage } : {}),
                    // Cross-link to the hash-chained ledger entry (tamper-evidence).
                    ...(ledgerRecord ? { telemetryRecordId: ledgerRecord.recordId, telemetryRecordHash: ledgerRecord.recordHash, telemetryPrevHash: ledgerRecord.prevHash } : {})
                }
                : {})
        }
    });
}
