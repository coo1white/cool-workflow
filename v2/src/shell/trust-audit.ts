// shell/trust-audit.ts — a REAL but appropriately-scoped subset of the old
// build's trust-audit chain: event append (hash-chained), the evidence
// normalizer (grounding-only provenance, never agent-process fields), and
// the sandbox-path decision helper.
//
// SCOPE NOTE: the full ledger/telemetry/trust-audit trust layer
// (core/trust/ledger.ts, telemetry-ledger.ts, telemetry-attestation.ts,
// trust-audit.ts's full summarize/search/collaboration-linked surface) is
// milestone 8's scope (SPEC/ledger-trust.md). This file builds ONLY what
// milestones 6+7's combined conformance gate needs: a real, disk-backed,
// hash-chained events.jsonl (so `verifyTrustAudit`-shaped tampering checks
// stay meaningful once milestone 8 lands) and `normalizeEvidence`'s exact
// provenance shape, which exechard-evidence-triple-hygiene pins byte-for-
// byte (the `evidence.provenance` key set).
//
// Evidence: SPEC/pipeline-run.md's worker-accept references;
// plugins/cool-workflow/src/trust-audit.ts (byte-exact source for the
// pieces ported here).

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256, stableStringify } from "../core/hash";
import { durableAppendFileSync, safeFileName, writeJson } from "./fs-atomic";
import { StateEvidence, WorkflowRun } from "../core/state/types";

export const TRUST_AUDIT_SCHEMA_VERSION = 1;

export interface TrustAuditEvent {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  runId: string;
  kind: string;
  decision: string;
  source: string;
  actor?: string;
  workerId?: string;
  taskId?: string;
  nodeId?: string;
  feedbackIds?: string[];
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  sandboxProfileId?: string;
  policyRef?: string;
  policySnapshot?: unknown;
  normalizedPath?: string;
  command?: string;
  networkTarget?: string;
  envVars?: string[];
  evidence?: StateEvidence[];
  evidenceRefs?: string[];
  parentEventIds?: string[];
  metadata?: Record<string, unknown>;
  prevEventHash?: string;
  eventHash?: string;
}

export interface RecordTrustAuditInput {
  kind: string;
  decision: string;
  source: string;
  actor?: string;
  workerId?: string;
  taskId?: string;
  nodeId?: string;
  feedbackIds?: string[];
  candidateId?: string;
  selectionId?: string;
  commitId?: string;
  sandboxProfileId?: string;
  policySnapshot?: { id?: string };
  normalizedPath?: string;
  command?: string;
  networkTarget?: string;
  evidence?: StateEvidence[];
  evidenceRefs?: string[];
  parentEventIds?: string[];
  metadata?: Record<string, unknown>;
}

function trustAuditPaths(run: WorkflowRun): { eventLogPath: string; summaryPath: string; indexPath: string } {
  const dir = run.paths.auditDir || path.join(run.paths.runDir, "audit");
  return {
    eventLogPath: path.join(dir, "events.jsonl"),
    summaryPath: path.join(dir, "summary.json"),
    indexPath: path.join(dir, "index.json"),
  };
}

export function ensureTrustAudit(run: WorkflowRun): { eventLogPath: string; summaryPath: string; indexPath: string } {
  const dir = run.paths.auditDir || path.join(run.paths.runDir, "audit");
  fs.mkdirSync(dir, { recursive: true });
  run.paths.auditDir = dir;
  const audit = { schemaVersion: 1 as const, ...trustAuditPaths(run) };
  run.audit = audit;
  if (!fs.existsSync(audit.eventLogPath)) fs.writeFileSync(audit.eventLogPath, "", "utf8");
  return audit;
}

function trustAuditGenesis(runId: string): string {
  return sha256(`cw-trust-audit:${runId}`);
}

function computeEventHash(event: TrustAuditEvent): string {
  const { eventHash, ...rest } = event;
  void eventHash;
  return sha256(stableStringify(JSON.parse(JSON.stringify(rest))));
}

