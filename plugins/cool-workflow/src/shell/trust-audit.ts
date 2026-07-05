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
// now shared with the rest of the hash-dedup story per docs/rebuild/PLAN.md byte-
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
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  blackboardContextId?: string;
  blackboardArtifactRefId?: string;
  blackboardSnapshotId?: string;
  coordinatorDecisionId?: string;
  topologyId?: string;
  topologyRunId?: string;
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
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  blackboardContextId?: string;
  blackboardArtifactRefId?: string;
  blackboardSnapshotId?: string;
  coordinatorDecisionId?: string;
  topologyId?: string;
  topologyRunId?: string;
  sandboxProfileId?: string;
  policyRef?: string;
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
 *  see docs/rebuild/PLAN.md byte-compat item 2). Hashing the PERSISTED form this
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

/** Every recorded trust-audit event for this run, in append (file) order.
 *  Used by trust-policy/collaboration summaries (e.g.
 *  hasAcceptedJudgeRationale, summarizeMultiAgentTrust). */
export function listTrustAuditEvents(run: WorkflowRun): TrustAuditEvent[] {
  return readEventsRaw(ensureTrustAudit(run).eventLogPath);
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
 *  ERA RULE (docs/rebuild/PLAN.md, SPEC/ledger-trust.md invariant 10): a single
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

/** Correlation-id keys copied verbatim (and no others) — byte-exact list/
 *  order to the old build's CORRELATION_ID_FIELDS. */
const CORRELATION_ID_FIELDS = [
  "candidateId",
  "scoreId",
  "selectionId",
  "commitId",
  "multiAgentRunId",
  "agentRoleId",
  "agentGroupId",
  "agentMembershipId",
  "agentFanoutId",
  "agentFaninId",
  "blackboardId",
  "blackboardTopicId",
  "blackboardMessageId",
  "blackboardContextId",
  "blackboardArtifactRefId",
  "blackboardSnapshotId",
  "coordinatorDecisionId",
  "topologyId",
  "topologyRunId",
] as const;

function pickCorrelationIds(source: RecordTrustAuditInput): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {};
  for (const field of CORRELATION_ID_FIELDS) picked[field] = source[field];
  return picked;
}

/** The audit index historically omits scoreId (byte-exact to the old build's
 *  INDEX_OMITTED_CORRELATION_IDS). */
const INDEX_OMITTED_CORRELATION_IDS: ReadonlySet<string> = new Set(["scoreId"]);

function indexCorrelationIds(event: TrustAuditEvent): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {};
  for (const field of CORRELATION_ID_FIELDS) {
    if (INDEX_OMITTED_CORRELATION_IDS.has(field)) continue;
    picked[field] = (event as unknown as Record<string, string | undefined>)[field];
  }
  return picked;
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
    ...pickCorrelationIds(input),
    sandboxProfileId: input.sandboxProfileId || input.policySnapshot?.id,
    policyRef: input.policyRef || (input.policySnapshot?.id ? `run.sandboxProfiles.${input.policySnapshot.id}` : undefined),
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

