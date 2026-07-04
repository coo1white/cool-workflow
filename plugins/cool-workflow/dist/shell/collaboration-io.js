"use strict";
// shell/collaboration-io.ts — the impure wrapper around
// core/multi-agent/collaboration.ts's pure record builders + review-state
// projection: recordApproval/recordComment/recordHandoff/setReviewPolicy/
// deriveReviewState/reviewGateErrors, plus the read-only reports.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// src/collaboration.ts: trust-audit recording + saveCheckpoint.
//
// Evidence: SPEC/multi-agent.md section F; plugins/cool-workflow/src/
// collaboration.ts (byte-exact source for the wiring sequence).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCommentList = exports.formatReviewStatus = void 0;
exports.ensureCollaborationState = ensureCollaborationState;
exports.recordApproval = recordApproval;
exports.recordComment = recordComment;
exports.recordHandoff = recordHandoff;
exports.setReviewPolicy = setReviewPolicy;
exports.resolveReviewPolicy = resolveReviewPolicy;
exports.selfActorIdsForCandidate = selfActorIdsForCandidate;
exports.deriveReviewState = deriveReviewState;
exports.reviewGateErrors = reviewGateErrors;
exports.commitReviewProvenance = commitReviewProvenance;
exports.buildReviewStatusReport = buildReviewStatusReport;
exports.listComments = listComments;
exports.deriveOwner = deriveOwner;
const trust_audit_1 = require("./trust-audit");
const run_store_1 = require("./run-store");
const collab = __importStar(require("../core/multi-agent/collaboration"));
function now() {
    return new Date().toISOString();
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
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function ensureCollaborationState(run) {
    const existing = run.collaboration;
    const state = existing || collab.emptyCollaborationState();
    if (!Array.isArray(state.approvals))
        state.approvals = [];
    if (!Array.isArray(state.comments))
        state.comments = [];
    if (!Array.isArray(state.handoffs))
        state.handoffs = [];
    run.collaboration = state;
    return state;
}
function persist(run, options) {
    if (options.persist === false)
        return;
    (0, run_store_1.saveCheckpoint)(run);
}
function recordApproval(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const actor = collab.normalizeActor(input);
    const target = collab.normalizeTarget(input.target);
    const decision = input.decision === "reject" ? "reject" : "approve";
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function recordComment(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const actor = collab.normalizeActor(input);
    const target = collab.normalizeTarget(input.target);
    const threadId = input.threadId?.trim() || `${target.kind}:${target.id}`;
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "collaboration.comment", decision: "recorded", source: actor.source, actor: actor.id, ...auditTargetFields(target), agentRoleId: actor.roleId, metadata: compact({ threadId, parentId: input.parentId, targetKind: target.kind }) });
    const record = collab.buildComment(input, state.comments.length, run.id, now(), audit.id);
    state.comments.push(record);
    persist(run, options);
    return record;
}
function recordHandoff(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const recorder = collab.normalizeActor(input);
    const fromActor = input.fromActor ? collab.normalizeActor({ actor: input.fromActor, actorKind: input.fromActorKind, role: input.fromRole, attested: input.attested }) : recorder;
    const toActor = collab.normalizeActor({ actor: input.toActor, actorKind: input.toActorKind, role: input.toRole, displayName: input.toDisplayName, attested: input.toAttested });
    const target = collab.normalizeTarget(input.target);
    const reason = input.reason?.trim() || "handoff";
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "collaboration.handoff", decision: "recorded", source: recorder.source, actor: recorder.id, ...auditTargetFields(target), metadata: compact({ from: fromActor.id, to: toActor.id, reason, targetKind: target.kind }) });
    const record = collab.buildHandoff(input, state.handoffs.length, run.id, now(), audit.id);
    state.handoffs.push(record);
    persist(run, options);
    return record;
}
function setReviewPolicy(run, input, options = {}) {
    const state = ensureCollaborationState(run);
    const policy = collab.buildReviewPolicy(input, state.policy, now());
    state.policy = policy;
    (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "collaboration.review-policy", decision: "recorded", source: "operator-recorded", metadata: compact({ policyId: policy.id, requiredApprovals: policy.requiredApprovals, authorizedRoles: policy.authorizedRoles, allowSelfApproval: policy.allowSelfApproval, requireAttestedActor: policy.requireAttestedActor, appliesTo: policy.appliesTo }) });
    persist(run, options);
    return policy;
}
function resolveReviewPolicy(run, policy) {
    return policy || ensureCollaborationState(run).policy || undefined;
}
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
function candidateWorkerId(run, candidateId) {
    const candidate = candidateId ? (run.candidates || []).find((entry) => entry.id === candidateId) : undefined;
    return candidate?.workerId;
}
function selectedByForCandidate(run, candidateId, selectionId) {
    const selections = (run.candidateSelections || []).filter((selection) => (selectionId && selection.id === selectionId) || (candidateId && selection.candidateId === candidateId));
    return selections.map((selection) => selection.selectedBy).filter((id) => Boolean(id));
}
function selfActorIdsForCandidate(run, candidateId, selectionId) {
    return collab.selfActorIdsForCandidate(candidateWorkerId(run, candidateId), selectedByForCandidate(run, candidateId, selectionId));
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
function deriveReviewState(run, target, options = {}) {
    const state = ensureCollaborationState(run);
    const policy = resolveReviewPolicy(run, options.policy);
    return collab.deriveReviewState(run.id, state.approvals, target, { ...options, policy });
}
function reviewGateErrors(run, input) {
    const state = ensureCollaborationState(run);
    const policy = resolveReviewPolicy(run, input.policy);
    return collab.reviewGateErrors(run.id, state.approvals, { ...input, policy }, now());
}
function commitReviewProvenance(run, input) {
    const state = ensureCollaborationState(run);
    const policy = resolveReviewPolicy(run, input.policy);
    return collab.commitReviewProvenance(run.id, state.approvals, { ...input, policy });
}
function buildReviewStatusReport(run, options) {
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
function listComments(run, target) {
    return collab.listComments(ensureCollaborationState(run), target);
}
function deriveOwner(run) {
    return collab.deriveOwner(ensureCollaborationState(run).handoffs);
}
exports.formatReviewStatus = collab.formatReviewStatus;
exports.formatCommentList = collab.formatCommentList;
