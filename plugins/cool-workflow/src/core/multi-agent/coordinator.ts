// core/multi-agent/coordinator.ts — blackboard/topic/message/context/
// artifact/decision kernel.
//
// MILESTONE 9. Byte-exact port of the DECISION half of the old build's
// coordinator module (plus its util/classify/paths helper modules): record
// shape construction, conflict detection, author/scope normalization,
// the status classifiers, link derivation, and the digest/graph
// projections. Audit-event recording and disk persistence are the
// caller's job — see shell/coordinator-io.ts.
//
// Evidence: SPEC/multi-agent.md section C ("Coordinator / blackboard");
// the old build's coordinator module and its util/classify/paths helper
// modules (byte-exact source).

import { stableCompare } from "../util/collate";

export const BLACKBOARD_SCHEMA_VERSION = 1;

export type BlackboardRecordStatus = "active" | "open" | "resolved" | "superseded" | "conflicting" | "rejected";
export type BlackboardContextKind = "fact" | "constraint" | "assumption" | "question" | "decision";
export type CoordinatorDecisionKind = "artifact-index" | "fanin-readiness" | "candidate-synthesis" | "message-moderation" | "conflict-resolution" | "context-update" | string;
export type CoordinatorDecisionOutcome = "accepted" | "rejected" | "conflicting" | "blocked" | "superseded";

export interface BlackboardAuthor {
  kind: "runtime" | "coordinator" | "operator" | "role" | "group" | "membership" | "worker" | "verifier";
  id: string;
  displayName?: string;
}

export interface BlackboardScope {
  kind: string;
  id: string;
}

export interface BlackboardLinks {
  workflowRunId?: string;
  multiAgentRunId?: string;
  agentGroupId?: string;
  agentRoleId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  taskId?: string;
  workerId?: string;
  candidateId?: string;
  verifierNodeId?: string;
  commitId?: string;
  auditEventIds?: string[];
  evidenceRefs?: string[];
  blackboardId?: string;
  blackboardTopicIds?: string[];
}

/** Dedup, SORTS. Coordinator-side sorting `unique` — byte-identical
 *  behavior to core/multi-agent/runtime.ts's own copy, kept as a
 *  separate local function since the old build kept its own private
 *  copy in coordinator/util.ts too (see runtime.ts's file header). */
export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function sortTags(values: string[] | undefined): string[] {
  return unique(values || []);
}

export function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && (!Array.isArray(entry) || entry.length > 0)));
}

export function truncate(value: string): string {
  return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}

export function touch<T extends { updatedAt: string }>(record: T, now: string): T {
  record.updatedAt = now;
  return record;
}

