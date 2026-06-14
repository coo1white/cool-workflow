"use strict";
// Team Collaboration core (v0.1.32) — the human-decision layer.
//
// BSD discipline applied here:
//  - IDENTITY IS ATTESTED, NOT AUTHENTICATED. `normalizeActor` records WHO acted
//    from host/operator provenance; an absent identity becomes the explicit
//    `unattributed` actor, never a fabricated one. CW is not an auth server.
//  - REVIEW GATES STACK ON THE VERIFIER GATE. `reviewGateErrors` returns extra
//    StateNodeErrors for `resolveCommitGate`/`selectCandidate` to APPEND — policy
//    layered on top of the verifier mechanism, never replacing it.
//  - APPEND-ONLY LOG; NEVER MUTATE THE PAST. record* only push; a correction is a
//    NEW record carrying `supersedes`. The approved artifact is never edited; the
//    review link is provenance, not a field overwrite.
//  - FAIL CLOSED ON AUTHORITY AND QUORUM. `deriveReviewState` counts only
//    distinct, attested, authorized, non-self approvals; anything short is
//    pending/blocked/rejected/unattributed — never auto-passed.
//  - POLICY AS DATA. The ReviewGatePolicy lives on the run (or is injected),
//    out of the kernel; default (absent / requiredApprovals 0) keeps pre-v0.1.32
//    behavior unchanged.
//  - COLLABORATION IS STATE, NOT CHAT. Every record attaches to a durable target
//    and is derived deterministically — no hidden dashboard.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNATTRIBUTED_ACTOR = exports.COLLABORATION_SCHEMA_VERSION = void 0;
exports.ensureCollaborationState = ensureCollaborationState;
exports.normalizeActor = normalizeActor;
exports.recordApproval = recordApproval;
exports.recordComment = recordComment;
exports.recordHandoff = recordHandoff;
exports.setReviewPolicy = setReviewPolicy;
exports.resolveReviewPolicy = resolveReviewPolicy;
exports.deriveReviewState = deriveReviewState;
exports.reviewGateErrors = reviewGateErrors;
exports.commitReviewProvenance = commitReviewProvenance;
exports.selfActorIdsForCandidate = selfActorIdsForCandidate;
exports.buildReviewStatusReport = buildReviewStatusReport;
exports.listComments = listComments;
exports.deriveOwner = deriveOwner;
exports.formatReviewStatus = formatReviewStatus;
exports.formatCommentList = formatCommentList;
const trust_audit_1 = require("./trust-audit");
const state_1 = require("./state");
exports.COLLABORATION_SCHEMA_VERSION = 1;
/** The single, honest stand-in for an absent identity. */
exports.UNATTRIBUTED_ACTOR = {
    kind: "unattributed",
    id: "unattributed",
    attestation: "unattributed",
    attested: false,
    source: "runtime-derived"
};
// ---------------------------------------------------------------------------
// State + actor normalization
// ---------------------------------------------------------------------------
function ensureCollaborationState(run) {
    if (!run.collaboration) {
        run.collaboration = { schemaVersion: exports.COLLABORATION_SCHEMA_VERSION, approvals: [], comments: [], handoffs: [] };
    }
    const state = run.collaboration;
    if (!Array.isArray(state.approvals))
        state.approvals = [];
    if (!Array.isArray(state.comments))
        state.comments = [];
    if (!Array.isArray(state.handoffs))
        state.handoffs = [];
    return state;
}
const ACTOR_KINDS = ["operator", "worker", "role", "membership", "group", "host", "service", "unattributed"];
/** Build a host-attested (never authenticated) actor. Absent id => unattributed. */
function normalizeActor(input) {
    const id = trimmed(input?.actor);
    if (!id)
        return { ...exports.UNATTRIBUTED_ACTOR };
    const roleId = trimmed(input?.roleId) || trimmed(input?.role);
    const kind = normalizeActorKind(input?.actorKind, roleId);
    const attestation = input?.attestation
        ? input.attestation
        : input?.attested
            ? "host-attested"
            : "operator-recorded";
    const attested = attestation === "host-attested";
    return {
        kind,
        id,
        displayName: trimmed(input?.displayName) || undefined,
        attestation,
        attested,
        roleId: roleId || undefined,
        source: sourceForAttestation(attestation)
    };
}
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
// ---------------------------------------------------------------------------
// Append-only record writers
// ---------------------------------------------------------------------------
function recordApproval(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const actor = normalizeActor(input);
    const target = normalizeTarget(input.target);
    const decision = input.decision === "reject" ? "reject" : "approve";
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: decision === "approve" ? "collaboration.approval" : "collaboration.rejection",
        decision: decision === "approve" ? "accepted" : "rejected",
        source: actor.source,
        actor: actor.id,
        ...auditTargetFields(target),
        agentRoleId: actor.roleId,
        metadata: compact({
            decision,
            rationale: input.rationale,
            roleId: actor.roleId,
            attestation: actor.attestation,
            targetKind: target.kind,
            supersedes: input.supersedes
        })
    });
    const record = compact({
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        id: createCollabId(run, decision === "approve" ? "approval" : "rejection", state.approvals.length),
        runId: run.id,
        createdAt: new Date().toISOString(),
        actor,
        decision,
        target,
        rationale: trimmed(input.rationale) || undefined,
        roleId: actor.roleId,
        supersedes: trimmed(input.supersedes) || undefined,
        auditEventIds: [audit.id],
        metadata: undefined
    });
    state.approvals.push(record);
    persist(run, options);
    return record;
}
function recordComment(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const actor = normalizeActor(input);
    const target = normalizeTarget(input.target);
    const body = trimmed(input.body);
    if (!body)
        throw new Error("Comment body is required");
    const threadId = trimmed(input.threadId) || `${target.kind}:${target.id}`;
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "collaboration.comment",
        decision: "recorded",
        source: actor.source,
        actor: actor.id,
        ...auditTargetFields(target),
        agentRoleId: actor.roleId,
        metadata: compact({ threadId, parentId: input.parentId, targetKind: target.kind })
    });
    const record = compact({
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        id: createCollabId(run, "comment", state.comments.length),
        runId: run.id,
        createdAt: new Date().toISOString(),
        actor,
        target,
        body,
        threadId,
        parentId: trimmed(input.parentId) || undefined,
        auditEventIds: [audit.id]
    });
    state.comments.push(record);
    persist(run, options);
    return record;
}
function recordHandoff(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const recorder = normalizeActor(input);
    const fromActor = input.fromActor
        ? normalizeActor({ actor: input.fromActor, actorKind: input.fromActorKind, role: input.fromRole, attested: input.attested })
        : recorder;
    const toActor = normalizeActor({
        actor: input.toActor,
        actorKind: input.toActorKind,
        role: input.toRole,
        displayName: input.toDisplayName,
        attested: input.toAttested
    });
    if (toActor.kind === "unattributed")
        throw new Error("Handoff requires a to-actor (--to)");
    const target = normalizeTarget(input.target);
    const reason = trimmed(input.reason) || "handoff";
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "collaboration.handoff",
        decision: "recorded",
        source: recorder.source,
        actor: recorder.id,
        ...auditTargetFields(target),
        metadata: compact({ from: fromActor.id, to: toActor.id, reason, targetKind: target.kind })
    });
    const record = compact({
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        id: createCollabId(run, "handoff", state.handoffs.length),
        runId: run.id,
        createdAt: new Date().toISOString(),
        actor: recorder,
        fromActor,
        toActor,
        target,
        reason,
        auditEventIds: [audit.id]
    });
    state.handoffs.push(record);
    persist(run, options);
    return record;
}
function setReviewPolicy(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const policy = {
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        id: state.policy?.id || createCollabId(run, "policy", 0),
        requiredApprovals: Math.max(0, Math.floor(toNumber(input.requiredApprovals, state.policy?.requiredApprovals ?? 0))),
        authorizedRoles: toStringList(input.authorizedRoles, state.policy?.authorizedRoles ?? ["*"]),
        allowSelfApproval: input.allowSelfApproval ?? state.policy?.allowSelfApproval ?? false,
        requireAttestedActor: input.requireAttestedActor ?? state.policy?.requireAttestedActor ?? false,
        appliesTo: toTargetKindList(input.appliesTo, state.policy?.appliesTo ?? ["commit"]),
        updatedAt: new Date().toISOString()
    };
    state.policy = policy;
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "collaboration.review-policy",
        decision: "recorded",
        source: "operator-recorded",
        metadata: compact({
            policyId: policy.id,
            requiredApprovals: policy.requiredApprovals,
            authorizedRoles: policy.authorizedRoles,
            allowSelfApproval: policy.allowSelfApproval,
            requireAttestedActor: policy.requireAttestedActor,
            appliesTo: policy.appliesTo
        })
    });
    persist(run, options);
    return policy;
}
// ---------------------------------------------------------------------------
// Deterministic review-state derivation (the fail-closed heart)
// ---------------------------------------------------------------------------
function resolveReviewPolicy(run, policy) {
    return policy || run.collaboration?.policy || undefined;
}
/** Pure projection: derive a target's review state from append-only records +
 *  policy. Deterministic over a fixed run snapshot (no wall-clock). */
