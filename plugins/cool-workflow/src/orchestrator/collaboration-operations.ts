// Collaboration + review domain operations (v0.1.40 self-audit P3 router pattern).
// Append-only, host-attested approvals/comments/handoffs + derived review state.
// Carved out of CoolWorkflowRunner; behavior identical to the inline versions.
import { WorkflowRun } from "../types";
import { CollaborationTarget, CommentRecord, ReviewStatusReport } from "../types/collaboration";
import { saveCheckpoint } from "../state";
import { writeReport } from "./report";
import {
  actorInputFrom,
  collaborationTarget,
  collaborationTargetMaybe,
  firstDefined,
  numberOption,
  stringOption
} from "./cli-options";
import {
  recordApproval,
  recordComment,
  listComments,
  recordHandoff,
  buildReviewStatusReport,
  setReviewPolicy,
  formatReviewStatus as formatReviewStatusImpl,
  formatCommentList as formatCommentListImpl
} from "../collaboration";

export function collaborationApprove(
  run: WorkflowRun,
  targetKind: string,
  targetId: string,
  options: Record<string, unknown> = {},
  decision: "approve" | "reject" = "approve"
) {
  const record = recordApproval(
    run,
    {
      target: collaborationTarget(targetKind, targetId),
      decision,
      ...actorInputFrom(options),
      rationale: stringOption(options.rationale) || stringOption(options.reason) || stringOption(options.message),
      supersedes: stringOption(options.supersedes)
    },
    { persist: false }
  );
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function collaborationComment(run: WorkflowRun, targetKind: string, targetId: string, options: Record<string, unknown> = {}) {
  const record = recordComment(
    run,
    {
      target: collaborationTarget(targetKind, targetId),
      body: stringOption(options.body) || stringOption(options.message) || stringOption(options.text) || "",
      threadId: stringOption(options.thread) || stringOption(options.threadId),
      parentId: stringOption(options.parent) || stringOption(options.parentId),
      ...actorInputFrom(options)
    },
    { persist: false }
  );
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function collaborationCommentList(run: WorkflowRun, options: Record<string, unknown> = {}): {
  schemaVersion: 1;
  surface: "collaboration";
  runId: string;
  target?: CollaborationTarget;
  count: number;
  comments: CommentRecord[];
} {
  const target = collaborationTargetMaybe(stringOption(options.targetKind) || stringOption(options.kind), stringOption(options.target) || stringOption(options.targetId));
  const comments = listComments(run, target);
  return { schemaVersion: 1, surface: "collaboration", runId: run.id, target, count: comments.length, comments };
}

export function collaborationHandoff(run: WorkflowRun, targetKind: string, targetId: string, options: Record<string, unknown> = {}) {
  const record = recordHandoff(
    run,
    {
      target: collaborationTarget(targetKind, targetId),
      toActor: stringOption(firstDefined(options, "to", "toActor")),
      toActorKind: stringOption(firstDefined(options, "toKind", "to-kind", "toActorKind")),
      toRole: stringOption(firstDefined(options, "toRole", "to-role")),
      toDisplayName: stringOption(firstDefined(options, "toName", "to-name", "toDisplayName")),
      toAttested: Boolean(firstDefined(options, "toAttested", "to-attested")),
      fromActor: stringOption(firstDefined(options, "from", "fromActor")),
      fromActorKind: stringOption(firstDefined(options, "fromKind", "from-kind", "fromActorKind")),
      fromRole: stringOption(firstDefined(options, "fromRole", "from-role")),
      reason: stringOption(options.reason) || stringOption(options.message) || "handoff",
      ...actorInputFrom(options)
    },
    { persist: false }
  );
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function reviewStatus(run: WorkflowRun, options: Record<string, unknown> = {}): ReviewStatusReport {
  const now = typeof options.now === "string" && options.now ? options.now : new Date().toISOString();
  const target = collaborationTargetMaybe(stringOption(options.targetKind) || stringOption(options.kind), stringOption(options.target) || stringOption(options.targetId));
  return buildReviewStatusReport(run, { now, target });
}

export function reviewPolicy(run: WorkflowRun, options: Record<string, unknown> = {}) {
  const allowSelf = firstDefined(options, "allowSelfApproval", "allow-self-approval");
  const requireAttested = firstDefined(options, "requireAttestedActor", "require-attested-actor");
  const policy = setReviewPolicy(
    run,
    {
      requiredApprovals: numberOption(firstDefined(options, "requiredApprovals", "required-approvals", "required", "approvals")),
      authorizedRoles: stringOption(firstDefined(options, "authorizedRoles", "authorized-roles", "roles")),
      allowSelfApproval: allowSelf === undefined ? undefined : Boolean(allowSelf),
      requireAttestedActor: requireAttested === undefined ? undefined : Boolean(requireAttested),
      appliesTo: stringOption(firstDefined(options, "appliesTo", "applies-to", "targets"))
    },
    { persist: false }
  );
  writeReport(run);
  saveCheckpoint(run);
  return { schemaVersion: 1 as const, surface: "collaboration" as const, runId: run.id, policy };
}

export function formatReviewStatus(report: ReviewStatusReport): string {
  return formatReviewStatusImpl(report);
}

export function formatCommentList(comments: CommentRecord[]): string {
  return formatCommentListImpl(comments);
}
