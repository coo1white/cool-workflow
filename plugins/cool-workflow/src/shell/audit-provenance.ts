// shell/audit-provenance.ts — the trust-audit READ + record helpers the
// old flat build shipped inside trust-audit module but v2's
// shell/trust-audit.ts dropped: workerTrustAudit, evidenceProvenance, and
// the two thin record wrappers (recordHostAttestation,
// recordSandboxPolicyDecision). These are pure wrappers over the primitives
// shell/trust-audit.ts DOES export (listTrustAuditEvents,
// recordTrustAuditEvent), so they live in their own module rather than
// re-open the audited trust-audit.ts chain writer.
//
// Byte-behavior port of the old flat build's trust-audit source.

import {
  RecordTrustAuditInput,
  TrustAuditEvent,
  listTrustAuditEvents,
  recordTrustAuditEvent,
} from "./trust-audit";
import { StateEvidence, WorkflowRun } from "../core/state/types";

/** `cw audit worker <run> <worker>` body — every audited event that
 *  touched one worker. Port of old workerTrustAudit. */
export function workerTrustAudit(run: WorkflowRun, workerId: string): { workerId: string; events: TrustAuditEvent[] } {
  return { workerId, events: listTrustAuditEvents(run).filter((event) => event.workerId === workerId) };
}

/** `cw audit provenance <run>` body — the evidence chain (worker output ->
 *  candidate -> selection -> commit) and the audit events that produced it,
 *  filtered by candidate/commit/worker. Port of old evidenceProvenance. */
export function evidenceProvenance(
  run: WorkflowRun,
  options: { candidateId?: string; commitId?: string; workerId?: string } = {}
): { runId: string; evidence: StateEvidence[]; events: TrustAuditEvent[] } {
  const events = listTrustAuditEvents(run).filter((event) => {
    if (options.candidateId && event.candidateId !== options.candidateId) return false;
    if (options.commitId && event.commitId !== options.commitId) return false;
    if (options.workerId && event.workerId !== options.workerId) return false;
    return true;
  });
  const evidence: StateEvidence[] = [];
  for (const node of run.nodes || []) evidence.push(...(node.evidence || []));
  for (const candidate of (run.candidates as Array<{ evidence?: StateEvidence[] }> | undefined) || []) evidence.push(...(candidate.evidence || []));
  for (const selection of (run.candidateSelections as Array<{ evidence?: StateEvidence[] }> | undefined) || []) evidence.push(...(selection.evidence || []));
  for (const commit of (run.commits as Array<{ evidence?: StateEvidence[] }> | undefined) || []) evidence.push(...(commit.evidence || []));
  const filtered = evidence.filter((entry) => {
    const provenance = entry.provenance as { candidateId?: string; commitId?: string; workerId?: string } | undefined;
    if (options.candidateId && provenance?.candidateId !== options.candidateId) return false;
    if (options.commitId && provenance?.commitId !== options.commitId) return false;
    if (options.workerId && provenance?.workerId !== options.workerId) return false;
    return true;
  });
  return { runId: run.id, evidence: filtered, events };
}

/** Record a host/operator sandbox attestation event. Port of old
 *  recordHostAttestation. */
export function recordHostAttestation(
  run: WorkflowRun,
  input: Omit<RecordTrustAuditInput, "kind" | "decision" | "source"> & { kind?: string }
): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
    ...input,
    kind: input.kind || "sandbox.host-attestation",
    decision: "recorded",
    source: "host-attested",
  });
}

/** Record a cw-validated sandbox policy decision event. Port of old
 *  recordSandboxPolicyDecision. */
export function recordSandboxPolicyDecision(
  run: WorkflowRun,
  input: Omit<RecordTrustAuditInput, "source"> & { source?: string; envVars?: string[]; feedbackIds?: string[] }
): TrustAuditEvent {
  const { envVars, ...rest } = input;
  const event = recordTrustAuditEvent(run, {
    ...rest,
    source: input.source || "cw-validated",
    metadata: { ...(input.metadata || {}), ...(envVars && envVars.length ? { envVars } : {}) },
  });
  // The old event shape carried the sanitized env-var NAMES on the event
  // itself; the record wrapper stamps them so `audit decision --env` can echo
  // them back (the value is never stored — only the name, already stripped
  // upstream).
  if (envVars && envVars.length) (event as TrustAuditEvent & { envVars?: string[] }).envVars = envVars;
  return event;
}
