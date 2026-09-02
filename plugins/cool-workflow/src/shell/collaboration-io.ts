// shell/collaboration-io.ts — the impure wrapper around
// core/multi-agent/collaboration.ts's pure record builders + review-state
// projection: recordApproval/recordComment/recordHandoff/setReviewPolicy/
// deriveReviewState/reviewGateErrors, plus the read-only reports.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// collaboration module: trust-audit recording + saveCheckpoint.
//
// Evidence: SPEC/multi-agent.md section F; the old build's collaboration
// module (byte-exact source for the wiring sequence).

import { WorkflowRun } from "../core/state/types";
import { recordTrustAuditEvent } from "./trust-audit";
import { saveCheckpoint } from "./run-store";
import * as collab from "../core/multi-agent/collaboration";

function now(): string {
  return new Date().toISOString();
}

function auditTargetFields(target: collab.CollaborationTarget): Record<string, string | undefined> {
  switch (target.kind) {
    case "candidate":
      return { candidateId: target.id };
    case "selection":
      return { selectionId: target.id };
    case "commit":
      return { commitId: target.id };
    case "node":
      return { nodeId: target.id };
    case "task":
      return { taskId: target.id };
    default:
      return {};
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function ensureCollaborationState(run: WorkflowRun): collab.CollaborationState {
  const existing = run.collaboration as unknown as collab.CollaborationState | undefined;
  const state: collab.CollaborationState = existing || collab.emptyCollaborationState();
  if (!Array.isArray(state.approvals)) state.approvals = [];
  if (!Array.isArray(state.comments)) state.comments = [];
  if (!Array.isArray(state.handoffs)) state.handoffs = [];
  run.collaboration = state as unknown as WorkflowRun["collaboration"];
  return state;
}

export interface CollaborationOptions {
  persist?: boolean;
}

function persist(run: WorkflowRun, options: CollaborationOptions): void {
  if (options.persist === false) return;
  saveCheckpoint(run);
}

export function recordApproval(run: WorkflowRun, input: collab.RecordApprovalInput, options: CollaborationOptions = {}): collab.ApprovalRecord {
  const state = ensureCollaborationState(run);
  const actor = collab.normalizeActor(input);
  const target = collab.normalizeTarget(input.target);
  const decision = input.decision === "reject" ? "reject" : "approve";
  const audit = recordTrustAuditEvent(run, {
    kind: decision === "approve" ? "collaboration.approval" : "collaboration.rejection",
    decision: decision === "approve" ? "accepted" : "rejected",
    source: actor.source,
    actor: actor.id,
    ...auditTargetFields(target),
    agentRoleId: actor.roleId,
    metadata: compact({ decision, rationale: input.rationale, roleId: actor.roleId, attestation: actor.attestation, targetKind: target.kind, supersedes: input.supersedes }),
  });
  const record = collab.buildApproval(input, state.approvals.length, run.id, now(), audit.id);
  state.approvals.push(record);
  persist(run, options);
  return record;
}

export function recordComment(run: WorkflowRun, input: collab.RecordCommentInput, options: CollaborationOptions = {}): collab.CommentRecord {
  const state = ensureCollaborationState(run);
  const actor = collab.normalizeActor(input);
  const target = collab.normalizeTarget(input.target);
  const threadId = input.threadId?.trim() || `${target.kind}:${target.id}`;
  const audit = recordTrustAuditEvent(run, { kind: "collaboration.comment", decision: "recorded", source: actor.source, actor: actor.id, ...auditTargetFields(target), agentRoleId: actor.roleId, metadata: compact({ threadId, parentId: input.parentId, targetKind: target.kind }) });
  const record = collab.buildComment(input, state.comments.length, run.id, now(), audit.id);
  state.comments.push(record);
  persist(run, options);
  return record;
}

export function recordHandoff(run: WorkflowRun, input: collab.RecordHandoffInput, options: CollaborationOptions = {}): collab.HandoffRecord {
  const state = ensureCollaborationState(run);
  const recorder = collab.normalizeActor(input);
  const fromActor = input.fromActor ? collab.normalizeActor({ actor: input.fromActor, actorKind: input.fromActorKind, role: input.fromRole, attested: input.attested }) : recorder;
  const toActor = collab.normalizeActor({ actor: input.toActor, actorKind: input.toActorKind, role: input.toRole, displayName: input.toDisplayName, attested: input.toAttested });
  const target = collab.normalizeTarget(input.target);
  const reason = input.reason?.trim() || "handoff";
  const audit = recordTrustAuditEvent(run, { kind: "collaboration.handoff", decision: "recorded", source: recorder.source, actor: recorder.id, ...auditTargetFields(target), metadata: compact({ from: fromActor.id, to: toActor.id, reason, targetKind: target.kind }) });
  const record = collab.buildHandoff(input, state.handoffs.length, run.id, now(), audit.id);
  state.handoffs.push(record);
  persist(run, options);
  return record;
}

/** First defined value among a set of option-name aliases (old wrapper's
 *  `firstDefined`) — lets a caller pass any of `requiredApprovals`/`required`,
 *  `authorizedRoles`/`roles`, `allowSelfApproval`/`allow-self-approval`, etc. */
function firstDefined(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

/** The return shape of `setReviewPolicy`: the ReviewGatePolicy itself (so a
 *  caller can read `.requiredApprovals`/`.authorizedRoles` directly or pass it
 *  straight into `deriveReviewState` as `{ policy }`), PLUS a `policy`
 *  self-reference + `schemaVersion`/`surface`/`runId` for the old wrapper's
 *  report-envelope callers (`result.policy.requiredApprovals`). */
export type SetReviewPolicyResult = collab.ReviewGatePolicy & {
  surface: "collaboration";
  runId: string;
  policy: collab.ReviewGatePolicy;
};

export function setReviewPolicy(run: WorkflowRun, input: collab.ReviewPolicyInput, options: CollaborationOptions = {}): SetReviewPolicyResult {
  const state = ensureCollaborationState(run);
  // Resolve the old wrapper's option-name aliases before building the policy,
  // so `required`/`roles`/`allow-self-approval`/... reach buildReviewPolicy on
  // the canonical keys. Values are Boolean/number-coerced inside
  // buildReviewPolicy; undefined aliases fall through to existing/defaults.
  const raw = input as unknown as Record<string, unknown>;
  const resolved: collab.ReviewPolicyInput = {
    requiredApprovals: firstDefined(raw, "requiredApprovals", "required-approvals", "required", "approvals") as collab.ReviewPolicyInput["requiredApprovals"],
    authorizedRoles: firstDefined(raw, "authorizedRoles", "authorized-roles", "roles") as collab.ReviewPolicyInput["authorizedRoles"],
    allowSelfApproval: firstDefined(raw, "allowSelfApproval", "allow-self-approval") as collab.ReviewPolicyInput["allowSelfApproval"],
    requireAttestedActor: firstDefined(raw, "requireAttestedActor", "require-attested-actor") as collab.ReviewPolicyInput["requireAttestedActor"],
    appliesTo: firstDefined(raw, "appliesTo", "applies-to", "targets") as collab.ReviewPolicyInput["appliesTo"],
  };
  const policy = collab.buildReviewPolicy(resolved, state.policy, now());
  state.policy = policy;
  recordTrustAuditEvent(run, { kind: "collaboration.review-policy", decision: "recorded", source: "operator-recorded", metadata: compact({ policyId: policy.id, requiredApprovals: policy.requiredApprovals, authorizedRoles: policy.authorizedRoles, allowSelfApproval: policy.allowSelfApproval, requireAttestedActor: policy.requireAttestedActor, appliesTo: policy.appliesTo }) });
  persist(run, options);
  return { ...policy, surface: "collaboration", runId: run.id, policy };
}

function resolveReviewPolicy(run: WorkflowRun, policy?: collab.ReviewGatePolicy): collab.ReviewGatePolicy | undefined {
  return policy || ensureCollaborationState(run).policy || undefined;
}

function relatedTargetsFor(run: WorkflowRun, target: collab.CollaborationTarget): collab.CollaborationTarget[] {
  if (target.kind !== "commit") return [target];
  const commit = (run.commits || []).find((entry) => entry.id === target.id);
  const related: collab.CollaborationTarget[] = [target];
  if (commit?.selectionId) related.push({ kind: "selection", id: commit.selectionId });
  if (commit?.candidateId) related.push({ kind: "candidate", id: commit.candidateId });
  return related;
}

function candidateWorkerId(run: WorkflowRun, candidateId: string | undefined): string | undefined {
  const candidate = candidateId ? ((run.candidates as Array<{ id: string; workerId?: string }> | undefined) || []).find((entry) => entry.id === candidateId) : undefined;
  return candidate?.workerId;
}

function selectedByForCandidate(run: WorkflowRun, candidateId?: string, selectionId?: string): string[] {
  const selections = ((run.candidateSelections as Array<{ id: string; candidateId: string; selectedBy?: string }> | undefined) || []).filter((selection) => (selectionId && selection.id === selectionId) || (candidateId && selection.candidateId === candidateId));
  return selections.map((selection) => selection.selectedBy).filter((id): id is string => Boolean(id));
}

export function selfActorIdsForCandidate(run: WorkflowRun, candidateId?: string, selectionId?: string): string[] {
  return collab.selfActorIdsForCandidate(candidateWorkerId(run, candidateId), selectedByForCandidate(run, candidateId, selectionId));
}

function selfActorIdsForTarget(run: WorkflowRun, target: collab.CollaborationTarget): string[] {
  if (target.kind === "candidate") return selfActorIdsForCandidate(run, target.id);
  if (target.kind === "selection") {
    const selection = ((run.candidateSelections as Array<{ id: string; candidateId: string }> | undefined) || []).find((entry) => entry.id === target.id);
    return selfActorIdsForCandidate(run, selection?.candidateId, target.id);
  }
  if (target.kind === "commit") {
    const commit = (run.commits || []).find((entry) => entry.id === target.id);
    return selfActorIdsForCandidate(run, commit?.candidateId, commit?.selectionId);
  }
  return [];
}

export function deriveReviewState(run: WorkflowRun, target: collab.CollaborationTarget, options: collab.ReviewStateOptions = {}): collab.ReviewState {
  const state = ensureCollaborationState(run);
  const policy = resolveReviewPolicy(run, options.policy);
  return collab.deriveReviewState(run.id, state.approvals, target, { ...options, policy });
}

export function reviewGateErrors(run: WorkflowRun, input: collab.ReviewGateInput): import("../core/state/types").StateNodeError[] {
  const state = ensureCollaborationState(run);
  const policy = resolveReviewPolicy(run, input.policy);
  return collab.reviewGateErrors(run.id, state.approvals, { ...input, policy }, now());
}

export function commitReviewProvenance(run: WorkflowRun, input: collab.ReviewGateInput): collab.CommitReviewProvenance | undefined {
  const state = ensureCollaborationState(run);
  const policy = resolveReviewPolicy(run, input.policy);
  return collab.commitReviewProvenance(run.id, state.approvals, { ...input, policy });
}

export function buildReviewStatusReport(run: WorkflowRun, options: { now: string; target?: collab.CollaborationTarget }): collab.ReviewStatusReport {
  const state = ensureCollaborationState(run);
  const targets = options.target ? [collab.normalizeTarget(options.target)] : collab.distinctTargets(state);
  const reviewStates = targets.map((target) => deriveReviewState(run, target, { policy: state.policy, relatedTargets: relatedTargetsFor(run, target), selfActorIds: selfActorIdsForTarget(run, target) }));
  const owner = collab.deriveOwner(state.handoffs);
  const timeline = collab.buildTimeline(state);
  return {
    schemaVersion: 1,
    surface: "collaboration",
    runId: run.id,
    generatedAt: options.now,
    policy: state.policy,
    owner,
    targets: reviewStates,
    counts: { approvals: state.approvals.filter((record) => record.decision === "approve").length, rejections: state.approvals.filter((record) => record.decision === "reject").length, comments: state.comments.length, handoffs: state.handoffs.length },
    timeline,
    nextActions: collab.buildNextActions(run.id, reviewStates, state.policy),
  };
}

/** The read-only comment-list report envelope (old orchestrator wrapper's
 *  `collaborationCommentList` contract): a stable shape the CLI/MCP and the
 *  Workbench comment panel all emit, so a bare array can never leak as the
 *  top-level surface. */
export interface CommentListReport {
  schemaVersion: 1;
  surface: "collaboration";
  runId: string;
  target?: collab.CollaborationTarget;
  count: number;
  comments: collab.CommentRecord[];
}

export function listComments(run: WorkflowRun, target?: collab.CollaborationTarget): CommentListReport {
  const normalized = target ? collab.normalizeTarget(target) : undefined;
  const comments = collab.listComments(ensureCollaborationState(run), normalized);
  return { schemaVersion: 1, surface: "collaboration", runId: run.id, ...(normalized ? { target: normalized } : {}), count: comments.length, comments };
}

export function deriveOwner(run: WorkflowRun): collab.Actor | undefined {
  return collab.deriveOwner(ensureCollaborationState(run).handoffs);
}

export const formatReviewStatus = collab.formatReviewStatus;

/** Format the comment list for humans. Accepts either the bare record array
 *  (the core formatter's shape) or the `CommentListReport` envelope this
 *  module now returns, so a caller that passes `listComments(run)` straight
 *  through still renders the comments (never the envelope's own keys). */
export function formatCommentList(input: collab.CommentRecord[] | CommentListReport): string {
  const comments = Array.isArray(input) ? input : input.comments;
  return collab.formatCommentList(comments);
}
