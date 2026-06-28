import fs from "node:fs";
import path from "node:path";
import {
  AcceptanceRationale,
  EvidenceProvenance,
  ResolvedSandboxPolicy,
  StateEvidence,
  TrustAuditDecision,
  TrustAuditEvent,
  TrustAuditIntegrity,
  TrustAuditSource,
  TrustAuditSummary,
  WorkflowRun
} from "./types";
import { durableAppendFileSync, safeFileName, writeJson } from "./state";
import { computeEvidenceConfidence, extractEvidenceContent } from "./evidence-grounding";
import { sha256 } from "./execution-backend";
import { stableStringify } from "./telemetry-attestation";


export const TRUST_AUDIT_SCHEMA_VERSION = 1;

// ---- Tamper-evidence chain (v0.1.81) --------------------------------------
// Same discipline as telemetry-ledger.ts / reclamation.ts: the event log is
// hash-chained in APPEND order, and verifyTrustAudit recomputes every hash
// independently (never trusts a stored value), so an edited or removed event is
// detected. Durability (fsync) only guards against power loss; this guards
// against post-hoc edits — the threat an external auditor actually cares about.
//
// THREAT MODEL (be honest about the limit): the genesis is sha256(runId), so this
// detects casual/partial tampering, accidental corruption, truncation, removal,
// and forged-unchained lines — but NOT a determined local writer who re-chains the
// WHOLE log with this module's own sha256 after an edit. That is the same limit
// reclamation.ts's tombstone chain has, and it is INHERENT to a local, self-
// recomputable chain: closing it needs an anchor the writer cannot reproduce.
// CW cannot self-sign that anchor — by design CW holds NO private key (see
// telemetry-attestation.ts: "CW never holds the private key"; the AGENT signs its
// usage, CW only VERIFIES with the operator-provisioned public half). The single
// cryptographic anchor that exists is therefore the agent's telemetry signature,
// which binds agent-reported USAGE (worker-isolation cross-links the chain into it)
// — it does NOT cover CW-only sandbox/policy/commit-gate decisions, which have no
// external signer. For those, the only stronger guarantee is operational: commit
// events.jsonl to an external append-only medium (git history / a remote log) the
// local writer cannot rewrite. The chain is a strict upgrade over a bare append-
// only log, not a substitute for an external anchor — and that anchor is not
// something CW can mint for itself.

/** Single source of truth for a run's audit-paths object: the schemaVersion plus
 *  the three derived file paths under auditRoot(run). ensureTrustAudit /
 *  refreshTrustAudit spread this, and createEventId reads .eventLogPath from it, so
 *  the path-derivation rule lives in exactly one place. */
function trustAuditPaths(run: WorkflowRun): {
  schemaVersion: 1;
  eventLogPath: string;
  summaryPath: string;
  indexPath: string;
} {
  const dir = auditRoot(run);
  return {
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION as 1,
    eventLogPath: path.join(dir, "events.jsonl"),
    summaryPath: path.join(dir, "summary.json"),
    indexPath: path.join(dir, "index.json")
  };
}

/** Genesis prevHash for a run's chain (no prior event). */
export function trustAuditGenesis(runId: string): string {
  return sha256(`cw-trust-audit:${runId}`);
}

/** Canonical bytes the eventHash binds: every field EXCEPT eventHash itself
 *  (prevEventHash included, so the chain link is bound).
 *
 *  The hash binds the PERSISTED form. `stableStringify` keeps an undefined-valued
 *  key as `"k":null`, but the `JSON.stringify` that writes events.jsonl DROPS such
 *  keys — so without this round-trip the record-time hash (over the in-memory event,
 *  which can carry nested undefined like an absent dispatchId in worker-sandbox
 *  metadata) would never match the verify-time hash (over the parsed-from-disk
 *  event), false-failing legitimate worker events as `trust-audit-digest-mismatch`.
 *  Round-tripping makes record-time == verify-time. It is identity for events with
 *  no undefined fields, so existing intact chains hash unchanged. */
