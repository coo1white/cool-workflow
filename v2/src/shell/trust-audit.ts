// shell/trust-audit.ts — MILESTONE 8: extended from milestone 6+7's
// scoped-down subset to the FULL trust-audit hash chain: eventHash (the
// JSON round-trip pre-pass), verifyTrustAudit (chain-link recompute +
// the era rule — a log is fully chained OR fully legacy, never mixed),
// event append (hash-chained), the evidence normalizer, and the
// sandbox-path decision helper.
//
// The milestone-6+7 subset (recordTrustAuditEvent, recordSandboxPath-
// Decision, normalizeEvidence, ensureTrustAudit) keeps its existing
// signatures byte-for-byte — shell/commit.ts and shell/worker-
// isolation.ts already import them. This edit ADDS verifyTrustAudit +
// the era-rule check + trustAuditGenesis on top, and switches
// computeEventHash to use core/hash.ts's named `eventHashInput` export
// (byte-identical behavior to the pre-existing inline JSON-round-trip,
// now shared with the rest of the hash-dedup story per v2/PLAN.md byte-
// compat item 2).
//
// Evidence: SPEC/ledger-trust.md "Trust-audit chain", invariant 10 (era
// rule), byte-compat item 2; SPEC/pipeline-run.md's worker-accept
// references; plugins/cool-workflow/src/trust-audit.ts:1-731 (byte-exact
// source for the pieces ported here).

import * as fs from "node:fs";
import * as path from "node:path";
import { eventHashInput, sha256, stableStringify } from "../core/hash";
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

/** Genesis prevHash for a run's chain (no prior event). Exported so
 *  callers outside this module (verify tooling, tests) can recompute it
 *  independently rather than trusting a stored value. */
export function trustAuditGenesis(runId: string): string {
  return sha256(`cw-trust-audit:${runId}`);
}

/** Canonical bytes the eventHash binds: every field EXCEPT eventHash
 *  itself, via core/hash.ts's `eventHashInput` (the JSON round-trip
 *  pre-pass that drops nested `undefined`-valued keys BEFORE the
 *  sort-and-stringify step — not a formatting flag on the same shape,
 *  see v2/PLAN.md byte-compat item 2). Hashing the PERSISTED form this
 *  way makes record-time hashes equal verify-time (parsed-from-disk)
 *  hashes. */
function computeEventHash(event: TrustAuditEvent): string {
  const { eventHash, ...rest } = event;
  void eventHash;
  return sha256(eventHashInput(rest));
}

interface RawEventsRead {
  events: TrustAuditEvent[];
  corruptLines: number;
}

/** Read events in FILE (append) order, tolerating corrupt lines — one
 *  bad line must not brick the whole audit read surface (it is counted,
 *  not thrown). The chain links append order, so this is the order
 *  verification walks. */
function readEventsRawCounted(eventLogPath: string): RawEventsRead {
  if (!fs.existsSync(eventLogPath)) return { events: [], corruptLines: 0 };
  let corruptLines = 0;
  const events: TrustAuditEvent[] = [];
  for (const line of fs.readFileSync(eventLogPath, "utf8").split(/\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TrustAuditEvent);
    } catch {
      corruptLines += 1;
    }
  }
  return { events, corruptLines };
}

function readEventsRaw(eventLogPath: string): TrustAuditEvent[] {
  return readEventsRawCounted(eventLogPath).events;
}

export interface TrustAuditCheck {
  name: string;
  pass: boolean;
  code?: string;
}

export interface TrustAuditIntegrity {
  present: boolean;
  verified: boolean;
  eventCount: number;
  chained: number;
  unchained: number;
  corruptLines: number;
  checks: TrustAuditCheck[];
}

/** Re-prove the run's trust-audit chain: prevEventHash linkage (append
 *  order) + per-event hash recompute. A corrupt line, an edited event,
 *  or a removed event flips verified=false. Legacy events without a
 *  hash are reported as `unchained` (skipped), NOT treated as a forgery
 *  — they predate the chain.
 *
 *  ERA RULE (v2/PLAN.md, SPEC/ledger-trust.md invariant 10): a single
 *  run is written by one code version, so a log is all-chained (chain
 *  era) or all-legacy (pre-chain). An unchained (eventHash-less) line
 *  mixed into an otherwise-chained log is a forgery attempt — dropping
 *  the hash to be waved through as "legacy" — so it fails with
 *  `trust-audit-unchained-event`, never silently accepted. */
export function verifyTrustAudit(run: WorkflowRun): TrustAuditIntegrity {
  const audit = ensureTrustAudit(run);
  const { events, corruptLines } = readEventsRawCounted(audit.eventLogPath);
  const checks: TrustAuditCheck[] = [];
  let verified = corruptLines === 0;
  if (corruptLines > 0) checks.push({ name: "parse", pass: false, code: "trust-audit-corrupt-line" });
  let chained = 0;
  let unchained = 0;
  let expectedPrev = trustAuditGenesis(run.id);
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const recomputed = computeEventHash(event);
    if (event.eventHash === undefined) {
      unchained += 1;
      expectedPrev = recomputed; // advance the chain over legacy events
      continue;
    }
    chained += 1;
    if (event.eventHash !== recomputed) {
      verified = false;
      checks.push({ name: `event-hash[${i}]`, pass: false, code: "trust-audit-digest-mismatch" });
    }
    if (event.prevEventHash !== undefined && event.prevEventHash !== expectedPrev) {
      verified = false;
      checks.push({ name: `chain-link[${i}]`, pass: false, code: "trust-audit-chain-broken" });
    }
    expectedPrev = event.eventHash;
  }
  // Era rule: a log with ANY chained event must have EVERY event chained.
  if (chained > 0 && unchained > 0) {
    verified = false;
    checks.push({ name: "unchained-events", pass: false, code: "trust-audit-unchained-event" });
  }
  return { present: events.length > 0, verified, eventCount: events.length, chained, unchained, corruptLines, checks };
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
