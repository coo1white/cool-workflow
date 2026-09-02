"use strict";
// shell/audit-provenance.ts — the trust-audit READ + record helpers the
// old flat build shipped inside src/trust-audit.ts but v2's
// shell/trust-audit.ts dropped: workerTrustAudit, evidenceProvenance, and
// the two thin record wrappers (recordHostAttestation,
// recordSandboxPolicyDecision). These are pure wrappers over the primitives
// shell/trust-audit.ts DOES export (listTrustAuditEvents,
// recordTrustAuditEvent), so they live in their own module rather than
// re-open the audited trust-audit.ts chain writer.
//
// Byte-behavior port of the old flat build's trust-audit source.
Object.defineProperty(exports, "__esModule", { value: true });
exports.workerTrustAudit = workerTrustAudit;
exports.evidenceProvenance = evidenceProvenance;
exports.recordHostAttestation = recordHostAttestation;
exports.recordSandboxPolicyDecision = recordSandboxPolicyDecision;
const trust_audit_1 = require("./trust-audit");
/** `cw audit worker <run> <worker>` body — every audited event that
 *  touched one worker. Port of old workerTrustAudit. */
function workerTrustAudit(run, workerId) {
    return { workerId, events: (0, trust_audit_1.listTrustAuditEvents)(run).filter((event) => event.workerId === workerId) };
}
/** `cw audit provenance <run>` body — the evidence chain (worker output ->
 *  candidate -> selection -> commit) and the audit events that produced it,
 *  filtered by candidate/commit/worker. Port of old evidenceProvenance. */
function evidenceProvenance(run, options = {}) {
    const events = (0, trust_audit_1.listTrustAuditEvents)(run).filter((event) => {
        if (options.candidateId && event.candidateId !== options.candidateId)
            return false;
        if (options.commitId && event.commitId !== options.commitId)
            return false;
        if (options.workerId && event.workerId !== options.workerId)
            return false;
        return true;
    });
    const evidence = [];
    for (const node of run.nodes || [])
        evidence.push(...(node.evidence || []));
    for (const candidate of run.candidates || [])
        evidence.push(...(candidate.evidence || []));
    for (const selection of run.candidateSelections || [])
        evidence.push(...(selection.evidence || []));
    for (const commit of run.commits || [])
        evidence.push(...(commit.evidence || []));
    const filtered = evidence.filter((entry) => {
        const provenance = entry.provenance;
        if (options.candidateId && provenance?.candidateId !== options.candidateId)
            return false;
        if (options.commitId && provenance?.commitId !== options.commitId)
            return false;
        if (options.workerId && provenance?.workerId !== options.workerId)
            return false;
        return true;
    });
    return { runId: run.id, evidence: filtered, events };
}
/** Record a host/operator sandbox attestation event. Port of old
 *  recordHostAttestation. */
function recordHostAttestation(run, input) {
    return (0, trust_audit_1.recordTrustAuditEvent)(run, {
        ...input,
        kind: input.kind || "sandbox.host-attestation",
        decision: "recorded",
        source: "host-attested",
    });
}
/** Record a cw-validated sandbox policy decision event. Port of old
 *  recordSandboxPolicyDecision. */
function recordSandboxPolicyDecision(run, input) {
    const { envVars, ...rest } = input;
    const event = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        ...rest,
        source: input.source || "cw-validated",
        metadata: { ...(input.metadata || {}), ...(envVars && envVars.length ? { envVars } : {}) },
    });
    // The old event shape carried the sanitized env-var NAMES on the event
    // itself; the record wrapper stamps them so `audit decision --env` can echo
    // them back (the value is never stored — only the name, already stripped
    // upstream).
    if (envVars && envVars.length)
        event.envVars = envVars;
    return event;
}