function computeEventHash(event: TrustAuditEvent): string {
  const { eventHash, ...rest } = event;
  return sha256(stableStringify(JSON.parse(JSON.stringify(rest))));
}

/** The hash to chain the NEXT event to: the stored eventHash, or a recompute for
 *  a legacy event written before the chain existed. */
function chainHashOf(event: TrustAuditEvent): string {
  return event.eventHash || computeEventHash(event);
}

/** Read events in FILE (append) order, tolerating corrupt lines — one bad line
 *  must not brick the whole audit read surface (it is counted, not thrown). The
 *  chain links append order, so this is the order verification walks. */
function readEventsRaw(eventLogPath: string): { events: TrustAuditEvent[]; corruptLines: number } {
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

/** Re-prove the run's trust-audit chain: prevEventHash linkage (append order) +
 *  per-event hash recompute. A corrupt line, an edited event, or a removed event
 *  flips verified=false. Legacy events without a hash are reported as `unchained`
 *  (skipped), NOT treated as a forgery — they predate the chain. */
export function verifyTrustAudit(run: WorkflowRun): TrustAuditIntegrity {
  const audit = ensureTrustAudit(run);
  const { events, corruptLines } = readEventsRaw(audit.eventLogPath);
  const checks: TrustAuditIntegrity["checks"] = [];
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
  // A log with ANY chained event must have EVERY event chained: a single run is
  // written by one code version, so it is all-chained (chain era) or all-legacy
  // (pre-chain). An unchained (eventHash-less) line mixed into a chained log is a
  // forgery attempt — drop the hash to be waved through as "legacy" — so it fails.
  if (chained > 0 && unchained > 0) {
    verified = false;
    checks.push({ name: "unchained-events", pass: false, code: "trust-audit-unchained-event" });
  }
  return { present: events.length > 0, verified, eventCount: events.length, chained, unchained, corruptLines, checks };
}

export interface RecordTrustAuditInput {
  kind: string;
  decision: TrustAuditDecision;
  source: TrustAuditSource;
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
  policySnapshot?: ResolvedSandboxPolicy;
  normalizedPath?: string;
  command?: string;
  networkTarget?: string;
  envVars?: string[];
  evidence?: StateEvidence[];
  evidenceRefs?: string[];
  parentEventIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface SandboxDecisionInput {
  workerId: string;
  taskId?: string;
  sandboxProfileId?: string;
  policySnapshot?: ResolvedSandboxPolicy;
  target: string;
  decision: "allowed" | "denied";
  source?: TrustAuditSource;
  kind?: string;
  feedbackIds?: string[];
  metadata?: Record<string, unknown>;
}

// ---- Correlation-id fields (single source of truth, F12) -------------------
// These id fields are plain pass-throughs that flow input -> persisted event ->
// summary index unchanged. They were previously re-listed by hand in three
// places (recordTrustAuditEvent, the index writer, and partially in
// multi-agent-trust), so adding a new correlation id meant editing every list and
// silently dropping it from the index when one was missed. They now live in ONE
// array; both spread sites pick from it via pickCorrelationIds, so a new id is
// added in exactly one place.
//
// SERIALIZATION-PRESERVING by design: this is a plain key-copy with NO transform,
// so the persisted JSON for these keys is byte-identical to the old hand-spread
// (compact() still drops the undefined ones). The hash chain that binds these
// fields is therefore unaffected. Fields needing derivation/normalization
// (feedbackIds, sandboxProfileId, policyRef, multiAgentPolicyRef, normalizedPath,
// envVars, …) are intentionally NOT here — they keep their bespoke handling at the
// call site.
export const CORRELATION_ID_FIELDS = [
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
  "topologyRunId"
] as const;

type CorrelationIdField = (typeof CORRELATION_ID_FIELDS)[number];

/** Copy exactly the correlation-id keys (and no others) from `source`, preserving
 *  each value verbatim (including `undefined`, which compact()/JSON.stringify drop
 *  identically to the prior per-key spread). Spread the result; do not transform. */
function pickCorrelationIds(
  source: Partial<Record<CorrelationIdField, string | undefined>>
): Record<CorrelationIdField, string | undefined> {
  const picked = {} as Record<CorrelationIdField, string | undefined>;
  for (const field of CORRELATION_ID_FIELDS) picked[field] = source[field];
  return picked;
}

// The summary index has always carried every correlation id EXCEPT scoreId (the
// per-candidate score lives in the candidates[] rows, not the flat event index).
// Pin that exception in ONE place so the index stays byte-identical while still
// inheriting any NEW id from CORRELATION_ID_FIELDS automatically.
const INDEX_OMITTED_CORRELATION_IDS: ReadonlySet<CorrelationIdField> = new Set(["scoreId"]);

/** Correlation ids for the summary index: the full pick minus the keys the index
 *  has historically omitted (see INDEX_OMITTED_CORRELATION_IDS). */
function indexCorrelationIds(
  event: Partial<Record<CorrelationIdField, string | undefined>>
): Partial<Record<CorrelationIdField, string | undefined>> {
  const picked = pickCorrelationIds(event);
  for (const field of INDEX_OMITTED_CORRELATION_IDS) delete picked[field];
  return picked;
}

export function ensureTrustAudit(run: WorkflowRun): Required<NonNullable<WorkflowRun["audit"]>> {
  const auditDir = auditRoot(run);
  fs.mkdirSync(auditDir, { recursive: true });
  run.paths.auditDir = auditDir;
  const audit = { ...trustAuditPaths(run) };
  run.audit = audit;
  if (!fs.existsSync(audit.eventLogPath)) fs.writeFileSync(audit.eventLogPath, "", "utf8");
  return audit;
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
    // Plain correlation-id pass-throughs (candidateId … topologyRunId) come from the
    // single CORRELATION_ID_FIELDS list. Key order is preserved (the list is in the
    // same order the keys used to be hand-written), so the persisted JSON — and thus
    // the eventHash chain — is byte-identical.
    ...pickCorrelationIds(input),
    sandboxProfileId: input.sandboxProfileId || input.policySnapshot?.id,
    policyRef: input.policyRef || (input.policySnapshot?.id ? `run.sandboxProfiles.${input.policySnapshot.id}` : undefined),
    multiAgentPolicyRef: input.policyRef,
    policySnapshot: redactPolicy(input.policySnapshot),
    normalizedPath: input.normalizedPath ? path.resolve(input.normalizedPath) : undefined,
    command: input.command,
    networkTarget: input.networkTarget,
    envVars: input.envVars ? unique(input.envVars.map(String)).sort() : undefined,
    evidence: normalizeEvidence(run, input.evidence || [], {
      source: input.source,
      workerId: input.workerId,
      taskId: input.taskId,
      resultNodeId: input.nodeId
    }),
    evidenceRefs: unique(input.evidenceRefs || []).sort(),
    parentEventIds: unique(input.parentEventIds || []).sort(),
    metadata: scrubMetadata(input.metadata || {})
  }) as unknown as TrustAuditEvent;
  // Tamper-evidence chain: link this event to the prior one (append order) and
  // bind its content with eventHash BEFORE persisting. verifyTrustAudit recomputes
  // both independently, so a later edit or removal is detectable.
  const prior = readEventsRaw(audit.eventLogPath).events;
  event.prevEventHash = prior.length ? chainHashOf(prior[prior.length - 1]) : trustAuditGenesis(run.id);
  event.eventHash = computeEventHash(event);
  // DURABLE append (v0.1.40 self-audit P1): the audit log is the one artifact
  // whose loss breaks audit-completeness, so fsync it before returning — never a
  // bare appendFileSync, which can drop the last event on power loss.
  durableAppendFileSync(audit.eventLogPath, `${JSON.stringify(event)}\n`);
  refreshTrustAudit(run);
  return event;
}