function deriveReviewState(run, target, options = {}) {
    const normalized = normalizeTarget(target);
    const policy = resolveReviewPolicy(run, options.policy);
    const related = (options.relatedTargets && options.relatedTargets.length ? options.relatedTargets : [normalized]).map(normalizeTarget);
    const selfIds = new Set((options.selfActorIds || []).filter(Boolean));
    const approvals = (run.collaboration?.approvals || []).filter((record) => matchesAnyTarget(record.target, related));
    // git-style supersession: a record named by any `supersedes` is retired.
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
            // A reject from an authorized, attested actor is a blocking veto.
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
    return {
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        runId: run.id,
        target: normalized,
        status,
        gated,
        policyId: policy?.id,
        requiredApprovals: required,
        recordedApprovals,
        approvers,
        approvals: counted,
        rejections,
        disqualified,
        missing
    };
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
/** The StateNodeErrors a review gate contributes. Empty when the target is not
 *  gated or the gate is satisfied — so it can only ADD constraints, never remove
 *  the verifier's. */
function reviewGateErrors(run, input) {
    const policy = resolveReviewPolicy(run, input.policy);
    if (!policy || policy.requiredApprovals <= 0 || !policy.appliesTo.includes(input.targetKind))
        return [];
    const target = gateTarget(input);
    const related = gateRelatedTargets(input);
    const state = deriveReviewState(run, target, { policy, relatedTargets: related, selfActorIds: input.selfActorIds });
    if (state.status === "approved")
        return [];
    return [
        {
            code: "review-gate-missing-approvals",
            message: `Review gate blocked (${state.status}): ${state.missing.join("; ")}`,
            at: new Date().toISOString(),
            retryable: false,
            details: {
                reviewStatus: state.status,
                requiredApprovals: state.requiredApprovals,
                recordedApprovals: state.recordedApprovals,
                approvers: state.approvers,
                missing: state.missing,
                policyId: state.policyId,
                targetKind: input.targetKind
            }
        }
    ];
}
/** When a gated commit passes, stamp who approved the very artifact that shipped. */
function commitReviewProvenance(run, input) {
    const policy = resolveReviewPolicy(run, input.policy);
    if (!policy || policy.requiredApprovals <= 0 || !policy.appliesTo.includes(input.targetKind))
        return undefined;
    const target = gateTarget(input);
    const state = deriveReviewState(run, target, {
        policy,
        relatedTargets: gateRelatedTargets(input),
        selfActorIds: input.selfActorIds
    });
    if (state.status !== "approved")
        return undefined;
    return {
        policyId: policy.id,
        requiredApprovals: state.requiredApprovals,
        recordedApprovals: state.recordedApprovals,
        approvers: state.approvers,
        approvalIds: state.approvals.map((record) => record.id).sort(),
        target
    };
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
    return { kind: "run", id: run_id_or_pending(input) };
}
function run_id_or_pending(input) {
    return input.commitId || input.candidateId || input.selectionId || "(pending)";
}
/** A commit/selection counts approvals on ITSELF and its underlying
 *  candidate/selection — you approve the candidate, the commit honors it. */
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
/** Self ids for a candidate/selection target: its producing worker + selector. */
function selfActorIdsForCandidate(run, candidateId, selectionId) {
    const ids = new Set();
    const candidate = candidateId ? (run.candidates || []).find((entry) => entry.id === candidateId) : undefined;
    if (candidate?.workerId)
        ids.add(candidate.workerId);
    const selections = (run.candidateSelections || []).filter((selection) => (selectionId && selection.id === selectionId) || (candidateId && selection.candidateId === candidateId));
    for (const selection of selections)
        if (selection.selectedBy)
            ids.add(selection.selectedBy);
    return [...ids];
}
function buildReviewStatusReport(run, options) {
    ensureCollaborationState(run);
    const policy = run.collaboration?.policy;
    const approvals = run.collaboration?.approvals || [];
    const comments = run.collaboration?.comments || [];
    const handoffs = run.collaboration?.handoffs || [];
    const targets = options.target ? [normalizeTarget(options.target)] : distinctTargets(run);
    const reviewStates = targets.map((target) => deriveReviewState(run, target, {
        policy,
        relatedTargets: relatedTargetsFor(run, target),
        selfActorIds: selfActorIdsForTarget(run, target)
    }));
    const owner = deriveOwner(run);
    const timeline = buildTimeline(run);
    return {
        schemaVersion: exports.COLLABORATION_SCHEMA_VERSION,
        surface: "collaboration",
        runId: run.id,
        generatedAt: options.now,
        policy,
        owner,
        targets: reviewStates,
        counts: {
            approvals: approvals.filter((record) => record.decision === "approve").length,
            rejections: approvals.filter((record) => record.decision === "reject").length,
            comments: comments.length,
            handoffs: handoffs.length
        },
        timeline,
        nextActions: buildNextActions(run, reviewStates, policy)
    };
}
function listComments(run, target) {
    const comments = run.collaboration?.comments || [];
    const filtered = target ? comments.filter((record) => sameTarget(record.target, normalizeTarget(target))) : comments;
    return [...filtered].sort(compareByCreated);
}
function deriveOwner(run) {
    const handoffs = [...(run.collaboration?.handoffs || [])]
        .filter((record) => record.target.kind === "run" || record.target.kind === "task")
        .sort(compareByCreated);
    return handoffs.length ? handoffs[handoffs.length - 1].toActor : undefined;
}
function buildTimeline(run) {
    const entries = [];
    for (const record of run.collaboration?.approvals || []) {
        entries.push({
            kind: "approval",
            id: record.id,
            createdAt: record.createdAt,
            actor: record.actor,
            target: record.target,
            summary: `${record.decision === "approve" ? "approved" : "rejected"} ${record.target.kind} ${record.target.id}${record.rationale ? ` — ${record.rationale}` : ""}`
        });
    }
    for (const record of run.collaboration?.comments || []) {
        entries.push({
            kind: "comment",
            id: record.id,
            createdAt: record.createdAt,
            actor: record.actor,
            target: record.target,
            summary: `commented on ${record.target.kind} ${record.target.id}: ${truncate(record.body, 80)}`
        });
    }
    for (const record of run.collaboration?.handoffs || []) {
        entries.push({
            kind: "handoff",
            id: record.id,
            createdAt: record.createdAt,
            actor: record.actor,
            target: record.target,
            summary: `handed off ${record.target.kind} ${record.target.id}: ${record.fromActor.id} → ${record.toActor.id} (${record.reason})`
        });
    }
    if (run.collaboration?.policy) {
        const policy = run.collaboration.policy;
        entries.push({
            kind: "policy",
            id: policy.id,
            createdAt: policy.updatedAt,
            actor: { ...exports.UNATTRIBUTED_ACTOR, kind: "operator", id: "operator", attestation: "operator-recorded", source: "operator-recorded" },
            summary: `review policy: ${policy.requiredApprovals} approval(s) from [${policy.authorizedRoles.join(", ")}] for [${policy.appliesTo.join(", ")}]`
        });
    }
    return entries.sort(compareByCreated);
}
function buildNextActions(run, states, policy) {
    const actions = [];
    if (!policy) {
        actions.push(`node scripts/cw.js review policy ${run.id} --requiredApprovals 1 --authorizedRoles reviewer --appliesTo commit`);
        return actions;
    }
    for (const state of states) {
        if (state.status === "pending" || state.status === "blocked" || state.status === "unattributed") {
            actions.push(`node scripts/cw.js approve ${state.target.kind} ${run.id} ${state.target.id} --role <authorized-role> --actor <id> --attested`);
        }
    }
    if (!actions.length)
        actions.push(`node scripts/cw.js review status ${run.id} --json`);
    return actions;
}
// ---------------------------------------------------------------------------
// Human formatters
// ---------------------------------------------------------------------------
function formatReviewStatus(report) {
    const lines = [];
    const policy = report.policy;
    lines.push(`review ${report.runId}  policy=${policy ? `${policy.requiredApprovals} from [${policy.authorizedRoles.join(",")}] on [${policy.appliesTo.join(",")}]` : "none"}`);
    if (report.owner)
        lines.push(`  owner: ${report.owner.id} (${report.owner.attestation})`);
    lines.push(`  counts: approvals=${report.counts.approvals} rejections=${report.counts.rejections} comments=${report.counts.comments} handoffs=${report.counts.handoffs}`);
    for (const state of report.targets) {
        lines.push(`  ${state.target.kind} ${state.target.id}: ${state.status}` +
            (state.gated ? ` (${state.recordedApprovals}/${state.requiredApprovals}${state.approvers.length ? ` by ${state.approvers.join(",")}` : ""})` : " (not gated)"));
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
    return comments
        .map((record) => `${record.createdAt}  ${record.actor.id} (${record.actor.attestation})  [${record.target.kind} ${record.target.id}]  ${record.body}`)
        .join("\n");
}
// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------
function distinctTargets(run) {
    const seen = new Map();
    for (const record of run.collaboration?.approvals || [])
        seen.set(targetKey(record.target), record.target);
    for (const record of run.collaboration?.comments || [])
        seen.set(targetKey(record.target), record.target);
    for (const record of run.collaboration?.handoffs || [])
        seen.set(targetKey(record.target), record.target);
    return [...seen.values()].sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
}
/** For a commit target, also count its candidate/selection approvals. */
function relatedTargetsFor(run, target) {
    if (target.kind !== "commit")
        return [target];
    const commit = (run.commits || []).find((entry) => entry.id === target.id);
    const related = [target];
    if (commit?.selectionId)
        related.push({ kind: "selection", id: commit.selectionId });
    if (commit?.candidateId)
        related.push({ kind: "candidate", id: commit.candidateId });
    return related;
}
function selfActorIdsForTarget(run, target) {
    if (target.kind === "candidate")
        return selfActorIdsForCandidate(run, target.id);
    if (target.kind === "selection") {
        const selection = (run.candidateSelections || []).find((entry) => entry.id === target.id);
        return selfActorIdsForCandidate(run, selection?.candidateId, target.id);
    }
    if (target.kind === "commit") {
        const commit = (run.commits || []).find((entry) => entry.id === target.id);
        return selfActorIdsForCandidate(run, commit?.candidateId, commit?.selectionId);
    }
    return [];
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
function auditTargetFields(target) {
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
function matchesAnyTarget(target, related) {
    return related.some((entry) => sameTarget(target, entry));
}
function sameTarget(left, right) {
    return left.kind === right.kind && left.id === right.id;
}
function targetKey(target) {
    return `${target.kind}:${target.id}`;
}
function createCollabId(run, kind, count) {
    // Deterministic (FreeBSD-audit L12/L13): caller-supplied count (approvals/comments/
    // handoffs length), no wall-clock stamp. The collab id is bound into the trust-audit
    // chain via linkedAuditEventIds, so a stable id keeps that reproducible.
    return `collab-${(0, state_1.safeFileName)(kind)}-${String(count + 1).padStart(4, "0")}`;
}
function persist(run, options) {
    if (options.persist === false)
        return;
    (0, state_1.saveCheckpoint)(run);
}
function compareByCreated(left, right) {
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function trimmed(value) {
    if (value === undefined || value === null)
        return "";
    return String(value).trim();
}
function truncate(value, max) {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function toNumber(value, fallback) {
    if (value === undefined || value === null || value === "" || value === true)
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function toStringList(value, fallback) {
    if (value === undefined)
        return fallback;
    const list = Array.isArray(value) ? value : String(value).split(",");
    const cleaned = list.map((entry) => String(entry).trim()).filter(Boolean);
    return cleaned.length ? unique(cleaned) : fallback;
}
function toTargetKindList(value, fallback) {
    if (value === undefined)
        return fallback;
    const list = Array.isArray(value) ? value : String(value).split(",");
    const valid = ["run", "task", "candidate", "selection", "commit", "node"];
    const cleaned = list
        .map((entry) => String(entry).trim())
        .filter((entry) => valid.includes(entry));
    return cleaned.length ? unique(cleaned) : fallback;
}
function unique(values) {
    return Array.from(new Set(values));
}