function countBy<T>(values: T[], key: (v: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const bucket = key(value);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

export interface TrustAuditSummary {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  eventCount: number;
  integrity: TrustAuditIntegrity;
  eventLogPath: string;
  indexPath: string;
  summaryPath: string;
  byKind: Record<string, number>;
  byDecision: Record<string, number>;
  bySource: Record<string, number>;
  bySandboxProfile: Record<string, number>;
  workers: Array<{ workerId: string; taskId?: string; sandboxProfileId?: string; decisions: Record<string, number>; denied: number; feedbackIds: string[] }>;
  candidates: Array<{ candidateId: string; scoreIds: string[]; selectionIds: string[]; evidenceCount: number }>;
  commits: Array<{ commitId: string; verifierGated: boolean; candidateId?: string; selectionId?: string; evidenceCount: number; rationale?: Record<string, unknown> }>;
  multiAgent: { runs: number; roles: number; groups: number; memberships: number; fanouts: number; fanins: number; events: number };
  blackboard: { boards: number; topics: number; messages: number; contexts: number; artifacts: number; snapshots: number; decisions: number; events: number };
  topologies: { runs: number; events: number };
  multiAgentTrust: { rolePolicies: number; permissionDecisions: number; blackboardWrites: number; messageProvenance: number; judgeRationales: number; panelDecisions: number; policyViolations: number };
}

/** MILESTONE 11 (reporting/observability) — the `## Trust Audit` report
 *  section's data source. A scoped-down port of the old build's
 *  `summarizeTrustAudit` (plugins/cool-workflow/src/trust-audit.ts:413+):
 *  this milestone's report.ts only renders eventCount/integrity/byDecision/
 *  bySource/bySandboxProfile/paths, so those are the only fields carried
 *  here — the old build's extra workers/candidates/commits/multiAgent/
 *  blackboard rollups are milestone 9's own summarizeMultiAgent/
 *  candidate-scoring-io/coordinator-io surfaces, not duplicated here. */
function workerRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["workers"] {
  const workerIds = unique([...(run.workers as Array<{ id: string }> | undefined || []).map((w) => w.id), ...events.map((e) => e.workerId || "")]).sort();
  return workerIds.filter(Boolean).map((workerId) => {
    const worker = (run.workers as Array<{ id: string; taskId?: string; sandboxProfileId?: string }> | undefined || []).find((w) => w.id === workerId);
    const scoped = events.filter((e) => e.workerId === workerId);
    return {
      workerId,
      taskId: worker?.taskId || scoped.find((e) => e.taskId)?.taskId,
      sandboxProfileId: worker?.sandboxProfileId || scoped.find((e) => e.sandboxProfileId)?.sandboxProfileId,
      decisions: countBy(scoped, (e) => e.decision),
      denied: scoped.filter((e) => e.decision === "denied" || e.decision === "rejected").length,
      feedbackIds: unique(scoped.flatMap((e) => e.feedbackIds || [])).sort(),
    };
  });
}

function candidateRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["candidates"] {
  const cands = (run.candidates as Array<{ id: string; scores?: string[]; evidence?: unknown[] }> | undefined) || [];
  const selectionsAll = (run.candidateSelections as Array<{ id: string; candidateId: string }> | undefined) || [];
  const ids = unique([...cands.map((c) => c.id), ...events.map((e) => e.candidateId || "")]).sort();
  return ids.filter(Boolean).map((candidateId) => {
    const candidate = cands.find((c) => c.id === candidateId);
    const selections = selectionsAll.filter((s) => s.candidateId === candidateId);
    const scoped = events.filter((e) => e.candidateId === candidateId);
    return {
      candidateId,
      scoreIds: unique([...(candidate?.scores || []), ...scoped.map((e) => e.scoreId || "")]).filter(Boolean).sort(),
      selectionIds: unique([...selections.map((s) => s.id), ...scoped.map((e) => e.selectionId || "")]).filter(Boolean).sort(),
      evidenceCount: candidate?.evidence?.length || scoped.flatMap((e) => e.evidence || []).length,
    };
  });
}

function commitRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["commits"] {
  const ids = unique([...(run.commits || []).map((c) => c.id), ...events.map((e) => e.commitId || "")]).sort();
  return ids.filter(Boolean).map((commitId) => {
    const commit = (run.commits || []).find((c) => c.id === commitId);
    return {
      commitId,
      verifierGated: Boolean(commit?.verifierGated),
      candidateId: commit?.candidateId,
      selectionId: commit?.selectionId,
      evidenceCount: commit?.evidence?.length || 0,
      rationale: commit?.acceptanceRationale as Record<string, unknown> | undefined,
    };
  });
}

export function summarizeTrustAudit(run: WorkflowRun): TrustAuditSummary {
  const audit = ensureTrustAudit(run);
  const events = readEventsRaw(audit.eventLogPath);
  const ma = run.multiAgent;
  const bb = run.blackboard;
  const summary: TrustAuditSummary = {
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    integrity: verifyTrustAudit(run),
    eventLogPath: audit.eventLogPath,
    indexPath: audit.indexPath,
    summaryPath: audit.summaryPath,
    byKind: countBy(events, (event) => event.kind),
    byDecision: countBy(events, (event) => event.decision),
    bySource: countBy(events, (event) => event.source),
    bySandboxProfile: countBy(
      events.filter((event) => event.sandboxProfileId),
      (event) => event.sandboxProfileId || "none"
    ),
    workers: workerRows(events, run),
    candidates: candidateRows(events, run),
    commits: commitRows(events, run),
    multiAgent: {
      runs: ma?.runs.length || 0,
      roles: ma?.roles.length || 0,
      groups: ma?.groups.length || 0,
      memberships: ma?.memberships.length || 0,
      fanouts: ma?.fanouts.length || 0,
      fanins: ma?.fanins.length || 0,
      events: events.filter((e) => Boolean(e.multiAgentRunId || e.agentRoleId || e.agentGroupId || e.agentMembershipId || e.agentFanoutId || e.agentFaninId)).length,
    },
    blackboard: {
      boards: bb?.boards.length || 0,
      topics: bb?.topics.length || 0,
      messages: bb?.messages.length || 0,
      contexts: bb?.contexts.length || 0,
      artifacts: bb?.artifacts.length || 0,
      snapshots: bb?.snapshots.length || 0,
      decisions: bb?.decisions.length || 0,
      events: events.filter((e) => Boolean(e.blackboardId || e.blackboardTopicId || e.blackboardMessageId || e.blackboardContextId || e.blackboardArtifactRefId || e.blackboardSnapshotId || e.coordinatorDecisionId)).length,
    },
    topologies: {
      runs: run.topologies?.runs.length || 0,
      events: events.filter((e) => Boolean(e.topologyId || e.topologyRunId || e.kind.startsWith("topology."))).length,
    },
    multiAgentTrust: {
      rolePolicies: events.filter((e) => e.kind === "multi-agent.role-policy").length,
      permissionDecisions: events.filter((e) => e.kind === "multi-agent.permission").length,
      blackboardWrites: events.filter((e) => e.kind === "blackboard.write").length,
      messageProvenance: events.filter((e) => e.kind === "blackboard.message-provenance").length,
      judgeRationales: events.filter((e) => e.kind === "judge.rationale").length,
      panelDecisions: events.filter((e) => e.kind === "judge.panel-decision").length,
      policyViolations: events.filter((e) => e.kind === "policy.violation").length,
    },
  };
  // Durable: the summary/index are the read-side view of the audit log; persist
  // them durably so a crash can't leave them pointing past the last durably-
  // appended event. Byte-behavior port of the old build's summarizeTrustAudit.
  writeJson(audit.summaryPath, summary, { durable: true });
  writeJson(
    audit.indexPath,
    {
      schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
      runId: run.id,
      events: events.map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        kind: event.kind,
        decision: event.decision,
        source: event.source,
        workerId: event.workerId,
        taskId: event.taskId,
        ...indexCorrelationIds(event),
        sandboxProfileId: event.sandboxProfileId,
        policyRef: event.policyRef,
      })),
    },
    { durable: true }
  );
  run.audit = { schemaVersion: TRUST_AUDIT_SCHEMA_VERSION, ...audit };
  return summary;
}