export function recordSandboxPathDecision(run: WorkflowRun, input: SandboxDecisionInput): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
    kind: input.kind || "sandbox.path",
    decision: input.decision,
    source: input.source || "cw-validated",
    workerId: input.workerId,
    taskId: input.taskId,
    sandboxProfileId: input.sandboxProfileId,
    policySnapshot: input.policySnapshot,
    normalizedPath: input.target,
    feedbackIds: input.feedbackIds,
    metadata: input.metadata
  });
}

export function recordSandboxPolicyDecision(
  run: WorkflowRun,
  input: Omit<RecordTrustAuditInput, "source"> & { source?: TrustAuditSource }
): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
    ...input,
    source: input.source || "cw-validated"
  });
}

export function recordHostAttestation(
  run: WorkflowRun,
  input: Omit<RecordTrustAuditInput, "kind" | "decision" | "source"> & { kind?: string }
): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
    ...input,
    kind: input.kind || "sandbox.host-attestation",
    decision: "recorded",
    source: "host-attested"
  });
}

// Per-request event log cache (v0.1.95). When set, readEvents returns
// memoized results keyed by event log path. Clears after each request.
let _eventLogCache: Map<string, TrustAuditEvent[]> | null = null;

export function setAuditEventCache(cache: Map<string, TrustAuditEvent[]>): void {
  _eventLogCache = cache;
}