function readEventsRaw(eventLogPath: string): TrustAuditEvent[] {
  if (!fs.existsSync(eventLogPath)) return [];
  const events: TrustAuditEvent[] = [];
  for (const line of fs.readFileSync(eventLogPath, "utf8").split(/\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TrustAuditEvent);
    } catch {
      /* one corrupt line does not brick the read surface */
    }
  }
  return events;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function scrubMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (/secret|token|password|credential|authorization|api[_-]?key/i.test(key)) {
      result[key] = "[redacted]";
    } else if (Array.isArray(entry)) {
      result[key] = entry.map((item) => (typeof item === "string" && item.includes("=") ? item.split("=")[0] : item));
    } else if (entry && typeof entry === "object") {
      result[key] = scrubMetadata(entry as Record<string, unknown>);
    } else {
      result[key] = entry;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function createEventId(run: WorkflowRun, kind: string): string {
  const count = readEventsRaw(trustAuditPaths(run).eventLogPath).length + 1;
  return `audit-${safeFileName(kind)}-${String(count).padStart(4, "0")}`;
}

export function recordTrustAuditEvent(run: WorkflowRun, input: RecordTrustAuditInput): TrustAuditEvent {
  const audit = ensureTrustAudit(run);
  const event = compact({
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
    id: createEventId(run, input.kind),
    createdAt: new Date().toISOString(),
    runId: run.id,
    kind: input.kind,
    decision: input.decision,
    source: input.source,
    actor: input.actor,
    workerId: input.workerId,
    taskId: input.taskId,
    nodeId: input.nodeId,
    feedbackIds: input.feedbackIds?.filter(Boolean).sort(),
    candidateId: input.candidateId,
    selectionId: input.selectionId,
    commitId: input.commitId,
    sandboxProfileId: input.sandboxProfileId || input.policySnapshot?.id,
    policyRef: input.policySnapshot?.id ? `run.sandboxProfiles.${input.policySnapshot.id}` : undefined,
    policySnapshot: input.policySnapshot,
    normalizedPath: input.normalizedPath ? path.resolve(input.normalizedPath) : undefined,
    command: input.command,
    networkTarget: input.networkTarget,
    evidence: normalizeEvidence(run, input.evidence || [], { source: input.source, workerId: input.workerId, taskId: input.taskId, resultNodeId: input.nodeId }),
    evidenceRefs: unique(input.evidenceRefs || []).sort(),
    parentEventIds: unique(input.parentEventIds || []).sort(),
    metadata: scrubMetadata(input.metadata || {}),
  }) as unknown as TrustAuditEvent;
  const prior = readEventsRaw(audit.eventLogPath);
  event.prevEventHash = prior.length ? prior[prior.length - 1].eventHash || computeEventHash(prior[prior.length - 1]) : trustAuditGenesis(run.id);
  event.eventHash = computeEventHash(event);
  durableAppendFileSync(audit.eventLogPath, `${JSON.stringify(event)}\n`);
  return event;
}

export function recordSandboxPathDecision(
  run: WorkflowRun,
  input: { workerId: string; taskId?: string; sandboxProfileId?: string; policySnapshot?: { id?: string }; target: string; decision: "allowed" | "denied"; metadata?: Record<string, unknown> }
): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
    kind: "sandbox.path",
    decision: input.decision,
    source: "cw-validated",
    workerId: input.workerId,
    taskId: input.taskId,
    sandboxProfileId: input.sandboxProfileId,
    policySnapshot: input.policySnapshot,
    normalizedPath: input.target,
    metadata: input.metadata,
  });
}

export interface EvidenceProvenance {
  schemaVersion: 1;
  runId: string;
  source: string;
  workerId?: string;
  taskId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  parentEvidenceIds: string[];
  auditEventIds: string[];
  note?: string;
}

/** normalizeEvidence — GROUNDING-ONLY provenance. Never carries the
 *  agent's command/args/model/handle (those live ONLY in
 *  node.metadata.agentDelegation) — this is the exact hygiene split
 *  exechard-evidence-triple-hygiene.case.js pins. */
export function normalizeEvidence(
  run: WorkflowRun,
  evidence: StateEvidence[],
  provenance: {
    source: string;
    workerId?: string;
    taskId?: string;
    resultNodeId?: string;
    verifierNodeId?: string;
    candidateId?: string;
    scoreId?: string;
    selectionId?: string;
    commitId?: string;
    parentEvidenceIds?: string[];
    auditEventIds?: string[];
    note?: string;
  }
): StateEvidence[] {
  return evidence.map((entry) => ({
    ...entry,
    confidence: entry.confidence || (entry.locator || entry.path || entry.summary ? "grounded" : "ungrounded"),
    provenance: {
      schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
      runId: run.id,
      source: provenance.source || entry.provenance?.source || "runtime-derived",
      workerId: provenance.workerId || (entry.provenance as Record<string, unknown> | undefined)?.workerId,
      taskId: provenance.taskId || (entry.provenance as Record<string, unknown> | undefined)?.taskId,
      resultNodeId: provenance.resultNodeId || (entry.provenance as Record<string, unknown> | undefined)?.resultNodeId,
      verifierNodeId: provenance.verifierNodeId || (entry.provenance as Record<string, unknown> | undefined)?.verifierNodeId,
      candidateId: provenance.candidateId || (entry.provenance as Record<string, unknown> | undefined)?.candidateId,
      scoreId: provenance.scoreId || (entry.provenance as Record<string, unknown> | undefined)?.scoreId,
      selectionId: provenance.selectionId || (entry.provenance as Record<string, unknown> | undefined)?.selectionId,
      commitId: provenance.commitId || (entry.provenance as Record<string, unknown> | undefined)?.commitId,
      parentEvidenceIds: unique([...(((entry.provenance as Record<string, unknown> | undefined)?.parentEvidenceIds as string[]) || []), ...(provenance.parentEvidenceIds || [])]).sort(),
      auditEventIds: unique([...(((entry.provenance as Record<string, unknown> | undefined)?.auditEventIds as string[]) || []), ...(provenance.auditEventIds || [])]).sort(),
      note: provenance.note || (entry.provenance as Record<string, unknown> | undefined)?.note,
    } as unknown as StateEvidence["provenance"],
  }));
}

export function writeTrustAuditIndexPlaceholder(run: WorkflowRun): void {
  const audit = ensureTrustAudit(run);
  writeJson(audit.summaryPath, { schemaVersion: 1, runId: run.id, eventCount: readEventsRaw(audit.eventLogPath).length });
}
