"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collaborationApprove = collaborationApprove;
exports.collaborationComment = collaborationComment;
exports.collaborationCommentList = collaborationCommentList;
exports.collaborationHandoff = collaborationHandoff;
exports.reviewStatus = reviewStatus;
exports.reviewPolicy = reviewPolicy;
exports.formatReviewStatus = formatReviewStatus;
exports.formatCommentList = formatCommentList;
const state_1 = require("../state");
const report_1 = require("./report");
const cli_options_1 = require("./cli-options");
const collaboration_1 = require("../collaboration");
function collaborationApprove(run, targetKind, targetId, options = {}, decision = "approve") {
    const record = (0, collaboration_1.recordApproval)(run, {
        target: (0, cli_options_1.collaborationTarget)(targetKind, targetId),
        decision,
        ...(0, cli_options_1.actorInputFrom)(options),
        rationale: (0, cli_options_1.stringOption)(options.rationale) || (0, cli_options_1.stringOption)(options.reason) || (0, cli_options_1.stringOption)(options.message),
        supersedes: (0, cli_options_1.stringOption)(options.supersedes)
    }, { persist: false });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function collaborationComment(run, targetKind, targetId, options = {}) {
    const record = (0, collaboration_1.recordComment)(run, {
        target: (0, cli_options_1.collaborationTarget)(targetKind, targetId),
        body: (0, cli_options_1.stringOption)(options.body) || (0, cli_options_1.stringOption)(options.message) || (0, cli_options_1.stringOption)(options.text) || "",
        threadId: (0, cli_options_1.stringOption)(options.thread) || (0, cli_options_1.stringOption)(options.threadId),
        parentId: (0, cli_options_1.stringOption)(options.parent) || (0, cli_options_1.stringOption)(options.parentId),
        ...(0, cli_options_1.actorInputFrom)(options)
    }, { persist: false });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function collaborationCommentList(run, options = {}) {
    const target = (0, cli_options_1.collaborationTargetMaybe)((0, cli_options_1.stringOption)(options.targetKind) || (0, cli_options_1.stringOption)(options.kind), (0, cli_options_1.stringOption)(options.target) || (0, cli_options_1.stringOption)(options.targetId));
    const comments = (0, collaboration_1.listComments)(run, target);
    return { schemaVersion: 1, surface: "collaboration", runId: run.id, target, count: comments.length, comments };
}
function collaborationHandoff(run, targetKind, targetId, options = {}) {
    const record = (0, collaboration_1.recordHandoff)(run, {
        target: (0, cli_options_1.collaborationTarget)(targetKind, targetId),
        toActor: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "to", "toActor")),
        toActorKind: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "toKind", "to-kind", "toActorKind")),
        toRole: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "toRole", "to-role")),
        toDisplayName: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "toName", "to-name", "toDisplayName")),
        toAttested: Boolean((0, cli_options_1.firstDefined)(options, "toAttested", "to-attested")),
        fromActor: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "from", "fromActor")),
        fromActorKind: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "fromKind", "from-kind", "fromActorKind")),
        fromRole: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "fromRole", "from-role")),
        reason: (0, cli_options_1.stringOption)(options.reason) || (0, cli_options_1.stringOption)(options.message) || "handoff",
        ...(0, cli_options_1.actorInputFrom)(options)
    }, { persist: false });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function reviewStatus(run, options = {}) {
    const now = typeof options.now === "string" && options.now ? options.now : new Date().toISOString();
    const target = (0, cli_options_1.collaborationTargetMaybe)((0, cli_options_1.stringOption)(options.targetKind) || (0, cli_options_1.stringOption)(options.kind), (0, cli_options_1.stringOption)(options.target) || (0, cli_options_1.stringOption)(options.targetId));
    return (0, collaboration_1.buildReviewStatusReport)(run, { now, target });
}
function reviewPolicy(run, options = {}) {
    const allowSelf = (0, cli_options_1.firstDefined)(options, "allowSelfApproval", "allow-self-approval");
    const requireAttested = (0, cli_options_1.firstDefined)(options, "requireAttestedActor", "require-attested-actor");
    const policy = (0, collaboration_1.setReviewPolicy)(run, {
        requiredApprovals: (0, cli_options_1.numberOption)((0, cli_options_1.firstDefined)(options, "requiredApprovals", "required-approvals", "required", "approvals")),
        authorizedRoles: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "authorizedRoles", "authorized-roles", "roles")),
        allowSelfApproval: allowSelf === undefined ? undefined : Boolean(allowSelf),
        requireAttestedActor: requireAttested === undefined ? undefined : Boolean(requireAttested),
        appliesTo: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "appliesTo", "applies-to", "targets"))
    }, { persist: false });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return { schemaVersion: 1, surface: "collaboration", runId: run.id, policy };
}
function formatReviewStatus(report) {
    return (0, collaboration_1.formatReviewStatus)(report);
}
function formatCommentList(comments) {
    return (0, collaboration_1.formatCommentList)(comments);
}