export function clearAuditEventCache(): void {
  _eventLogCache = null;
}

export function listTrustAuditEvents(run: WorkflowRun): TrustAuditEvent[] {
  const audit = ensureTrustAudit(run);
  if (_eventLogCache) {
    const cached = _eventLogCache.get(audit.eventLogPath);
    if (cached) return cached;
  }
  const events = readEventsRaw(audit.eventLogPath).events.sort(compareEvents);
  _eventLogCache?.set(audit.eventLogPath, events);
  return events;
}

/** Search audit events by kind, worker, or candidate (v0.1.65).
 *  Filters are AND-ed; empty filters match all. */
export function searchAuditEvents(
  run: WorkflowRun,
  filters: { kind?: string; workerId?: string; candidateId?: string; limit?: number }
): TrustAuditEvent[] {
  let events = listTrustAuditEvents(run);
  if (filters.kind) events = events.filter((e) => e.kind === filters.kind);
  if (filters.workerId) events = events.filter((e) => e.workerId === filters.workerId);
  if (filters.candidateId) events = events.filter((e) => e.candidateId === filters.candidateId);
  if (filters.limit && filters.limit > 0) events = events.slice(0, filters.limit);
  return events;
}

export function summarizeTrustAudit(run: WorkflowRun): TrustAuditSummary {
  const audit = ensureTrustAudit(run);
  const events = readEvents(audit.eventLogPath);
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
    bySandboxProfile: countBy(events.filter((event) => event.sandboxProfileId), (event) => event.sandboxProfileId || "none"),
    workers: workerRows(events, run),
    candidates: candidateRows(events, run),
    commits: commitRows(events, run)
    ,
    multiAgent: {
      runs: run.multiAgent?.runs.length || 0,
      roles: run.multiAgent?.roles.length || 0,
      groups: run.multiAgent?.groups.length || 0,
      memberships: run.multiAgent?.memberships.length || 0,
      fanouts: run.multiAgent?.fanouts.length || 0,
      fanins: run.multiAgent?.fanins.length || 0,
      events: events.filter((event) =>
        Boolean(
          event.multiAgentRunId ||
            event.agentRoleId ||
            event.agentGroupId ||
            event.agentMembershipId ||
            event.agentFanoutId ||
            event.agentFaninId
        )
      ).length
    },
    blackboard: {
      boards: run.blackboard?.boards.length || 0,
      topics: run.blackboard?.topics.length || 0,
      messages: run.blackboard?.messages.length || 0,
      contexts: run.blackboard?.contexts.length || 0,
      artifacts: run.blackboard?.artifacts.length || 0,
      snapshots: run.blackboard?.snapshots.length || 0,
      decisions: run.blackboard?.decisions.length || 0,
      events: events.filter((event) =>
        Boolean(
          event.blackboardId ||
            event.blackboardTopicId ||
            event.blackboardMessageId ||
            event.blackboardContextId ||
            event.blackboardArtifactRefId ||
            event.blackboardSnapshotId ||
          event.coordinatorDecisionId
        )
      ).length
    },
    topologies: {
      runs: run.topologies?.runs.length || 0,
      events: events.filter((event) => Boolean(event.topologyId || event.topologyRunId || event.kind.startsWith("topology."))).length
    },
    multiAgentTrust: {
      rolePolicies: events.filter((event) => event.kind === "multi-agent.role-policy").length,
      permissionDecisions: events.filter((event) => event.kind === "multi-agent.permission").length,
      blackboardWrites: events.filter((event) => event.kind === "blackboard.write").length,
      messageProvenance: events.filter((event) => event.kind === "blackboard.message-provenance").length,
      judgeRationales: events.filter((event) => event.kind === "judge.rationale").length,
      panelDecisions: events.filter((event) => event.kind === "judge.panel-decision").length,
      policyViolations: events.filter((event) => event.kind === "policy.violation").length
    }
  };
  // Durable (v0.1.40 self-audit P1): the summary/index are the read-side view of
  // the audit log; persist them durably so a crash can't leave them pointing past
  // the last durably-appended event.
  writeJson(audit.summaryPath, summary, { durable: true });
  writeJson(audit.indexPath, {
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
      // Same single CORRELATION_ID_FIELDS list the record path uses, so the index
      // can never silently omit a correlation id that the event carries. (The index
      // historically omitted scoreId; that is preserved below by deleting it after
      // the pick, keeping this writer's output byte-identical.)
      ...indexCorrelationIds(event),
      sandboxProfileId: event.sandboxProfileId,
      policyRef: event.policyRef,
      multiAgentPolicyRef: event.multiAgentPolicyRef
    }))
  }, { durable: true });
  run.audit = audit;
  return summary;
}

