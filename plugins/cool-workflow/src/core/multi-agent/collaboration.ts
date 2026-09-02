// core/multi-agent/collaboration.ts — approvals/comments/handoffs,
// deriveReviewState (review-gate stacking rule).
//
// MILESTONE 9. Byte-exact port of the old build's collaboration module,
// minus recordTrustAuditEvent/saveCheckpoint calls (those are impure —
// see shell/collaboration-io.ts, which calls the pure builders here then
// wires the audit event + persist).
//
// BYTE-COMPAT / REBUILD RISK 8 [load-bearing]: `reviewGateErrors` STACKS
// on top of a verifier/selection gate — it can only ADD StateNodeErrors,
// never replace or suppress one. See reviewstack-verifier-error-
// precedence.case.js and SPEC/multi-agent.md invariant 7/8.
//
// Evidence: SPEC/multi-agent.md section F ("Team collaboration / review
// gate"), "Collaboration exact outputs"; the old build's collaboration
// module (byte-exact source).

import { StateNodeError } from "../state/types";
import { parseBoolFlag } from "../util/cli-args";
import { stableCompare } from "../util/collate";

export const COLLABORATION_SCHEMA_VERSION = 1 as const;

export type ActorKind = "operator" | "worker" | "role" | "membership" | "group" | "host" | "service" | "unattributed";
export type ActorAttestation = "host-attested" | "operator-recorded" | "unattributed" | "runtime-derived" | "cw-validated";
export type ApprovalDecision = "approve" | "reject";
export type CollaborationTargetKind = "run" | "task" | "candidate" | "selection" | "commit" | "node";
export type ReviewStatus = "approved" | "rejected" | "pending" | "blocked" | "unattributed";

export interface Actor {
  kind: ActorKind;
  id: string;
  displayName?: string;
  attestation: ActorAttestation;
  attested: boolean;
  roleId?: string;
  source: string;
}

/** The single, honest stand-in for an absent identity. */
export const UNATTRIBUTED_ACTOR: Actor = {
  kind: "unattributed",
  id: "unattributed",
  attestation: "unattributed",
  attested: false,
  source: "runtime-derived",
};

export interface CollaborationTarget {
  kind: CollaborationTargetKind;
  id: string;
}

export interface ApprovalRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  actor: Actor;
  decision: ApprovalDecision;
  target: CollaborationTarget;
  rationale?: string;
  roleId?: string;
  supersedes?: string;
  auditEventIds: string[];
  metadata?: Record<string, unknown>;
}

export interface CommentRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  actor: Actor;
  target: CollaborationTarget;
  body: string;
  threadId: string;
  parentId?: string;
  auditEventIds: string[];
}

export interface HandoffRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  actor: Actor;
  fromActor: Actor;
  toActor: Actor;
  target: CollaborationTarget;
  reason: string;
  auditEventIds: string[];
}

export interface ReviewGatePolicy {
  schemaVersion: 1;
  id: string;
  requiredApprovals: number;
  authorizedRoles: string[];
  allowSelfApproval: boolean;
  requireAttestedActor: boolean;
  appliesTo: CollaborationTargetKind[];
  updatedAt: string;
}

export interface DisqualifiedApproval {
  approvalId: string;
  actorId: string;
  reason: "unattributed" | "unauthorized-role" | "self-approval" | "superseded";
}

export interface ReviewState {
  schemaVersion: 1;
  runId: string;
  target: CollaborationTarget;
  status: ReviewStatus;
  gated: boolean;
  policyId?: string;
  requiredApprovals: number;
  recordedApprovals: number;
  approvers: string[];
  approvals: ApprovalRecord[];
  rejections: ApprovalRecord[];
  disqualified: DisqualifiedApproval[];
  missing: string[];
}

export interface CollaborationState {
  schemaVersion: 1;
  approvals: ApprovalRecord[];
  comments: CommentRecord[];
  handoffs: HandoffRecord[];
  policy?: ReviewGatePolicy;
}

export function emptyCollaborationState(): CollaborationState {
  return { schemaVersion: COLLABORATION_SCHEMA_VERSION, approvals: [], comments: [], handoffs: [] };
}

export interface ActorInput {
  actor?: string;
  actorKind?: string;
  displayName?: string;
  role?: string;
  roleId?: string;
  attested?: boolean;
  attestation?: ActorAttestation;
}

