import type { BlackboardAuthor } from "./blackboard";
import type { TrustAuditSource } from "./trust";

// ---------------------------------------------------------------------------
// Team Collaboration (v0.1.32)
//
// The human-decision layer: an ATTESTED (never authenticated) actor, append-only
// approvals/comments/handoffs provenance-linked to a durable target, and a
// review-gate POLICY that STACKS ON the verifier gate (it never bypasses it).
// Records are append-only — a correction is a NEW record (`supersedes`), never an
// in-place edit. All fields are additive/optional so pre-v0.1.32 runs load with
// an absent `collaboration` and behave exactly as before (no required approvals).
// ---------------------------------------------------------------------------

/** Provenance of an actor identity. CW RECORDS who acted; it never authenticates.
 *  `host-attested` = the host vouched for provenance; `operator-recorded` = an
 *  operator supplied it unverified; `unattributed` = no identity was supplied. */
export type ActorAttestation = "host-attested" | "operator-recorded" | "unattributed";

/** What kind of identity acted. `unattributed` is the explicit, honest stand-in
 *  for an absent identity — never a fabricated one. */
export type ActorKind =
  | "operator"
  | "worker"
  | "role"
  | "membership"
  | "group"
  | "host"
  | "service"
  | "unattributed";

/** A host-attested (not authenticated) collaboration actor. Mirrors the
 *  trust-audit `actor` string + the BlackboardAuthor shape, plus explicit
 *  attestation provenance and an optional authorizing role. */
export interface Actor {
  kind: ActorKind;
  /** Stable identity string, or the literal "unattributed" when absent. */
  id: string;
  displayName?: string;
  /** How this identity's provenance is recorded. */
  attestation: ActorAttestation;
  /** True only for host-attested provenance. */
  attested: boolean;
  /** The role this actor claims to act as (authority is checked against policy). */
  roleId?: string;
  /** The trust-audit source this maps to when recorded as an audit event. */
  source: TrustAuditSource;
}

/** The durable thing a collaboration record attaches to. No side channel: the
 *  target is always an inspectable run/task/candidate/selection/commit/node. */
export type CollaborationTargetKind =
  | "run"
  | "task"
  | "candidate"
  | "selection"
  | "commit"
  | "node";

export interface CollaborationTarget {
  kind: CollaborationTargetKind;
  id: string;
}

export type ApprovalDecision = "approve" | "reject";

/** An append-only approval/rejection targeting a candidate or commit (or any
 *  durable target). `supersedes` links a correction to the record it revises —
 *  the past is never mutated. */
export interface ApprovalRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  actor: Actor;
  decision: ApprovalDecision;
  target: CollaborationTarget;
  rationale?: string;
  /** The role the actor approved under (authority is policy, checked at gate). */
  roleId?: string;
  /** A prior approval record this one revises (git-style correction). */
  supersedes?: string;
  /** Provenance into the trust-audit event log. */
  auditEventIds: string[];
  metadata?: Record<string, unknown>;
}

/** An append-only comment attached to a durable target. Threads are ordered by
 *  createdAt and never edited in place; an edit is a new record. */
export interface CommentRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  actor: Actor;
  target: CollaborationTarget;
  body: string;
  /** The thread this comment belongs to (defaults to the target's own thread). */
  threadId: string;
  /** The comment this one replies to, if any. */
  parentId?: string;
  auditEventIds: string[];
  metadata?: Record<string, unknown>;
}

/** An append-only ownership transfer of a run/task, recorded as an event with an
 *  explicit from-actor, to-actor, and reason. Integrates with run lifecycle: the
 *  current owner is DERIVED from the latest handoff (never an overwritten field). */
export interface HandoffRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  /** Who recorded the handoff (may differ from from/to). */
  actor: Actor;
  fromActor: Actor;
  toActor: Actor;
  target: CollaborationTarget;
  reason: string;
  auditEventIds: string[];
  metadata?: Record<string, unknown>;
}

