"use strict";
// core/multi-agent/collaboration.ts — approvals/comments/handoffs,
// deriveReviewState (review-gate stacking rule).
//
// MILESTONE 9. Byte-exact port of the old build's src/collaboration.ts,
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
// gate"), "Collaboration exact outputs"; plugins/cool-workflow/src/
// collaboration.ts (byte-exact source).
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNATTRIBUTED_ACTOR = exports.COLLABORATION_SCHEMA_VERSION = void 0;
exports.emptyCollaborationState = emptyCollaborationState;
exports.normalizeActor = normalizeActor;
exports.normalizeTarget = normalizeTarget;
exports.createCollabId = createCollabId;
exports.buildApproval = buildApproval;
exports.buildComment = buildComment;
exports.buildHandoff = buildHandoff;
exports.buildReviewPolicy = buildReviewPolicy;
exports.deriveReviewState = deriveReviewState;
exports.reviewGateErrors = reviewGateErrors;
exports.commitReviewProvenance = commitReviewProvenance;
exports.deriveOwner = deriveOwner;
exports.buildTimeline = buildTimeline;
exports.buildNextActions = buildNextActions;
exports.selfActorIdsForCandidate = selfActorIdsForCandidate;
exports.listComments = listComments;
exports.distinctTargets = distinctTargets;
exports.formatReviewStatus = formatReviewStatus;
exports.formatCommentList = formatCommentList;
const collate_1 = require("../util/collate");
exports.COLLABORATION_SCHEMA_VERSION = 1;
/** The single, honest stand-in for an absent identity. */
exports.UNATTRIBUTED_ACTOR = {
    kind: "unattributed",
    id: "unattributed",
    attestation: "unattributed",
    attested: false,
    source: "runtime-derived",
};
function emptyCollaborationState() {
    return { schemaVersion: exports.COLLABORATION_SCHEMA_VERSION, approvals: [], comments: [], handoffs: [] };
}
function trimmed(value) {
    if (value === undefined || value === null)
        return "";
    return String(value).trim();
}
const ACTOR_KINDS = ["operator", "worker", "role", "membership", "group", "host", "service", "unattributed"];
function normalizeActorKind(raw, roleId) {
    const value = trimmed(raw);
    if (value && ACTOR_KINDS.includes(value))
        return value;
    if (roleId)
        return "role";
    return "operator";
}
function sourceForAttestation(attestation) {
    if (attestation === "host-attested")
        return "host-attested";
    if (attestation === "operator-recorded")
        return "operator-recorded";
    return "runtime-derived";
}
/** Absent id -> the unattributed actor. Unknown kind falls back to
 *  "role" (if a role id is given) or "operator". */