function trimmed(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const ACTOR_KINDS: ActorKind[] = ["operator", "worker", "role", "membership", "group", "host", "service", "unattributed"];

function normalizeActorKind(raw: string | undefined, roleId: string | undefined): ActorKind {
  const value = trimmed(raw);
  if (value && (ACTOR_KINDS as string[]).includes(value)) return value as ActorKind;
  if (roleId) return "role";
  return "operator";
}

function sourceForAttestation(attestation: ActorAttestation): string {
  if (attestation === "host-attested") return "host-attested";
  if (attestation === "operator-recorded") return "operator-recorded";
  return "runtime-derived";
}

/** Absent id -> the unattributed actor. Unknown kind falls back to
 *  "role" (if a role id is given) or "operator". */
export function normalizeActor(input: ActorInput | undefined): Actor {
  const id = trimmed(input?.actor);
  if (!id) return { ...UNATTRIBUTED_ACTOR };
  const roleId = trimmed(input?.roleId) || trimmed(input?.role);
  const kind = normalizeActorKind(input?.actorKind, roleId);
  const attestation: ActorAttestation = input?.attestation ? input.attestation : input?.attested ? "host-attested" : "operator-recorded";
  const attested = attestation === "host-attested";
  return { kind, id, displayName: trimmed(input?.displayName) || undefined, attestation, attested, roleId: roleId || undefined, source: sourceForAttestation(attestation) };
}

export function normalizeTarget(target: CollaborationTarget): CollaborationTarget {
  const kind = target?.kind;
  const id = trimmed(target?.id);
  if (!kind || !id) throw new Error("Collaboration target requires a kind and id");
  if (!(["run", "task", "candidate", "selection", "commit", "node"] as CollaborationTargetKind[]).includes(kind)) {
    throw new Error(`Unknown collaboration target kind: ${kind}`);
  }
  return { kind, id };
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}

/** Deterministic collab id: caller-supplied count (approvals/comments/
 *  handoffs length), no wall-clock stamp. */
export function createCollabId(kind: string, count: number): string {
  return `collab-${safeFileName(kind)}-${String(count + 1).padStart(4, "0")}`;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export interface RecordApprovalInput extends ActorInput {
  target: CollaborationTarget;
  decision: ApprovalDecision;
  rationale?: string;
  supersedes?: string;
}

/** Append-only: id shares the `approvals` array's length counter across
 *  approve/reject (a rejection right after an approval mints the NEXT
 *  sequence number, not its own). */
export function buildApproval(input: RecordApprovalInput, approvalCount: number, runId: string, now: string, auditEventId: string): ApprovalRecord {
  const actor = normalizeActor(input);
  const target = normalizeTarget(input.target);
  const decision: ApprovalDecision = input.decision === "reject" ? "reject" : "approve";
  return compact({
    schemaVersion: COLLABORATION_SCHEMA_VERSION,
    id: createCollabId(decision === "approve" ? "approval" : "rejection", approvalCount),
    runId,
    createdAt: now,
    actor,
    decision,
    target,
    rationale: trimmed(input.rationale) || undefined,
    roleId: actor.roleId,
    supersedes: trimmed(input.supersedes) || undefined,
    auditEventIds: [auditEventId],
    metadata: undefined,
  }) as unknown as ApprovalRecord;
}

export interface RecordCommentInput extends ActorInput {
  target: CollaborationTarget;
  body?: string;
  /** Body option-name fallbacks (old orchestrator wrapper contract): when
   *  `body` is empty the comment text is taken from `message`, then `text`.
   *  Restored so a caller that only set `message`/`text` still records the
   *  comment instead of tripping the fail-closed empty-body throw. */
  message?: string;
  text?: string;
  threadId?: string;
  parentId?: string;
}

export function buildComment(input: RecordCommentInput, commentCount: number, runId: string, now: string, auditEventId: string): CommentRecord {
  const actor = normalizeActor(input);
  const target = normalizeTarget(input.target);
  const body = trimmed(input.body) || trimmed(input.message) || trimmed(input.text);
  if (!body) throw new Error("Comment body is required");
  const threadId = trimmed(input.threadId) || `${target.kind}:${target.id}`;
  return compact({
    schemaVersion: COLLABORATION_SCHEMA_VERSION,
    id: createCollabId("comment", commentCount),
    runId,
    createdAt: now,
    actor,
    target,
    body,
    threadId,
    parentId: trimmed(input.parentId) || undefined,
    auditEventIds: [auditEventId],
  }) as unknown as CommentRecord;
}

export interface RecordHandoffInput extends ActorInput {
  target: CollaborationTarget;
  toActor?: string;
  toActorKind?: string;
  toRole?: string;
  toDisplayName?: string;
  toAttested?: boolean;
  fromActor?: string;
  fromActorKind?: string;
  fromRole?: string;
  reason: string;
}

export function buildHandoff(input: RecordHandoffInput, handoffCount: number, runId: string, now: string, auditEventId: string): HandoffRecord {
  const recorder = normalizeActor(input);
  const fromActor = input.fromActor ? normalizeActor({ actor: input.fromActor, actorKind: input.fromActorKind, role: input.fromRole, attested: input.attested }) : recorder;
  const toActor = normalizeActor({ actor: input.toActor, actorKind: input.toActorKind, role: input.toRole, displayName: input.toDisplayName, attested: input.toAttested });
  if (toActor.kind === "unattributed") throw new Error("Handoff requires a to-actor (--to)");
  const target = normalizeTarget(input.target);
  const reason = trimmed(input.reason) || "handoff";
  return compact({
    schemaVersion: COLLABORATION_SCHEMA_VERSION,
    id: createCollabId("handoff", handoffCount),
    runId,
    createdAt: now,
    actor: recorder,
    fromActor,
    toActor,
    target,
    reason,
    auditEventIds: [auditEventId],
  }) as unknown as HandoffRecord;
}

export interface ReviewPolicyInput {
  requiredApprovals?: number | string;
  authorizedRoles?: string[] | string;
  // Accept a raw string ("true"/"false"/"") as well as a real boolean —
  // CLI string options land here unparsed. Parsed via parseBoolFlag, which
  // reads "false"/"0"/"no"/"off"/"" as false and throws on anything it
  // does not recognize — a bare Boolean() coercion turned the string
  // "false" into true, silently ENABLING a gate flag the operator asked
  // to turn off (fail-open on --allow-self-approval false).
  allowSelfApproval?: boolean | string;
  requireAttestedActor?: boolean | string;
  appliesTo?: CollaborationTargetKind[] | string;
}

/** Parse a defined tri-state flag; leave `undefined` alone so the
 *  caller's `?? existing ?? default` chain still governs an unset flag. */
function coerceFlag(value: boolean | string | undefined, label: string): boolean | undefined {
  return parseBoolFlag(value, label);
}

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "" || value === true) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uniqueList<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function toStringList(value: string[] | string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  const list = Array.isArray(value) ? value : String(value).split(",");
  const cleaned = list.map((entry) => String(entry).trim()).filter(Boolean);
  return cleaned.length ? uniqueList(cleaned) : fallback;
}

function toTargetKindList(value: CollaborationTargetKind[] | string | undefined, fallback: CollaborationTargetKind[]): CollaborationTargetKind[] {
  if (value === undefined) return fallback;
  const list = Array.isArray(value) ? value : String(value).split(",");
  const valid: CollaborationTargetKind[] = ["run", "task", "candidate", "selection", "commit", "node"];
  const cleaned = list.map((entry) => String(entry).trim()).filter((entry): entry is CollaborationTargetKind => (valid as string[]).includes(entry));
  return cleaned.length ? uniqueList(cleaned) : fallback;
}

export function buildReviewPolicy(input: ReviewPolicyInput, existing: ReviewGatePolicy | undefined, now: string): ReviewGatePolicy {
  return {
    schemaVersion: COLLABORATION_SCHEMA_VERSION,
    id: existing?.id || createCollabId("policy", 0),
    requiredApprovals: Math.max(0, Math.floor(toNumber(input.requiredApprovals, existing?.requiredApprovals ?? 0))),
    authorizedRoles: toStringList(input.authorizedRoles, existing?.authorizedRoles ?? ["*"]),
    allowSelfApproval: coerceFlag(input.allowSelfApproval, "allowSelfApproval") ?? existing?.allowSelfApproval ?? false,
    requireAttestedActor: coerceFlag(input.requireAttestedActor, "requireAttestedActor") ?? existing?.requireAttestedActor ?? false,
    appliesTo: toTargetKindList(input.appliesTo, existing?.appliesTo ?? ["commit"]),
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// deriveReviewState — the fail-closed heart
// ---------------------------------------------------------------------------

export interface ReviewStateOptions {
  policy?: ReviewGatePolicy;
  relatedTargets?: CollaborationTarget[];
  selfActorIds?: string[];
}

function sameTarget(left: CollaborationTarget, right: CollaborationTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}
function matchesAnyTarget(target: CollaborationTarget, related: CollaborationTarget[]): boolean {
  return related.some((entry) => sameTarget(target, entry));
}
function compareByCreated<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return stableCompare(left.createdAt, right.createdAt) || stableCompare(left.id, right.id);
}

function disqualify(record: ApprovalRecord, policy: ReviewGatePolicy | undefined, selfIds: Set<string>): "unattributed" | "unauthorized-role" | "self-approval" | undefined {
  const actor = record.actor;
  if (actor.kind === "unattributed") return "unattributed";
  if (policy?.requireAttestedActor && !actor.attested) return "unattributed";
  if (policy && !roleAuthorized(actor.roleId, policy.authorizedRoles)) return "unauthorized-role";
  if (policy && !policy.allowSelfApproval && selfIds.has(actor.id)) return "self-approval";
  return undefined;
}

function roleAuthorized(roleId: string | undefined, authorizedRoles: string[]): boolean {
  if (authorizedRoles.includes("*")) return true;
  if (!roleId) return false;
  return authorizedRoles.includes(roleId);
}

/** Whether `record` itself counts for anything at all (same eligibility a
 *  record needs to be counted as an approval or a veto in the main loop
 *  below). A record that fails this can't void another record either —
 *  otherwise a disqualified self-approval could still cancel someone
 *  else's veto via `supersedes`. */
function recordCountsAtAll(record: ApprovalRecord, policy: ReviewGatePolicy | undefined, selfIds: Set<string>): boolean {
  const reason = disqualify(record, policy, selfIds);
  if (record.decision === "reject") return !reason || reason === "self-approval";
  return !reason;
}

function deriveStatus(gated: boolean, required: number, recorded: number, rejectionCount: number, disqualified: DisqualifiedApproval[]): ReviewStatus {
  if (!gated) return "approved";
  if (rejectionCount > 0) return "rejected";
  if (recorded >= required) return "approved";
  if (recorded === 0 && disqualified.length > 0) {
    const blocking = disqualified.filter((entry) => entry.reason !== "superseded");
    if (blocking.length > 0 && blocking.every((entry) => entry.reason === "unattributed")) return "unattributed";
    if (blocking.length > 0) return "blocked";
  }
  return "pending";
}

function buildMissing(status: ReviewStatus, gated: boolean, required: number, recorded: number, policy: ReviewGatePolicy | undefined, rejections: ApprovalRecord[], disqualified: DisqualifiedApproval[]): string[] {
  if (!gated || status === "approved") return [];
  const missing: string[] = [];
  if (status === "rejected") {
    for (const record of rejections) missing.push(`rejected by ${record.actor.id}${record.rationale ? ` (${record.rationale})` : ""}`);
    return missing;
  }
  const roles = policy?.authorizedRoles?.length ? policy.authorizedRoles.join(", ") : "*";
  missing.push(`${required - recorded} more approval(s) from authorized role(s) [${roles}] required (have ${recorded}/${required})`);
  const selfCount = disqualified.filter((entry) => entry.reason === "self-approval").length;
  const unattributedCount = disqualified.filter((entry) => entry.reason === "unattributed").length;
  const unauthorizedCount = disqualified.filter((entry) => entry.reason === "unauthorized-role").length;
  if (selfCount) missing.push(`${selfCount} self-approval(s) ignored (policy forbids self-approval)`);
  if (unattributedCount) missing.push(`${unattributedCount} unattributed approval(s) ignored`);
  if (unauthorizedCount) missing.push(`${unauthorizedCount} approval(s) from unauthorized role(s) ignored`);
  return missing;
}

/** Pure projection: derive a target's review state from append-only
 *  records + policy. Approvals are processed in createdAt-then-id order;
 *  only the FIRST approval per actor id counts. A reject with disqualify
 *  reason "self-approval" still counts as a veto; a reject from an
 *  unattributed/unauthorized actor is disqualified instead. */
export function deriveReviewState(runId: string, approvalsAll: ApprovalRecord[], target: CollaborationTarget, options: ReviewStateOptions = {}): ReviewState {
  const normalized = normalizeTarget(target);
  const policy = options.policy;
  const related = (options.relatedTargets && options.relatedTargets.length ? options.relatedTargets : [normalized]).map(normalizeTarget);
  const selfIds = new Set((options.selfActorIds || []).filter(Boolean));
  const approvals = approvalsAll.filter((record) => matchesAnyTarget(record.target, related));

  // A record's `supersedes` only takes effect when the target is that SAME
  // actor's own prior record (an actor may only supersede their own
  // record, never someone else's) and the superseding record itself is
  // eligible to count for something. Otherwise a disqualified record (e.g.
  // a self-approval a policy forbids) could still void another actor's
  // veto just by naming it in `supersedes`.
  const byId = new Map(approvals.map((record) => [record.id, record]));
  const supersededIds = new Set<string>();
  for (const record of approvals) {
    if (!record.supersedes) continue;
    const target = byId.get(record.supersedes);
    if (!target || target.actor.id !== record.actor.id) continue;
    if (!recordCountsAtAll(record, policy, selfIds)) continue;
    supersededIds.add(record.supersedes);
  }

  const gated = Boolean(policy && policy.requiredApprovals > 0 && policy.appliesTo.includes(normalized.kind));
  const required = gated ? policy!.requiredApprovals : 0;

  const counted: ApprovalRecord[] = [];
  const countedActorIds = new Set<string>();
  const rejections: ApprovalRecord[] = [];
  const disqualified: DisqualifiedApproval[] = [];

  for (const record of [...approvals].sort(compareByCreated)) {
    if (supersededIds.has(record.id)) {
      disqualified.push({ approvalId: record.id, actorId: record.actor.id, reason: "superseded" });
      continue;
    }
    const reason = disqualify(record, policy, selfIds);
    if (record.decision === "reject") {
      if (!reason || reason === "self-approval") rejections.push(record);
      else disqualified.push({ approvalId: record.id, actorId: record.actor.id, reason });
      continue;
    }
    if (reason) {
      disqualified.push({ approvalId: record.id, actorId: record.actor.id, reason });
      continue;
    }
    if (!countedActorIds.has(record.actor.id)) {
      countedActorIds.add(record.actor.id);
      counted.push(record);
    }
  }

  const recordedApprovals = countedActorIds.size;
  const status = deriveStatus(gated, required, recordedApprovals, rejections.length, disqualified);
  const approvers = [...countedActorIds].sort();
  const missing = buildMissing(status, gated, required, recordedApprovals, policy, rejections, disqualified);

  return { schemaVersion: COLLABORATION_SCHEMA_VERSION, runId, target: normalized, status, gated, policyId: policy?.id, requiredApprovals: required, recordedApprovals, approvers, approvals: counted, rejections, disqualified, missing };
}

// ---------------------------------------------------------------------------
// Review-gate errors — STACKED on top of the verifier gate, never replacing it
// ---------------------------------------------------------------------------

export interface ReviewGateInput {
  targetKind: CollaborationTargetKind;
  commitId?: string;
  candidateId?: string;
  selectionId?: string;
  nodeId?: string;
  taskId?: string;
  selfActorIds?: string[];
  policy?: ReviewGatePolicy;
}

function gateTarget(input: ReviewGateInput): CollaborationTarget {
  if (input.targetKind === "commit") return { kind: "commit", id: input.commitId || "(pending)" };
  if (input.targetKind === "selection") return { kind: "selection", id: input.selectionId || "(pending)" };
  if (input.targetKind === "candidate") return { kind: "candidate", id: input.candidateId || "(pending)" };
  if (input.targetKind === "node") return { kind: "node", id: input.nodeId || "(pending)" };
  if (input.targetKind === "task") return { kind: "task", id: input.taskId || "(pending)" };
  return { kind: "run", id: input.commitId || input.candidateId || input.selectionId || "(pending)" };
}

function gateRelatedTargets(input: ReviewGateInput): CollaborationTarget[] {
  const related: CollaborationTarget[] = [];
  if (input.commitId) related.push({ kind: "commit", id: input.commitId });
  if (input.selectionId) related.push({ kind: "selection", id: input.selectionId });
  if (input.candidateId) related.push({ kind: "candidate", id: input.candidateId });
  if (input.nodeId) related.push({ kind: "node", id: input.nodeId });
  if (input.taskId) related.push({ kind: "task", id: input.taskId });
  if (!related.length) related.push(gateTarget(input));
  return related;
}

/** The StateNodeErrors a review gate contributes. Empty when the target
 *  is not gated or the gate is satisfied — so it can only ADD
 *  constraints on top of a verifier gate's own errors, never remove
 *  them. Caller (candidate-scoring/commit-gate) appends this list to its
 *  own failure list. */
export function reviewGateErrors(runId: string, approvalsAll: ApprovalRecord[], input: ReviewGateInput, now: string): StateNodeError[] {
  const policy = input.policy;
  if (!policy || policy.requiredApprovals <= 0 || !policy.appliesTo.includes(input.targetKind)) return [];
  const target = gateTarget(input);
  const related = gateRelatedTargets(input);
  const state = deriveReviewState(runId, approvalsAll, target, { policy, relatedTargets: related, selfActorIds: input.selfActorIds });
  if (state.status === "approved") return [];
  return [
    {
      code: "review-gate-missing-approvals",
      message: `Review gate blocked (${state.status}): ${state.missing.join("; ")}`,
      at: now,
      retryable: false,
      details: { reviewStatus: state.status, requiredApprovals: state.requiredApprovals, recordedApprovals: state.recordedApprovals, approvers: state.approvers, missing: state.missing, policyId: state.policyId, targetKind: input.targetKind },
    },
  ];
}

export interface CommitReviewProvenance {
  policyId: string;
  requiredApprovals: number;
  recordedApprovals: number;
  approvers: string[];
  approvalIds: string[];
  target: CollaborationTarget;
}

export function commitReviewProvenance(runId: string, approvalsAll: ApprovalRecord[], input: ReviewGateInput): CommitReviewProvenance | undefined {
  const policy = input.policy;
  if (!policy || policy.requiredApprovals <= 0 || !policy.appliesTo.includes(input.targetKind)) return undefined;
  const target = gateTarget(input);
  const state = deriveReviewState(runId, approvalsAll, target, { policy, relatedTargets: gateRelatedTargets(input), selfActorIds: input.selfActorIds });
  if (state.status !== "approved") return undefined;
  return { policyId: policy.id, requiredApprovals: state.requiredApprovals, recordedApprovals: state.recordedApprovals, approvers: state.approvers, approvalIds: state.approvals.map((record) => record.id).sort(), target };
}

// ---------------------------------------------------------------------------
// Reports / timeline / formatters
// ---------------------------------------------------------------------------

export interface CollaborationTimelineEntry {
  kind: "approval" | "comment" | "handoff" | "policy";
  id: string;
  createdAt: string;
  actor: Actor;
  target?: CollaborationTarget;
  summary: string;
}

export interface ReviewStatusReport {
  schemaVersion: 1;
  surface: "collaboration";
  runId: string;
  generatedAt: string;
  policy?: ReviewGatePolicy;
  owner?: Actor;
  targets: ReviewState[];
  counts: { approvals: number; rejections: number; comments: number; handoffs: number };
  timeline: CollaborationTimelineEntry[];
  nextActions: string[];
}

export function deriveOwner(handoffs: HandoffRecord[]): Actor | undefined {
  const relevant = [...handoffs].filter((record) => record.target.kind === "run" || record.target.kind === "task").sort(compareByCreated);
  return relevant.length ? relevant[relevant.length - 1].toActor : undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function buildTimeline(state: CollaborationState): CollaborationTimelineEntry[] {
  const entries: CollaborationTimelineEntry[] = [];
  for (const record of state.approvals) {
    entries.push({ kind: "approval", id: record.id, createdAt: record.createdAt, actor: record.actor, target: record.target, summary: `${record.decision === "approve" ? "approved" : "rejected"} ${record.target.kind} ${record.target.id}${record.rationale ? ` — ${record.rationale}` : ""}` });
  }
  for (const record of state.comments) {
    entries.push({ kind: "comment", id: record.id, createdAt: record.createdAt, actor: record.actor, target: record.target, summary: `commented on ${record.target.kind} ${record.target.id}: ${truncate(record.body, 80)}` });
  }
  for (const record of state.handoffs) {
    entries.push({ kind: "handoff", id: record.id, createdAt: record.createdAt, actor: record.actor, target: record.target, summary: `handed off ${record.target.kind} ${record.target.id}: ${record.fromActor.id} → ${record.toActor.id} (${record.reason})` });
  }
  if (state.policy) {
    const policy = state.policy;
    entries.push({
      kind: "policy",
      id: policy.id,
      createdAt: policy.updatedAt,
      actor: { ...UNATTRIBUTED_ACTOR, kind: "operator", id: "operator", attestation: "operator-recorded", source: "operator-recorded" },
      summary: `review policy: ${policy.requiredApprovals} approval(s) from [${policy.authorizedRoles.join(", ")}] for [${policy.appliesTo.join(", ")}]`,
    });
  }
  return entries.sort(compareByCreated);
}

export function buildNextActions(runId: string, states: ReviewState[], policy: ReviewGatePolicy | undefined): string[] {
  const actions: string[] = [];
  if (!policy) {
    actions.push(`cw review policy ${runId} --requiredApprovals 1 --authorizedRoles reviewer --appliesTo commit`);
    return actions;
  }
  for (const state of states) {
    if (state.status === "pending" || state.status === "blocked" || state.status === "unattributed") {
      actions.push(`cw approve ${state.target.kind} ${runId} ${state.target.id} --role <authorized-role> --actor <id> --attested`);
    }
  }
  if (!actions.length) actions.push(`cw review status ${runId} --json`);
  return actions;
}

/** Self ids for a candidate/selection target: its producing worker +
 *  selector(s). Pure form of the old build's selfActorIdsForCandidate —
 *  the caller resolves the candidate's workerId and any matching
 *  selections' selectedBy values (shell/candidate-scoring-io.ts has the
 *  WorkflowRun-shaped lookups this needs). */
export function selfActorIdsForCandidate(workerId: string | undefined, selectedByIds: string[]): string[] {
  const ids = new Set<string>();
  if (workerId) ids.add(workerId);
  for (const id of selectedByIds) if (id) ids.add(id);
  return [...ids];
}

export function listComments(state: CollaborationState, target?: CollaborationTarget): CommentRecord[] {
  const filtered = target ? state.comments.filter((record) => sameTarget(record.target, normalizeTarget(target))) : state.comments;
  return [...filtered].sort(compareByCreated);
}

export function distinctTargets(state: CollaborationState): CollaborationTarget[] {
  const seen = new Map<string, CollaborationTarget>();
  const targetKey = (target: CollaborationTarget): string => `${target.kind}:${target.id}`;
  for (const record of state.approvals) seen.set(targetKey(record.target), record.target);
  for (const record of state.comments) seen.set(targetKey(record.target), record.target);
  for (const record of state.handoffs) seen.set(targetKey(record.target), record.target);
  return [...seen.values()].sort((left, right) => stableCompare(targetKey(left), targetKey(right)));
}

export function formatReviewStatus(report: ReviewStatusReport): string {
  const lines: string[] = [];
  const policy = report.policy;
  lines.push(`review ${report.runId}  policy=${policy ? `${policy.requiredApprovals} from [${policy.authorizedRoles.join(",")}] on [${policy.appliesTo.join(",")}]` : "none"}`);
  if (report.owner) lines.push(`  owner: ${report.owner.id} (${report.owner.attestation})`);
  lines.push(`  counts: approvals=${report.counts.approvals} rejections=${report.counts.rejections} comments=${report.counts.comments} handoffs=${report.counts.handoffs}`);
  for (const state of report.targets) {
    lines.push(`  ${state.target.kind} ${state.target.id}: ${state.status}` + (state.gated ? ` (${state.recordedApprovals}/${state.requiredApprovals}${state.approvers.length ? ` by ${state.approvers.join(",")}` : ""})` : " (not gated)"));
    for (const note of state.missing) lines.push(`    - ${note}`);
  }
  if (report.timeline.length) {
    lines.push("  timeline:");
    for (const entry of report.timeline) lines.push(`    ${entry.createdAt}  ${entry.actor.id}  ${entry.summary}`);
  }
  return lines.join("\n");
}

export function formatCommentList(comments: CommentRecord[]): string {
  if (!comments.length) return "no comments";
  return comments.map((record) => `${record.createdAt}  ${record.actor.id} (${record.actor.attestation})  [${record.target.kind} ${record.target.id}]  ${record.body}`).join("\n");
}