/** Review-gate POLICY as data, kept out of the kernel. Default (absent policy or
 *  requiredApprovals 0) requires no approvals — pre-v0.1.32 behavior. */
export interface ReviewGatePolicy {
  schemaVersion: 1;
  id: string;
  /** N distinct authorized, attested approvals required. 0 = no gate. */
  requiredApprovals: number;
  /** Role ids/titles authorized to approve; ["*"] authorizes any role. */
  authorizedRoles: string[];
  /** Whether the producing actor (worker/selector) may approve their own work. */
  allowSelfApproval: boolean;
  /** Whether an approval's actor must be host-attested to count. */
  requireAttestedActor: boolean;
  /** Which target kinds this gate applies to (e.g. ["commit","selection"]). */
  appliesTo: CollaborationTargetKind[];
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type ReviewStatus =
  | "approved"
  | "pending"
  | "rejected"
  | "blocked"
  | "unattributed";

/** Why a recorded approval did not count toward the gate. */
export type ApprovalDisqualification =
  | "unattributed"
  | "unauthorized-role"
  | "self-approval"
  | "superseded";

export interface DisqualifiedApproval {
  approvalId: string;
  actorId: string;
  reason: ApprovalDisqualification;
}

/** A DERIVED, deterministic review state for one target under one policy. Pure
 *  projection of the append-only records + policy; the only now-derived field in
 *  any report that embeds it is an ISO timestamp. */
export interface ReviewState {
  schemaVersion: 1;
  runId: string;
  target: CollaborationTarget;
  status: ReviewStatus;
  /** True when a policy applies to this target kind. */
  gated: boolean;
  policyId?: string;
  requiredApprovals: number;
  /** Distinct authorized, attested, non-self approvals that count. */
  recordedApprovals: number;
  /** Actor ids of the counted approvers, sorted. */
  approvers: string[];
  /** Counted approval records. */
  approvals: ApprovalRecord[];
  /** Blocking rejections (authorized, attested). */
  rejections: ApprovalRecord[];
  /** Recorded approvals that did not count, with the reason. */
  disqualified: DisqualifiedApproval[];
  /** Human-readable description of what is still missing (empty when approved). */
  missing: string[];
}

/** Provenance stamped on a commit when a review gate was satisfied: who approved
 *  the very artifact that shipped. A provenance LINK, not an overwrite. */
export interface CommitReviewProvenance {
  policyId: string;
  requiredApprovals: number;
  recordedApprovals: number;
  approvers: string[];
  approvalIds: string[];
  target: CollaborationTarget;
}

/** Append-only collaboration state on a run. The records ARE the durable,
 *  inspectable state — there is no hidden dashboard. */
export interface CollaborationState {
  schemaVersion: 1;
  approvals: ApprovalRecord[];
  comments: CommentRecord[];
  handoffs: HandoffRecord[];
  /** The active review-gate policy (data, not kernel). Absent = no gate. */
  policy?: ReviewGatePolicy;
}

/** One entry in the chronological collaboration timeline (CLI/MCP/Workbench). */
export interface CollaborationTimelineEntry {
  kind: "approval" | "comment" | "handoff" | "policy";
  id: string;
  createdAt: string;
  actor: Actor;
  target?: CollaborationTarget;
  summary: string;
}

/** Canonical, deterministic `review status <run-id>` payload — identical across
 *  CLI/MCP, embedded read-only by the Workbench. */
export interface ReviewStatusReport {
  schemaVersion: 1;
  surface: "collaboration";
  runId: string;
  /** Injected wall-clock at report time (ISO). The ONLY now-derived field. */
  generatedAt: string;
  policy?: ReviewGatePolicy;
  /** Current owner of the run, derived from the latest run/task handoff. */
  owner?: Actor;
  /** Per-target review state for every reviewable target with records or gating. */
  targets: ReviewState[];
  counts: {
    approvals: number;
    rejections: number;
    comments: number;
    handoffs: number;
  };
  timeline: CollaborationTimelineEntry[];
  nextActions: string[];
}