function normalizeActor(input) {
    const id = trimmed(input?.actor);
    if (!id)
        return { ...exports.UNATTRIBUTED_ACTOR };
    const roleId = trimmed(input?.roleId) || trimmed(input?.role);
    const kind = normalizeActorKind(input?.actorKind, roleId);
    const attestation = input?.attestation ? input.attestation : input?.attested ? "host-attested" : "operator-recorded";
    const attested = attestation === "host-attested";
    return { kind, id, displayName: trimmed(input?.displayName) || undefined, attestation, attested, roleId: roleId || undefined, source: sourceForAttestation(attestation) };
}
function normalizeTarget(target) {
    const kind = target?.kind;
    const id = trimmed(target?.id);
    if (!kind || !id)
        throw new Error("Collaboration target requires a kind and id");
    if (!["run", "task", "candidate", "selection", "commit", "node"].includes(kind)) {
        throw new Error(`Unknown collaboration target kind: ${kind}`);
    }
    return { kind, id };
}
function safeFileName(value) {
    return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
/** Deterministic collab id: caller-supplied count (approvals/comments/
 *  handoffs length), no wall-clock stamp. */
function createCollabId(kind, count) {
    return `collab-${safeFileName(kind)}-${String(count + 1).padStart(4, "0")}`;
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
/** Append-only: id shares the `approvals` array's length counter across
 *  approve/reject (a rejection right after an approval mints the NEXT
 *  sequence number, not its own). */
function buildApproval(input, approvalCount, runId, now, auditEventId) {
    const actor = normalizeActor(input);
    const target = normalizeTarget(input.target);
    const decision = input.decision === "reject" ? "reject" : "approve";
    return compact({
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
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
    });
}
function buildComment(input, commentCount, runId, now, auditEventId) {
    const actor = normalizeActor(input);
    const target = normalizeTarget(input.target);
    const body = trimmed(input.body) || trimmed(input.message) || trimmed(input.text);
    if (!body)
        throw new Error("Comment body is required");
    const threadId = trimmed(input.threadId) || `${target.kind}:${target.id}`;
    return compact({
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        id: createCollabId("comment", commentCount),
        runId,
        createdAt: now,
        actor,
        target,
        body,
        threadId,
        parentId: trimmed(input.parentId) || undefined,
        auditEventIds: [auditEventId],
    });
}
function buildHandoff(input, handoffCount, runId, now, auditEventId) {
    const recorder = normalizeActor(input);
    const fromActor = input.fromActor ? normalizeActor({ actor: input.fromActor, actorKind: input.fromActorKind, role: input.fromRole, attested: input.attested }) : recorder;
    const toActor = normalizeActor({ actor: input.toActor, actorKind: input.toActorKind, role: input.toRole, displayName: input.toDisplayName, attested: input.toAttested });
    if (toActor.kind === "unattributed")
        throw new Error("Handoff requires a to-actor (--to)");
    const target = normalizeTarget(input.target);
    const reason = trimmed(input.reason) || "handoff";
    return compact({
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        id: createCollabId("handoff", handoffCount),
        runId,
        createdAt: now,
        actor: recorder,
        fromActor,
        toActor,
        target,
        reason,
        auditEventIds: [auditEventId],
    });
}
/** Boolean-coerce a defined tri-state flag; leave `undefined` alone so the
 *  caller's `?? existing ?? default` chain still governs an unset flag. */
function coerceFlag(value) {
    return value === undefined ? undefined : Boolean(value);
}
function toNumber(value, fallback) {
    if (value === undefined || value === null || value === "" || value === true)
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function uniqueList(values) {
    return Array.from(new Set(values));
}
function toStringList(value, fallback) {
    if (value === undefined)
        return fallback;
    const list = Array.isArray(value) ? value : String(value).split(",");
    const cleaned = list.map((entry) => String(entry).trim()).filter(Boolean);
    return cleaned.length ? uniqueList(cleaned) : fallback;
}
function toTargetKindList(value, fallback) {
    if (value === undefined)
        return fallback;
    const list = Array.isArray(value) ? value : String(value).split(",");
    const valid = ["run", "task", "candidate", "selection", "commit", "node"];
    const cleaned = list.map((entry) => String(entry).trim()).filter((entry) => valid.includes(entry));
    return cleaned.length ? uniqueList(cleaned) : fallback;
}
function buildReviewPolicy(input, existing, now) {
    return {
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        id: existing?.id || createCollabId("policy", 0),
        requiredApprovals: Math.max(0, Math.floor(toNumber(input.requiredApprovals, existing?.requiredApprovals ?? 0))),
        authorizedRoles: toStringList(input.authorizedRoles, existing?.authorizedRoles ?? ["*"]),
        allowSelfApproval: coerceFlag(input.allowSelfApproval) ?? existing?.allowSelfApproval ?? false,
        requireAttestedActor: coerceFlag(input.requireAttestedActor) ?? existing?.requireAttestedActor ?? false,
        appliesTo: toTargetKindList(input.appliesTo, existing?.appliesTo ?? ["commit"]),
        updatedAt: now,
    };
}
function sameTarget(left, right) {
    return left.kind === right.kind && left.id === right.id;
}
function matchesAnyTarget(target, related) {
    return related.some((entry) => sameTarget(target, entry));
}
function compareByCreated(left, right) {
    return (0, collate_1.stableCompare)(left.createdAt, right.createdAt) || (0, collate_1.stableCompare)(left.id, right.id);
}
function disqualify(record, policy, selfIds) {
    const actor = record.actor;
    if (actor.kind === "unattributed")
        return "unattributed";
    if (policy?.requireAttestedActor && !actor.attested)
        return "unattributed";
    if (policy && !roleAuthorized(actor.roleId, policy.authorizedRoles))
        return "unauthorized-role";
    if (policy && !policy.allowSelfApproval && selfIds.has(actor.id))
        return "self-approval";
    return undefined;
}
function roleAuthorized(roleId, authorizedRoles) {
    if (authorizedRoles.includes("*"))
        return true;
    if (!roleId)
        return false;
    return authorizedRoles.includes(roleId);
}
function deriveStatus(gated, required, recorded, rejectionCount, disqualified) {
    if (!gated)
        return "approved";
    if (rejectionCount > 0)
        return "rejected";
    if (recorded >= required)
        return "approved";
    if (recorded === 0 && disqualified.length > 0) {
        const blocking = disqualified.filter((entry) => entry.reason !== "superseded");
        if (blocking.length > 0 && blocking.every((entry) => entry.reason === "unattributed"))
            return "unattributed";
        if (blocking.length > 0)
            return "blocked";
    }
    return "pending";
}
function buildMissing(status, gated, required, recorded, policy, rejections, disqualified) {
    if (!gated || status === "approved")
        return [];
    const missing = [];
    if (status === "rejected") {
        for (const record of rejections)
            missing.push(`rejected by ${record.actor.id}${record.rationale ? ` (${record.rationale})` : ""}`);
        return missing;
    }
    const roles = policy?.authorizedRoles?.length ? policy.authorizedRoles.join(", ") : "*";
    missing.push(`${required - recorded} more approval(s) from authorized role(s) [${roles}] required (have ${recorded}/${required})`);
    const selfCount = disqualified.filter((entry) => entry.reason === "self-approval").length;
    const unattributedCount = disqualified.filter((entry) => entry.reason === "unattributed").length;
    const unauthorizedCount = disqualified.filter((entry) => entry.reason === "unauthorized-role").length;
    if (selfCount)
        missing.push(`${selfCount} self-approval(s) ignored (policy forbids self-approval)`);
    if (unattributedCount)
        missing.push(`${unattributedCount} unattributed approval(s) ignored`);
    if (unauthorizedCount)
        missing.push(`${unauthorizedCount} approval(s) from unauthorized role(s) ignored`);
    return missing;
}
/** Pure projection: derive a target's review state from append-only
 *  records + policy. Approvals are processed in createdAt-then-id order;
 *  only the FIRST approval per actor id counts. A reject with disqualify
 *  reason "self-approval" still counts as a veto; a reject from an
 *  unattributed/unauthorized actor is disqualified instead. */
function deriveReviewState(runId, approvalsAll, target, options = {}) {
    const normalized = normalizeTarget(target);
    const policy = options.policy;
    const related = (options.relatedTargets && options.relatedTargets.length ? options.relatedTargets : [normalized]).map(normalizeTarget);
    const selfIds = new Set((options.selfActorIds || []).filter(Boolean));
    const approvals = approvalsAll.filter((record) => matchesAnyTarget(record.target, related));
    const supersededIds = new Set(approvals.map((record) => record.supersedes).filter((id) => Boolean(id)));
    const gated = Boolean(policy && policy.requiredApprovals > 0 && policy.appliesTo.includes(normalized.kind));
    const required = gated ? policy.requiredApprovals : 0;
    const counted = [];
    const countedActorIds = new Set();
    const rejections = [];
    const disqualified = [];
    for (const record of [...approvals].sort(compareByCreated)) {
        if (supersededIds.has(record.id)) {
            disqualified.push({ approvalId: record.id, actorId: record.actor.id, reason: "superseded" });
            continue;
        }
        const reason = disqualify(record, policy, selfIds);
        if (record.decision === "reject") {
            if (!reason || reason === "self-approval")
                rejections.push(record);
            else
                disqualified.push({ approvalId: record.id, actorId: record.actor.id, reason });
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
    return { schemaVersion: exports.COLLABORATION_SCHEMA_VERSION, runId, target: normalized, status, gated, policyId: policy?.id, requiredApprovals: required, recordedApprovals, approvers, approvals: counted, rejections, disqualified, missing };
}
function gateTarget(input) {
    if (input.targetKind === "commit")
        return { kind: "commit", id: input.commitId || "(pending)" };
    if (input.targetKind === "selection")
        return { kind: "selection", id: input.selectionId || "(pending)" };
    if (input.targetKind === "candidate")
        return { kind: "candidate", id: input.candidateId || "(pending)" };
    if (input.targetKind === "node")
        return { kind: "node", id: input.nodeId || "(pending)" };
    if (input.targetKind === "task")
        return { kind: "task", id: input.taskId || "(pending)" };
    return { kind: "run", id: input.commitId || input.candidateId || input.selectionId || "(pending)" };
}
function gateRelatedTargets(input) {
    const related = [];
    if (input.commitId)
        related.push({ kind: "commit", id: input.commitId });
    if (input.selectionId)
        related.push({ kind: "selection", id: input.selectionId });
    if (input.candidateId)
        related.push({ kind: "candidate", id: input.candidateId });
    if (input.nodeId)
        related.push({ kind: "node", id: input.nodeId });
    if (input.taskId)
        related.push({ kind: "task", id: input.taskId });
    if (!related.length)
        related.push(gateTarget(input));
    return related;
}
/** The StateNodeErrors a review gate contributes. Empty when the target
 *  is not gated or the gate is satisfied — so it can only ADD
 *  constraints on top of a verifier gate's own errors, never remove
 *  them. Caller (candidate-scoring/commit-gate) appends this list to its
 *  own failure list. */
function reviewGateErrors(runId, approvalsAll, input, now) {
    const policy = input.policy;
    if (!policy || policy.requiredApprovals <= 0 || !policy.appliesTo.includes(input.targetKind))
        return [];
    const target = gateTarget(input);
    const related = gateRelatedTargets(input);
    const state = deriveReviewState(runId, approvalsAll, target, { policy, relatedTargets: related, selfActorIds: input.selfActorIds });
    if (state.status === "approved")
        return [];
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
function commitReviewProvenance(runId, approvalsAll, input) {
    const policy = input.policy;
    if (!policy || policy.requiredApprovals <= 0 || !policy.appliesTo.includes(input.targetKind))
        return undefined;
    const target = gateTarget(input);
    const state = deriveReviewState(runId, approvalsAll, target, { policy, relatedTargets: gateRelatedTargets(input), selfActorIds: input.selfActorIds });
    if (state.status !== "approved")
        return undefined;
    return { policyId: policy.id, requiredApprovals: state.requiredApprovals, recordedApprovals: state.recordedApprovals, approvers: state.approvers, approvalIds: state.approvals.map((record) => record.id).sort(), target };
}
function deriveOwner(handoffs) {
    const relevant = [...handoffs].filter((record) => record.target.kind === "run" || record.target.kind === "task").sort(compareByCreated);
    return relevant.length ? relevant[relevant.length - 1].toActor : undefined;
}
function truncate(value, max) {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function buildTimeline(state) {
    const entries = [];
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
            actor: { ...exports.UNATTRIBUTED_ACTOR, kind: "operator", id: "operator", attestation: "operator-recorded", source: "operator-recorded" },
            summary: `review policy: ${policy.requiredApprovals} approval(s) from [${policy.authorizedRoles.join(", ")}] for [${policy.appliesTo.join(", ")}]`,
        });
    }
    return entries.sort(compareByCreated);
}
function buildNextActions(runId, states, policy) {
    const actions = [];
    if (!policy) {
        actions.push(`node scripts/cw.js review policy ${runId} --requiredApprovals 1 --authorizedRoles reviewer --appliesTo commit`);
        return actions;
    }
    for (const state of states) {
        if (state.status === "pending" || state.status === "blocked" || state.status === "unattributed") {
            actions.push(`node scripts/cw.js approve ${state.target.kind} ${runId} ${state.target.id} --role <authorized-role> --actor <id> --attested`);
        }
    }
    if (!actions.length)
        actions.push(`node scripts/cw.js review status ${runId} --json`);
    return actions;
}
/** Self ids for a candidate/selection target: its producing worker +
 *  selector(s). Pure form of the old build's selfActorIdsForCandidate —
 *  the caller resolves the candidate's workerId and any matching
 *  selections' selectedBy values (shell/candidate-scoring-io.ts has the
 *  WorkflowRun-shaped lookups this needs). */
function selfActorIdsForCandidate(workerId, selectedByIds) {
    const ids = new Set();
    if (workerId)
        ids.add(workerId);
    for (const id of selectedByIds)
        if (id)
            ids.add(id);
    return [...ids];
}
function listComments(state, target) {
    const filtered = target ? state.comments.filter((record) => sameTarget(record.target, normalizeTarget(target))) : state.comments;
    return [...filtered].sort(compareByCreated);
}
function distinctTargets(state) {
    const seen = new Map();
    const targetKey = (target) => `${target.kind}:${target.id}`;
    for (const record of state.approvals)
        seen.set(targetKey(record.target), record.target);
    for (const record of state.comments)
        seen.set(targetKey(record.target), record.target);
    for (const record of state.handoffs)
        seen.set(targetKey(record.target), record.target);
    return [...seen.values()].sort((left, right) => (0, collate_1.stableCompare)(targetKey(left), targetKey(right)));
}
function formatReviewStatus(report) {
    const lines = [];
    const policy = report.policy;
    lines.push(`review ${report.runId}  policy=${policy ? `${policy.requiredApprovals} from [${policy.authorizedRoles.join(",")}] on [${policy.appliesTo.join(",")}]` : "none"}`);
    if (report.owner)
        lines.push(`  owner: ${report.owner.id} (${report.owner.attestation})`);
    lines.push(`  counts: approvals=${report.counts.approvals} rejections=${report.counts.rejections} comments=${report.counts.comments} handoffs=${report.counts.handoffs}`);
    for (const state of report.targets) {
        lines.push(`  ${state.target.kind} ${state.target.id}: ${state.status}` + (state.gated ? ` (${state.recordedApprovals}/${state.requiredApprovals}${state.approvers.length ? ` by ${state.approvers.join(",")}` : ""})` : " (not gated)"));
        for (const note of state.missing)
            lines.push(`    - ${note}`);
    }
    if (report.timeline.length) {
        lines.push("  timeline:");
        for (const entry of report.timeline)
            lines.push(`    ${entry.createdAt}  ${entry.actor.id}  ${entry.summary}`);
    }
    return lines.join("\n");
}
function formatCommentList(comments) {
    if (!comments.length)
        return "no comments";
    return comments.map((record) => `${record.createdAt}  ${record.actor.id} (${record.actor.attestation})  [${record.target.kind} ${record.target.id}]  ${record.body}`).join("\n");
}