export function refreshTrustAudit(run: WorkflowRun): TrustAuditSummary {
  const audit = { ...trustAuditPaths(run) };
  fs.mkdirSync(path.dirname(audit.eventLogPath), { recursive: true });
  if (!fs.existsSync(audit.eventLogPath)) fs.writeFileSync(audit.eventLogPath, "", "utf8");
  run.audit = audit;
  return summarizeTrustAudit(run);
}

export function workerTrustAudit(run: WorkflowRun, workerId: string): { workerId: string; events: TrustAuditEvent[] } {
  return { workerId, events: listTrustAuditEvents(run).filter((event) => event.workerId === workerId) };
}

export function normalizeEvidence(
  run: WorkflowRun,
  evidence: StateEvidence[],
  provenance: Partial<EvidenceProvenance>
): StateEvidence[] {
  const baseDirs = [run.cwd, run.paths.runDir].filter(Boolean) as string[];
  return evidence.map((entry) => ({
    ...entry,
    // Auto-compute confidence tier from locator shape + (in strict mode) filesystem.
    // "verified" is never auto-assigned — requires explicit host attestation (v0.1.55).
    confidence: entry.confidence || computeEvidenceConfidence(entry.locator || entry.path || entry.summary, baseDirs),
    // Extract actual file content for file-style evidence locators (v0.1.74).
    contentPreview: entry.contentPreview || (
      (entry.locator || entry.path) ? extractEvidenceContent(entry.locator || entry.path || "", baseDirs) : undefined
    ),
    provenance: {
      schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
      runId: run.id,
      source: provenance.source || entry.provenance?.source || "runtime-derived",
      workerId: provenance.workerId || entry.provenance?.workerId,
      taskId: provenance.taskId || entry.provenance?.taskId,
      resultNodeId: provenance.resultNodeId || entry.provenance?.resultNodeId,
      verifierNodeId: provenance.verifierNodeId || entry.provenance?.verifierNodeId,
      candidateId: provenance.candidateId || entry.provenance?.candidateId,
      scoreId: provenance.scoreId || entry.provenance?.scoreId,
      selectionId: provenance.selectionId || entry.provenance?.selectionId,
      commitId: provenance.commitId || entry.provenance?.commitId,
      parentEvidenceIds: unique([...(entry.provenance?.parentEvidenceIds || []), ...(provenance.parentEvidenceIds || [])]).sort(),
      auditEventIds: unique([...(entry.provenance?.auditEventIds || []), ...(provenance.auditEventIds || [])]).sort(),
      note: provenance.note || entry.provenance?.note
    }
  }));
}

