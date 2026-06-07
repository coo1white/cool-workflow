import fs from "node:fs";
import path from "node:path";
import {
  AcceptanceRationale,
  EvidenceProvenance,
  ResolvedSandboxPolicy,
  StateEvidence,
  TrustAuditDecision,
  TrustAuditEvent,
  TrustAuditSource,
  TrustAuditSummary,
  WorkflowRun
} from "./types";
import { safeFileName, writeJson } from "./state";

export const TRUST_AUDIT_SCHEMA_VERSION = 1;

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
  sandboxProfileId?: string;
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

export function ensureTrustAudit(run: WorkflowRun): Required<NonNullable<WorkflowRun["audit"]>> {
  const auditDir = auditRoot(run);
  fs.mkdirSync(auditDir, { recursive: true });
  run.paths.auditDir = auditDir;
  const audit = {
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION as 1,
    eventLogPath: path.join(auditDir, "events.jsonl"),
    summaryPath: path.join(auditDir, "summary.json"),
    indexPath: path.join(auditDir, "index.json")
  };
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
    candidateId: input.candidateId,
    scoreId: input.scoreId,
    selectionId: input.selectionId,
    commitId: input.commitId,
    multiAgentRunId: input.multiAgentRunId,
    agentRoleId: input.agentRoleId,
    agentGroupId: input.agentGroupId,
    agentMembershipId: input.agentMembershipId,
    agentFanoutId: input.agentFanoutId,
    agentFaninId: input.agentFaninId,
    sandboxProfileId: input.sandboxProfileId || input.policySnapshot?.id,
    policyRef: input.policySnapshot?.id ? `run.sandboxProfiles.${input.policySnapshot.id}` : undefined,
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
  fs.appendFileSync(audit.eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
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

export function listTrustAuditEvents(run: WorkflowRun): TrustAuditEvent[] {
  const audit = ensureTrustAudit(run);
  if (!fs.existsSync(audit.eventLogPath)) return [];
  return fs
    .readFileSync(audit.eventLogPath, "utf8")
    .split(/\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TrustAuditEvent)
    .sort(compareEvents);
}

export function summarizeTrustAudit(run: WorkflowRun): TrustAuditSummary {
  const audit = ensureTrustAudit(run);
  const events = readEvents(audit.eventLogPath);
  const summary: TrustAuditSummary = {
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
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
    }
  };
  writeJson(audit.summaryPath, summary);
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
      candidateId: event.candidateId,
      selectionId: event.selectionId,
      commitId: event.commitId,
      multiAgentRunId: event.multiAgentRunId,
      agentRoleId: event.agentRoleId,
      agentGroupId: event.agentGroupId,
      agentMembershipId: event.agentMembershipId,
      agentFanoutId: event.agentFanoutId,
      agentFaninId: event.agentFaninId,
      sandboxProfileId: event.sandboxProfileId
    }))
  });
  run.audit = audit;
  return summary;
}

export function refreshTrustAudit(run: WorkflowRun): TrustAuditSummary {
  const audit = {
    schemaVersion: TRUST_AUDIT_SCHEMA_VERSION as 1,
    eventLogPath: path.join(auditRoot(run), "events.jsonl"),
    summaryPath: path.join(auditRoot(run), "summary.json"),
    indexPath: path.join(auditRoot(run), "index.json")
  };
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
  return evidence.map((entry) => ({
    ...entry,
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
  if (!fs.existsSync(eventLogPath)) return [];
  return fs
    .readFileSync(eventLogPath, "utf8")
    .split(/\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TrustAuditEvent)
    .sort(compareEvents);
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
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const count = readEvents(path.join(auditRoot(run), "events.jsonl")).length + 1;
  return `audit-${safeFileName(kind)}-${stamp}-${String(count).padStart(4, "0")}`;
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