export function compareRecords(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number {
  return compareBytes(left.createdAt, right.createdAt) || compareBytes(left.id, right.id);
}

function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createId(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export function indexRow(record: { id: string; status?: string; updatedAt?: string; blackboardId?: string; topicId?: string }): Record<string, unknown> {
  return { id: record.id, blackboardId: record.blackboardId, topicId: record.topicId, status: record.status, updatedAt: record.updatedAt };
}

export function assertUnique(items: Array<{ id: string }>, id: string, label: string): void {
  if (items.some((item) => item.id === id)) throw new Error(`Duplicate ${label} id: ${id}`);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}

export function assertNoRecordPathCollisions(label: string, records: Array<{ id: string }>): void {
  const seen = new Map<string, string>();
  for (const record of records) {
    const safe = safeFileName(record.id);
    const existing = seen.get(safe);
    if (existing && existing !== record.id) {
      throw new Error(`${label} ids ${existing} and ${record.id} collide on safe file name ${safe}`);
    }
    seen.set(safe, record.id);
  }
}

type GraphEdge = { from: string; to: string; label?: string };
export function uniqueEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

/** Recursive secret redaction: keys matching secret/token/password/
 *  credential/authorization/api-key/env become "[redacted]"; string
 *  values matching secret/token/password/credential become
 *  "[redacted]" too. Recurses into nested objects and arrays. */
const SECRET_KEY_RE = /secret|token|password|credential|authorization|api[_-]?key|env/i;
const SECRET_VALUE_RE = /secret|token|password|credential/i;

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") return scrub(value as Record<string, unknown>);
  if (typeof value === "string" && SECRET_VALUE_RE.test(value)) return "[redacted]";
  return value;
}

export function scrub(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    result[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : scrubValue(entry);
  }
  return Object.keys(result).length ? result : undefined;
}

// ---------------------------------------------------------------------------
// Status/source classifiers (coordinator/classify.ts) — kept as a
// SEPARATE table from multi-agent/runtime.ts's statusToNodeStatus (byte-
// compat / rebuild risk 7: different default — "completed" here vs
// "pending" there — collapsing them changes graph output and eval
// dependency_parity).
// ---------------------------------------------------------------------------

export function coordinatorStatusToNodeStatus(status: string): "pending" | "running" | "completed" | "blocked" | "failed" | "rejected" {
  switch (status) {
    case "active":
    case "open":
      return "running";
    case "resolved":
    case "superseded":
      return "completed";
    case "conflicting":
      return "blocked";
    case "rejected":
      return "rejected";
    default:
      return "completed";
  }
}

export function decisionStatus(outcome: CoordinatorDecisionOutcome): BlackboardRecordStatus {
  if (outcome === "conflicting" || outcome === "blocked") return "conflicting";
  if (outcome === "rejected") return "rejected";
  if (outcome === "superseded") return "superseded";
  return "active";
}

export function auditDecision(outcome: CoordinatorDecisionOutcome): "accepted" | "rejected" | "failed" {
  if (outcome === "rejected") return "rejected";
  if (outcome === "blocked" || outcome === "conflicting") return "failed";
  return "accepted";
}

export function sourceForAuthor(author: BlackboardAuthor): "runtime-derived" | "cw-validated" | "operator-recorded" {
  if (author.kind === "runtime" || author.kind === "coordinator") return "runtime-derived";
  if (author.kind === "worker" || author.kind === "verifier") return "cw-validated";
  return "operator-recorded";
}

// ---------------------------------------------------------------------------
// Author / scope / links normalization
// ---------------------------------------------------------------------------

/** No actor id + kind runtime/coordinator -> "cw"; kind operator -> "operator";
 *  any other kind with no id throws. */
export function normalizeAuthor(input: Partial<BlackboardAuthor> | undefined, fallbackKind: BlackboardAuthor["kind"]): BlackboardAuthor {
  const kind = input?.kind || fallbackKind;
  const id = input?.id || (kind === "runtime" || kind === "coordinator" ? "cw" : kind === "operator" ? "operator" : undefined);
  if (!id) throw new Error("Blackboard author requires an explicit id");
  return { kind, id, displayName: input?.displayName };
}

export function normalizeScope(input: Partial<BlackboardScope> | undefined, fallback: BlackboardScope): BlackboardScope {
  const kind = input?.kind || fallback.kind;
  const id = input?.id || fallback.id;
  if (!kind || !id) throw new Error("Blackboard scope requires kind and id");
  return { kind, id };
}

export function compactLinks(runId: string, input: Partial<BlackboardLinks>): BlackboardLinks {
  return compact({
    workflowRunId: runId,
    multiAgentRunId: input.multiAgentRunId,
    agentGroupId: input.agentGroupId,
    agentRoleId: input.agentRoleId,
    agentMembershipId: input.agentMembershipId,
    agentFanoutId: input.agentFanoutId,
    agentFaninId: input.agentFaninId,
    taskId: input.taskId,
    workerId: input.workerId,
    candidateId: input.candidateId,
    verifierNodeId: input.verifierNodeId,
    commitId: input.commitId,
    auditEventIds: unique(input.auditEventIds || []),
    evidenceRefs: unique(input.evidenceRefs || []),
  }) as unknown as BlackboardLinks;
}

export function roleLinkFromAuthor(author: Partial<BlackboardAuthor> | undefined): Partial<BlackboardLinks> {
  if (!author?.id) return {};
  if (author.kind === "role") return { agentRoleId: author.id };
  if (author.kind === "group") return { agentGroupId: author.id };
  if (author.kind === "membership") return { agentMembershipId: author.id };
  if (author.kind === "worker") return { workerId: author.id };
  return {};
}

/** Policy is enforced when the author kind is role/group/membership/
 *  worker or the resolved links carry an agent role/group/membership
 *  id. */
export function shouldEnforcePolicy(author: BlackboardAuthor, links: BlackboardLinks): boolean {
  if (author.kind === "role" || author.kind === "group" || author.kind === "membership" || author.kind === "worker") return true;
  return Boolean(links.agentRoleId || links.agentGroupId || links.agentMembershipId);
}

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

interface BlackboardBaseFields {
  schemaVersion: 1;
  id: string;
  runId: string;
  blackboardId: string;
  createdAt: string;
  updatedAt: string;
  author: BlackboardAuthor;
  scope: BlackboardScope;
  status: BlackboardRecordStatus;
  parentIds: string[];
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface Blackboard {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  author: BlackboardAuthor;
  scope: BlackboardScope;
  status: "active";
  parentIds: string[];
  tags: string[];
  title: string;
  topicIds: string[];
  messageCount: number;
  contextIds: string[];
  artifactRefIds: string[];
  snapshotIds: string[];
  decisionIds: string[];
  links: BlackboardLinks;
  paths: { root: string; index: string; messages: string; topicsDir: string; contextsDir: string; artifactsDir: string; snapshotsDir: string; decisionsDir: string };
  metadata?: Record<string, unknown>;
}

export interface BlackboardTopic extends BlackboardBaseFields {
  title: string;
  description?: string;
  messageIds: string[];
  contextIds: string[];
  artifactRefIds: string[];
  links: BlackboardLinks;
}

export interface BlackboardMessageProvenance {
  schemaVersion: 1;
  authorKind: string;
  authorId: string;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  workerId?: string;
  source: string;
  linkedEvidenceRefs: string[];
  linkedAuditEventIds: string[];
  parentMessageIds: string[];
  topicScope: string;
  bodyHash: string;
  locator: string;
}

export interface BlackboardMessage extends BlackboardBaseFields {
  topicId: string;
  body: string;
  visibility: "public" | "private";
  replyToId?: string;
  parentIds: string[];
  linkedEvidenceRefs: string[];
  linkedArtifactRefIds: string[];
  linkedAuditEventIds: string[];
  links: BlackboardLinks;
  provenance: BlackboardMessageProvenance;
}

export interface BlackboardContext extends BlackboardBaseFields {
  topicId: string;
  kind: BlackboardContextKind;
  key: string;
  value: string;
  supersedesContextIds: string[];
  conflictingContextIds: string[];
  evidenceRefs: string[];
  artifactRefIds: string[];
  links: BlackboardLinks;
  supersededByContextId?: string;
  decisionId?: string;
}

export interface BlackboardArtifactRef extends BlackboardBaseFields {
  topicId?: string;
  kind: string;
  path?: string;
  locator?: string;
  owner: BlackboardAuthor;
  source: string;
  provenance: BlackboardLinks;
  evidenceRefs: string[];
  checksum?: string;
  trustAuditEventIds: string[];
}

export interface BlackboardSnapshot extends BlackboardBaseFields {
  topicIds: string[];
  messageIds: string[];
  contextIds: string[];
  artifactRefIds: string[];
  decisionIds: string[];
  snapshotPath: string;
  indexPath: string;
  summary: Record<string, unknown>;
  links: BlackboardLinks;
}

export interface CoordinatorDecision extends BlackboardBaseFields {
  kind: CoordinatorDecisionKind;
  outcome: CoordinatorDecisionOutcome;
  subjectIds: string[];
  reason: string;
  evidenceRefs: string[];
  artifactRefIds: string[];
  messageIds: string[];
  links: BlackboardLinks;
}

export interface BlackboardState {
  schemaVersion: 1;
  boards: Blackboard[];
  topics: BlackboardTopic[];
  messages: BlackboardMessage[];
  contexts: BlackboardContext[];
  artifacts: BlackboardArtifactRef[];
  snapshots: BlackboardSnapshot[];
  decisions: CoordinatorDecision[];
}

export function emptyBlackboardState(): BlackboardState {
  return { schemaVersion: BLACKBOARD_SCHEMA_VERSION, boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] };
}

function base(runId: string, blackboardId: string, id: string, now: string, author: BlackboardAuthor, scope: BlackboardScope, status: BlackboardRecordStatus, tags: string[] | undefined, metadata: Record<string, unknown> | undefined): BlackboardBaseFields {
  return {
    schemaVersion: BLACKBOARD_SCHEMA_VERSION,
    id,
    runId,
    blackboardId,
    createdAt: now,
    updatedAt: now,
    author,
    scope,
    status,
    parentIds: [],
    tags: sortTags(tags),
    metadata: scrub(metadata),
  };
}

// ---------------------------------------------------------------------------
// Pure record builders (persistence + audit calls are the shell's job)
// ---------------------------------------------------------------------------

export interface ResolveBlackboardInput {
  id?: string;
  title?: string;
  multiAgentRunId?: string;
  groupId?: string;
  roleId?: string;
  membershipId?: string;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function buildBlackboard(runId: string, input: ResolveBlackboardInput, id: string, now: string, paths: Blackboard["paths"]): Blackboard {
  const author = normalizeAuthor(input.author, "runtime");
  const scope = normalizeScope(input.scope, input.multiAgentRunId ? { kind: "multi-agent-run", id: input.multiAgentRunId } : { kind: "run", id: runId });
  return {
    schemaVersion: BLACKBOARD_SCHEMA_VERSION,
    id,
    runId,
    createdAt: now,
    updatedAt: now,
    author,
    scope,
    status: "active",
    parentIds: [],
    tags: sortTags(input.tags),
    title: input.title || id,
    topicIds: [],
    messageCount: 0,
    contextIds: [],
    artifactRefIds: [],
    snapshotIds: [],
    decisionIds: [],
    links: compactLinks(runId, { multiAgentRunId: input.multiAgentRunId, agentGroupId: input.groupId, agentRoleId: input.roleId, agentMembershipId: input.membershipId }),
    paths,
    metadata: scrub(input.metadata),
  };
}

export interface CreateTopicInput {
  id?: string;
  title: string;
  description?: string;
  blackboardId?: string;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function buildTopic(runId: string, board: Blackboard, input: CreateTopicInput, id: string, now: string): BlackboardTopic {
  const topicLinks = compactLinks(runId, { ...board.links, ...roleLinkFromAuthor(input.author), ...input.scope });
  return {
    ...base(runId, board.id, id, now, normalizeAuthor(input.author, "operator"), normalizeScope(input.scope, { kind: "run", id: runId }), "open", input.tags, input.metadata),
    title: input.title,
    description: input.description,
    messageIds: [],
    contextIds: [],
    artifactRefIds: [],
    links: topicLinks,
  };
}

export interface PostMessageInput {
  id?: string;
  topicId: string;
  body: string;
  blackboardId?: string;
  replyToId?: string;
  visibility?: BlackboardMessage["visibility"];
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  evidenceRefs?: string[];
  artifactRefIds?: string[];
  auditEventIds?: string[];
  links?: Partial<BlackboardLinks>;
  parentIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function buildMessage(runId: string, board: Blackboard, topic: BlackboardTopic, input: PostMessageInput, id: string, now: string, bodyHash: (text: string) => string, sourceForActor: (author: BlackboardAuthor) => string): BlackboardMessage {
  const author = normalizeAuthor(input.author, "operator");
  const links = compactLinks(runId, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
  const parentIds = unique([...(input.parentIds || []), ...(input.replyToId ? [input.replyToId] : [])]);
  return {
    ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), "active", input.tags, input.metadata),
    topicId: topic.id,
    body: input.body,
    visibility: input.visibility || "public",
    replyToId: input.replyToId,
    parentIds,
    linkedEvidenceRefs: unique(input.evidenceRefs || []),
    linkedArtifactRefIds: unique(input.artifactRefIds || []),
    linkedAuditEventIds: unique(input.auditEventIds || []),
    links,
    provenance: {
      schemaVersion: 1,
      authorKind: author.kind,
      authorId: author.id,
      multiAgentRunId: links.multiAgentRunId,
      agentRoleId: links.agentRoleId,
      agentGroupId: links.agentGroupId,
      agentMembershipId: links.agentMembershipId,
      agentFanoutId: links.agentFanoutId,
      agentFaninId: links.agentFaninId,
      workerId: links.workerId || (author.kind === "worker" ? author.id : undefined),
      source: sourceForActor(author),
      linkedEvidenceRefs: unique(input.evidenceRefs || []),
      linkedAuditEventIds: unique(input.auditEventIds || []),
      parentMessageIds: parentIds,
      topicScope: topic.id,
      bodyHash: bodyHash(input.body),
      locator: `${board.id}/messages/${id}`,
    },
  };
}

export interface PutContextInput {
  id?: string;
  topicId: string;
  kind: BlackboardContextKind;
  key?: string;
  value: string;
  blackboardId?: string;
  supersedesContextIds?: string[];
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  evidenceRefs?: string[];
  artifactRefIds?: string[];
  links?: Partial<BlackboardLinks>;
  parentIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface BuildContextResult {
  context: BlackboardContext;
  conflicts: BlackboardContext[];
}

/** Conflict detection: a same-board+topic+kind+key context with a
 *  DIFFERENT value that isn't already superseded (and isn't itself being
 *  superseded by this write) marks BOTH sides `conflicting`. */
export function buildContext(runId: string, board: Blackboard, topic: BlackboardTopic, input: PutContextInput, id: string, now: string, existingContexts: BlackboardContext[]): BuildContextResult {
  const key = input.key || input.kind;
  const author = normalizeAuthor(input.author, "operator");
  const links = compactLinks(runId, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs });
  const conflicts = existingContexts.filter(
    (context) =>
      context.blackboardId === board.id &&
      context.topicId === topic.id &&
      context.kind === input.kind &&
      context.key === key &&
      context.status !== "superseded" &&
      !input.supersedesContextIds?.includes(context.id) &&
      context.value !== input.value
  );
  const status: BlackboardRecordStatus = conflicts.length ? "conflicting" : input.kind === "question" ? "open" : "active";
  const context: BlackboardContext = {
    ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), status, input.tags, input.metadata),
    topicId: topic.id,
    kind: input.kind,
    key,
    value: input.value,
    supersedesContextIds: unique(input.supersedesContextIds || []),
    conflictingContextIds: conflicts.map((entry) => entry.id),
    evidenceRefs: unique(input.evidenceRefs || []),
    artifactRefIds: unique(input.artifactRefIds || []),
    links,
  };
  return { context, conflicts };
}

export interface AddArtifactInput {
  id?: string;
  topicId?: string;
  kind: string;
  path?: string;
  locator?: string;
  blackboardId?: string;
  owner?: Partial<BlackboardAuthor>;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  source?: string;
  provenance?: Partial<BlackboardLinks>;
  evidenceRefs?: string[];
  auditEventIds?: string[];
  links?: Partial<BlackboardLinks>;
  parentIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function buildArtifact(runId: string, board: Blackboard, topic: BlackboardTopic | undefined, input: AddArtifactInput, id: string, now: string, absolutePath: string | undefined, checksum: string | undefined): BlackboardArtifactRef {
  const author = normalizeAuthor(input.author, "operator");
  const links = compactLinks(runId, { ...board.links, ...(topic?.links || {}), ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
  return {
    ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), "active", input.tags, input.metadata),
    topicId: topic?.id,
    kind: input.kind,
    path: absolutePath,
    locator: input.locator,
    owner: normalizeAuthor(input.owner || input.author, "operator"),
    source: input.source || "operator-recorded",
    provenance: compactLinks(runId, { ...(input.provenance || {}), ...links }),
    evidenceRefs: unique(input.evidenceRefs || []),
    checksum,
    trustAuditEventIds: unique(input.auditEventIds || []),
  };
}

export function buildSnapshot(runId: string, board: Blackboard, id: string, now: string, snapshotPath: string, indexPath: string, summary: Record<string, unknown>, messageIds: string[]): BlackboardSnapshot {
  return {
    ...base(runId, board.id, id, now, { kind: "runtime", id: "cw" }, { kind: "run", id: runId }, "active", ["snapshot"], undefined),
    topicIds: [...board.topicIds].sort(),
    messageIds: [...messageIds].sort(),
    contextIds: [...board.contextIds].sort(),
    artifactRefIds: [...board.artifactRefIds].sort(),
    decisionIds: [...board.decisionIds].sort(),
    snapshotPath,
    indexPath,
    summary,
    links: compactLinks(runId, board.links),
  };
}

export interface RecordDecisionInput {
  id?: string;
  blackboardId?: string;
  kind: CoordinatorDecisionKind;
  outcome: CoordinatorDecisionOutcome;
  reason: string;
  subjectIds?: string[];
  topicId?: string;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  evidenceRefs?: string[];
  artifactRefIds?: string[];
  messageIds?: string[];
  parentIds?: string[];
  links?: Partial<BlackboardLinks>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function buildDecision(runId: string, board: Blackboard, input: RecordDecisionInput, id: string, now: string): CoordinatorDecision {
  const author = normalizeAuthor(input.author || { kind: "coordinator", id: "cw" }, "coordinator");
  return {
    ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), decisionStatus(input.outcome), input.tags, input.metadata),
    kind: input.kind,
    outcome: input.outcome,
    subjectIds: unique(input.subjectIds || []),
    reason: input.reason,
    evidenceRefs: unique(input.evidenceRefs || []),
    artifactRefIds: unique(input.artifactRefIds || []),
    messageIds: unique(input.messageIds || []),
    links: compactLinks(runId, { ...board.links, ...roleLinkFromAuthor(input.author), ...(input.links || {}), evidenceRefs: input.evidenceRefs }),
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface BlackboardSummary {
  runId: string;
  blackboardId?: string;
  topics: number;
  messages: number;
  contexts: number;
  artifacts: number;
  snapshots: number;
  decisions: number;
  openQuestions: BlackboardContext[];
  conflicts: BlackboardContext[];
  missingEvidence: string[];
  readyForFanin: boolean;
  latestSnapshotPath?: string;
  indexPath: string;
  nextAction?: string;
}

export function summarizeBlackboard(runId: string, state: BlackboardState, blackboardId: string | undefined, defaultIndexPath: string): BlackboardSummary {
  const board = blackboardId ? state.boards.find((entry) => entry.id === blackboardId) : state.boards[0];
  const scoped = <T extends { blackboardId: string }>(items: T[]): T[] => (board ? items.filter((item) => item.blackboardId === board.id) : []);
  const contexts = scoped(state.contexts);
  const artifacts = scoped(state.artifacts);
  const openQuestions = contexts.filter((context) => context.kind === "question" && context.status === "open");
  const conflicts = contexts.filter((context) => context.status === "conflicting" || context.conflictingContextIds.length);
  const missingEvidence = [
    ...openQuestions.filter((context) => !context.evidenceRefs.length && !context.artifactRefIds.length).map((context) => `question ${context.id} has no indexed evidence`),
    ...contexts.filter((context) => context.kind !== "question" && context.status !== "superseded" && !context.evidenceRefs.length && !context.artifactRefIds.length).map((context) => `context ${context.id} has no indexed evidence`),
  ].sort();
  const readyForFanin = Boolean(board && !openQuestions.length && !conflicts.length && artifacts.length > 0 && missingEvidence.length === 0);
  const latestSnapshot = scoped(state.snapshots)
    .sort((left, right) => stableCompare(left.createdAt, right.createdAt))
    .at(-1);
  return {
    runId,
    blackboardId: board?.id,
    topics: scoped(state.topics).length,
    messages: scoped(state.messages).length,
    contexts: contexts.length,
    artifacts: artifacts.length,
    snapshots: scoped(state.snapshots).length,
    decisions: scoped(state.decisions).length,
    openQuestions,
    conflicts,
    missingEvidence,
    readyForFanin,
    latestSnapshotPath: latestSnapshot?.snapshotPath,
    indexPath: board?.paths.index || defaultIndexPath,
    nextAction: nextAction(runId, board, openQuestions, conflicts, artifacts),
  };
}

function nextAction(runId: string, board: Blackboard | undefined, openQuestions: BlackboardContext[], conflicts: BlackboardContext[], artifacts: BlackboardArtifactRef[]): string | undefined {
  if (!board) return `cw blackboard topic create ${runId} --id <topic-id> --title "<title>"`;
  if (conflicts.length) return `cw coordinator decision ${runId} --kind conflict-resolution --outcome accepted --subject ${conflicts[0].id} --reason "<reason>"`;
  if (openQuestions.length) return `cw blackboard message post ${runId} --topic ${openQuestions[0].topicId} --body "<answer with evidence>"`;
  if (!artifacts.length) return `cw blackboard artifact add ${runId} --path <path> --kind <kind>`;
  return `cw blackboard snapshot ${runId}`;
}

export function listBlackboardMessages(state: BlackboardState, options: { topicId?: string; blackboardId?: string } = {}): BlackboardMessage[] {
  return state.messages
    .filter((message) => (!options.blackboardId || message.blackboardId === options.blackboardId) && (!options.topicId || message.topicId === options.topicId))
    .sort((left, right) => stableCompare(left.createdAt, right.createdAt) || stableCompare(left.id, right.id));
}

export function listBlackboardArtifacts(state: BlackboardState, options: { topicId?: string; blackboardId?: string } = {}): BlackboardArtifactRef[] {
  return state.artifacts
    .filter((artifact) => (!options.blackboardId || artifact.blackboardId === options.blackboardId) && (!options.topicId || artifact.topicId === options.topicId))
    .sort((left, right) => stableCompare(left.id, right.id));
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export interface BlackboardGraph {
  nodes: Array<{ id: string; kind: string; status: string; label: string; path?: string }>;
  edges: GraphEdge[];
}

export function buildBlackboardGraph(runId: string, state: BlackboardState, recordPath: (kind: string, id: string) => string, messagesPath: string): BlackboardGraph {
  const nodes: BlackboardGraph["nodes"] = [];
  const edges: GraphEdge[] = [];
  for (const board of state.boards) {
    nodes.push({ id: `${runId}:blackboard:${board.id}`, kind: "blackboard", status: board.status, label: board.title, path: board.paths.index });
    edges.push({ from: `${runId}:run`, to: `${runId}:blackboard:${board.id}` });
    if (board.links.multiAgentRunId) edges.push({ from: `${runId}:multi-agent:${board.links.multiAgentRunId}`, to: `${runId}:blackboard:${board.id}`, label: "coordinates" });
  }
  for (const topic of state.topics) {
    nodes.push({ id: `${runId}:blackboard:topic:${topic.id}`, kind: "blackboard-topic", status: topic.status, label: topic.title, path: recordPath("topics", topic.id) });
    edges.push({ from: `${runId}:blackboard:${topic.blackboardId}`, to: `${runId}:blackboard:topic:${topic.id}` });
  }
  for (const context of state.contexts) {
    nodes.push({ id: `${runId}:blackboard:context:${context.id}`, kind: "blackboard-context", status: context.status, label: `${context.kind}:${context.key}`, path: recordPath("contexts", context.id) });
    edges.push({ from: `${runId}:blackboard:topic:${context.topicId}`, to: `${runId}:blackboard:context:${context.id}` });
    for (const conflicting of context.conflictingContextIds) edges.push({ from: `${runId}:blackboard:context:${context.id}`, to: `${runId}:blackboard:context:${conflicting}`, label: "conflicts" });
  }
  for (const artifact of state.artifacts) {
    nodes.push({ id: `${runId}:blackboard:artifact:${artifact.id}`, kind: "blackboard-artifact", status: artifact.status, label: artifact.kind, path: recordPath("artifacts", artifact.id) });
    edges.push({ from: artifact.topicId ? `${runId}:blackboard:topic:${artifact.topicId}` : `${runId}:blackboard:${artifact.blackboardId}`, to: `${runId}:blackboard:artifact:${artifact.id}` });
  }
  for (const message of state.messages) {
    nodes.push({ id: `${runId}:blackboard:message:${message.id}`, kind: "blackboard-message", status: message.status, label: truncate(message.body), path: messagesPath });
    edges.push({ from: `${runId}:blackboard:topic:${message.topicId}`, to: `${runId}:blackboard:message:${message.id}` });
    if (message.replyToId) edges.push({ from: `${runId}:blackboard:message:${message.replyToId}`, to: `${runId}:blackboard:message:${message.id}`, label: "reply" });
    for (const artifactId of message.linkedArtifactRefIds) edges.push({ from: `${runId}:blackboard:message:${message.id}`, to: `${runId}:blackboard:artifact:${artifactId}`, label: "cites" });
  }
  for (const decision of state.decisions) {
    nodes.push({ id: `${runId}:coordinator:decision:${decision.id}`, kind: "coordinator-decision", status: decision.status, label: `${decision.kind}:${decision.outcome}`, path: recordPath("decisions", decision.id) });
    edges.push({ from: `${runId}:blackboard:${decision.blackboardId}`, to: `${runId}:coordinator:decision:${decision.id}` });
    for (const subjectId of decision.subjectIds) edges.push({ from: `${runId}:coordinator:decision:${decision.id}`, to: graphSubject(runId, state, subjectId), label: "subject" });
  }
  for (const snapshot of state.snapshots) {
    nodes.push({ id: `${runId}:blackboard:snapshot:${snapshot.id}`, kind: "blackboard-snapshot", status: snapshot.status, label: snapshot.id, path: snapshot.snapshotPath });
    edges.push({ from: `${runId}:blackboard:${snapshot.blackboardId}`, to: `${runId}:blackboard:snapshot:${snapshot.id}` });
  }
  return { nodes, edges: uniqueEdges(edges) };
}

function graphSubject(runId: string, state: BlackboardState, id: string): string {
  if (state.contexts.some((entry) => entry.id === id)) return `${runId}:blackboard:context:${id}`;
  if (state.artifacts.some((entry) => entry.id === id)) return `${runId}:blackboard:artifact:${id}`;
  if (state.messages.some((entry) => entry.id === id)) return `${runId}:blackboard:message:${id}`;
  return id;
}