export function evidenceProvenance(run: WorkflowRun, options: { candidateId?: string; commitId?: string; workerId?: string } = {}): {
  runId: string;
  evidence: StateEvidence[];
  events: TrustAuditEvent[];
} {
  const events = listTrustAuditEvents(run).filter((event) => {
    if (options.candidateId && event.candidateId !== options.candidateId) return false;
    if (options.commitId && event.commitId !== options.commitId) return false;
    if (options.workerId && event.workerId !== options.workerId) return false;
    return true;
  });
  const evidence: StateEvidence[] = [];
  for (const node of run.nodes || []) evidence.push(...(node.evidence || []));
  for (const candidate of run.candidates || []) evidence.push(...(candidate.evidence || []));
  for (const selection of run.candidateSelections || []) evidence.push(...(selection.evidence || []));
  for (const commit of run.commits || []) evidence.push(...(commit.evidence || []));
  const filtered = evidence.filter((entry) => {
    if (options.candidateId && entry.provenance?.candidateId !== options.candidateId) return false;
    if (options.commitId && entry.provenance?.commitId !== options.commitId) return false;
    if (options.workerId && entry.provenance?.workerId !== options.workerId) return false;
    return true;
  });
  return { runId: run.id, evidence: filtered, events };
}

export function validateAcceptanceRationale(rationale: AcceptanceRationale | undefined): string[] {
  if (!rationale) return ["acceptance rationale is missing"];
  const failures: string[] = [];
  if (!rationale.selectedCandidateId) failures.push("selected candidate id is missing");
  if (!rationale.scoreId) failures.push("score id is missing");
  if (!rationale.verifierNodeId) failures.push("verifier node id is missing");
  if (!rationale.evidenceCount) failures.push("evidence count is zero");
  if (!rationale.workerId) failures.push("worker id is missing");
  if (!rationale.sandboxProfileId) failures.push("sandbox profile id is missing");
  if (rationale.commitGateResult !== "passed") failures.push("commit gate result is not passed");
  return failures;
}

export function buildAcceptanceRationale(input: Partial<AcceptanceRationale>): AcceptanceRationale {
  return {
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
    selectedCandidateId: input.selectedCandidateId,
    scoreId: input.scoreId,
    scoreCriteria: input.scoreCriteria,
    verifierNodeId: input.verifierNodeId,
    evidenceCount: input.evidenceCount || 0,
    sandboxProfileId: input.sandboxProfileId,
    workerId: input.workerId,
    commitGateResult: input.commitGateResult,
    auditEventIds: unique(input.auditEventIds || []).sort()
  };
}

function auditRoot(run: WorkflowRun): string {
  return run.paths.auditDir || path.join(run.paths.runDir, "audit");
}

function readEvents(eventLogPath: string): TrustAuditEvent[] {
  if (_eventLogCache) {
    const cached = _eventLogCache.get(eventLogPath);
    if (cached) return cached;
  }
  const events = readEventsRaw(eventLogPath).events.sort(compareEvents);
  _eventLogCache?.set(eventLogPath, events);
  return events;
}

function workerRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["workers"] {
  const workerIds = unique([...(run.workers || []).map((worker) => worker.id), ...events.map((event) => event.workerId || "")]).sort();
  return workerIds.filter(Boolean).map((workerId) => {
    const worker = (run.workers || []).find((entry) => entry.id === workerId);
    const scoped = events.filter((event) => event.workerId === workerId);
    return {
      workerId,
      taskId: worker?.taskId || scoped.find((event) => event.taskId)?.taskId,
      sandboxProfileId: worker?.sandboxProfileId || scoped.find((event) => event.sandboxProfileId)?.sandboxProfileId,
      decisions: countBy(scoped, (event) => event.decision),
      denied: scoped.filter((event) => event.decision === "denied" || event.decision === "rejected").length,
      feedbackIds: unique(scoped.flatMap((event) => event.feedbackIds || [])).sort()
    };
  });
}

function candidateRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["candidates"] {
  const ids = unique([...(run.candidates || []).map((candidate) => candidate.id), ...events.map((event) => event.candidateId || "")]).sort();
  return ids.filter(Boolean).map((candidateId) => {
    const candidate = (run.candidates || []).find((entry) => entry.id === candidateId);
    const selections = (run.candidateSelections || []).filter((selection) => selection.candidateId === candidateId);
    const scoped = events.filter((event) => event.candidateId === candidateId);
    return {
      candidateId,
      scoreIds: unique([...(candidate?.scores || []), ...scoped.map((event) => event.scoreId || "")]).filter(Boolean).sort(),
      selectionIds: unique([...selections.map((selection) => selection.id), ...scoped.map((event) => event.selectionId || "")]).filter(Boolean).sort(),
      evidenceCount: candidate?.evidence.length || scoped.flatMap((event) => event.evidence || []).length
    };
  });
}

function commitRows(events: TrustAuditEvent[], run: WorkflowRun): TrustAuditSummary["commits"] {
  const ids = unique([...(run.commits || []).map((commit) => commit.id), ...events.map((event) => event.commitId || "")]).sort();
  return ids.filter(Boolean).map((commitId) => {
    const commit = (run.commits || []).find((entry) => entry.id === commitId);
    return {
      commitId,
      verifierGated: Boolean(commit?.verifierGated),
      candidateId: commit?.candidateId,
      selectionId: commit?.selectionId,
      evidenceCount: commit?.evidence?.length || 0,
      rationale: commit?.acceptanceRationale as Record<string, unknown> | undefined
    };
  });
}

function createEventId(run: WorkflowRun, kind: string): string {
  // Deterministic (FreeBSD-audit L12/L13): chain-local sequence (event-log length),
  // no wall-clock stamp — event.id is bound into the eventHash chain (computeEventHash),
  // so a stable id keeps the chain reproducible on replay.
  const count = readEvents(trustAuditPaths(run).eventLogPath).length + 1;
  return `audit-${safeFileName(kind)}-${String(count).padStart(4, "0")}`;
}

function redactPolicy(policy: ResolvedSandboxPolicy | undefined): ResolvedSandboxPolicy | undefined {
  if (!policy) return undefined;
  return {
    ...policy,
    env: {
      inherit: Boolean(policy.env.inherit),
      expose: unique((policy.env.expose || []).map(String)).sort(),
      deny: policy.env.deny ? unique(policy.env.deny.map(String)).sort() : undefined
    },
    metadata: scrubMetadata(policy.metadata || {})
  };
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

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function compareEvents(left: TrustAuditEvent, right: TrustAuditEvent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
