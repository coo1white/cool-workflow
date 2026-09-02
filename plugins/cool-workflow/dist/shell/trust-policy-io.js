"use strict";
// shell/trust-policy-io.ts — the impure wrapper around core/multi-agent/
// trust-policy.ts's pure policy evaluation: authorizeMultiAgentAction
// (records the permission + policy.violation audit events),
// recordBlackboardWriteAudit, recordMessageProvenanceAudit,
// recordJudgeRationaleAudit, summarizeMultiAgentTrust,
// hasAcceptedJudgeRationale.
//
// MILESTONE 9. Byte-exact port of the audit-recording half of the old
// build's multi-agent-trust module.
//
// Evidence: SPEC/multi-agent.md section D ("Trust policies"), "Trust
// denial reasons".
Object.defineProperty(exports, "__esModule", { value: true });
exports.policyForRole = exports.policyForMembership = exports.policyForGroup = void 0;
exports.authorizeMultiAgentAction = authorizeMultiAgentAction;
exports.assertMultiAgentActionAllowed = assertMultiAgentActionAllowed;
exports.recordBlackboardWriteAudit = recordBlackboardWriteAudit;
exports.hashText = hashText;
exports.recordMessageProvenanceAudit = recordMessageProvenanceAudit;
exports.recordJudgeRationaleAudit = recordJudgeRationaleAudit;
exports.summarizeMultiAgentTrust = summarizeMultiAgentTrust;
exports.hasAcceptedJudgeRationale = hasAcceptedJudgeRationale;
exports.recordRolePolicyAudit = recordRolePolicyAudit;
const runtime_1 = require("../core/multi-agent/runtime");
const trust_policy_1 = require("../core/multi-agent/trust-policy");
const trust_audit_1 = require("./trust-audit");
const hash_1 = require("../core/hash");
function policyRunId(run, roleId, groupId, membershipId) {
    const membership = membershipId ? (0, runtime_1.getAgentMembership)(run, membershipId) : undefined;
    if (membership)
        return membership.multiAgentRunId;
    const role = roleId ? (0, runtime_1.getAgentRole)(run, roleId) : undefined;
    if (role)
        return role.multiAgentRunId;
    const group = groupId ? (0, runtime_1.getAgentGroup)(run, groupId) : undefined;
    return group?.multiAgentRunId;
}
function authorizeMultiAgentAction(run, input) {
    const roleId = input.agentRoleId || (input.actor?.kind === "role" ? input.actor.id : undefined);
    const membershipId = input.agentMembershipId || (input.actor?.kind === "membership" ? input.actor.id : undefined);
    const groupId = input.agentGroupId || (input.actor?.kind === "group" ? input.actor.id : undefined);
    const policy = (0, trust_policy_1.resolvePolicy)({ roleId, membershipId, groupId }, {
        membership: (id) => (0, runtime_1.getAgentMembership)(run, id),
        role: (id) => (0, runtime_1.getAgentRole)(run, id),
        group: (id) => (0, runtime_1.getAgentGroup)(run, id),
    });
    const core = (0, trust_policy_1.evaluateMultiAgentAction)(policy, input.operation, input.blackboardTopicId, input.evidenceRefs || []);
    const metadata = { operation: input.operation, reason: core.reason, policyRef: policy?.policyRef, ...(input.metadata || {}) };
    const event = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.permission",
        decision: core.allowed ? "allowed" : "denied",
        source: "cw-validated",
        actor: input.actor?.id,
        multiAgentRunId: input.multiAgentRunId || policyRunId(run, roleId, groupId, membershipId),
        agentRoleId: roleId,
        agentGroupId: groupId,
        agentMembershipId: membershipId,
        agentFanoutId: input.agentFanoutId,
        agentFaninId: input.agentFaninId,
        blackboardId: input.blackboardId,
        blackboardTopicId: input.blackboardTopicId,
        blackboardMessageId: input.blackboardMessageId,
        blackboardContextId: input.blackboardContextId,
        blackboardArtifactRefId: input.blackboardArtifactRefId,
        blackboardSnapshotId: input.blackboardSnapshotId,
        coordinatorDecisionId: input.coordinatorDecisionId,
        candidateId: input.candidateId,
        scoreId: input.scoreId,
        selectionId: input.selectionId,
        commitId: input.commitId,
        sandboxProfileId: input.sandboxProfileId,
        evidence: input.evidence,
        evidenceRefs: input.evidenceRefs,
        policyRef: policy?.policyRef,
        metadata,
    });
    if (!core.allowed) {
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
            kind: "policy.violation",
            decision: "denied",
            source: "cw-validated",
            actor: input.actor?.id,
            multiAgentRunId: input.multiAgentRunId || policyRunId(run, roleId, groupId, membershipId),
            agentRoleId: roleId,
            agentGroupId: groupId,
            agentMembershipId: membershipId,
            blackboardId: input.blackboardId,
            blackboardTopicId: input.blackboardTopicId,
            candidateId: input.candidateId,
            selectionId: input.selectionId,
            evidenceRefs: input.evidenceRefs,
            parentEventIds: [event.id],
            policyRef: policy?.policyRef,
            metadata,
        });
    }
    return { allowed: core.allowed, decision: core.decision, reason: core.reason, policyRef: core.policyRef, policy: core.policy, missingEvidenceRefs: core.missingEvidenceRefs, event };
}
function assertMultiAgentActionAllowed(run, input) {
    const decision = authorizeMultiAgentAction(run, input);
    if (!decision.allowed)
        throw new Error(decision.reason);
    return decision;
}
function sourceForActor(actor) {
    if (!actor)
        return "operator-recorded";
    if (actor.kind === "worker")
        return "host-attested";
    if (actor.kind === "operator")
        return "operator-recorded";
    if (actor.kind === "runtime" || actor.kind === "coordinator" || actor.kind === "verifier")
        return "runtime-derived";
    return "cw-validated";
}
function recordBlackboardWriteAudit(run, input) {
    return (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "blackboard.write",
        decision: input.status === "denied" || input.status === "blocked" ? "denied" : input.status === "conflicting" ? "failed" : "accepted",
        source: sourceForActor(input.actor),
        actor: input.actor?.id,
        multiAgentRunId: input.multiAgentRunId,
        agentRoleId: input.agentRoleId,
        agentGroupId: input.agentGroupId,
        agentMembershipId: input.agentMembershipId,
        agentFanoutId: input.agentFanoutId,
        agentFaninId: input.agentFaninId,
        blackboardId: input.blackboardId,
        blackboardTopicId: input.blackboardTopicId,
        blackboardMessageId: input.blackboardMessageId,
        blackboardContextId: input.blackboardContextId,
        blackboardArtifactRefId: input.blackboardArtifactRefId,
        blackboardSnapshotId: input.blackboardSnapshotId,
        coordinatorDecisionId: input.coordinatorDecisionId,
        evidenceRefs: input.evidenceRefs,
        parentEventIds: input.parentEventIds,
        policyRef: input.policyRef,
        metadata: { operation: input.operation, status: input.status, ...(input.metadata || {}) },
    });
}
function hashText(value) {
    return (0, hash_1.sha256)(value);
}
function recordMessageProvenanceAudit(run, input) {
    return (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "blackboard.message-provenance",
        decision: "recorded",
        source: sourceForActor(input.actor),
        actor: input.actor?.id,
        workerId: input.workerId,
        multiAgentRunId: input.multiAgentRunId,
        agentRoleId: input.agentRoleId,
        agentGroupId: input.agentGroupId,
        agentMembershipId: input.agentMembershipId,
        blackboardId: input.blackboardId,
        blackboardTopicId: input.topicId,
        blackboardMessageId: input.messageId,
        evidenceRefs: input.evidenceRefs,
        parentEventIds: input.parentEventIds,
        policyRef: input.policyRef,
        metadata: {
            authorKind: input.actor?.kind,
            bodyHash: hashText(input.body),
            summary: input.body.trim().slice(0, 120),
            parentMessageIds: input.parentMessageIds || [],
            topicScope: input.topicId,
            locator: `${input.blackboardId}/messages/${input.messageId}`,
        },
    });
}
function recordJudgeRationaleAudit(run, input) {
    return (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: input.kind || "judge.rationale",
        decision: input.evidenceRefs?.length && input.rationale ? "accepted" : "denied",
        source: "cw-validated",
        actor: input.actor?.id,
        multiAgentRunId: input.multiAgentRunId,
        agentRoleId: input.agentRoleId,
        agentGroupId: input.agentGroupId,
        agentMembershipId: input.agentMembershipId,
        blackboardId: input.blackboardId,
        blackboardTopicId: input.blackboardTopicId,
        blackboardMessageId: input.blackboardMessageId,
        coordinatorDecisionId: input.coordinatorDecisionId,
        candidateId: input.candidateId,
        scoreId: input.scoreId,
        selectionId: input.selectionId,
        evidenceRefs: input.evidenceRefs,
        parentEventIds: input.parentEventIds,
        policyRef: input.policyRef,
        metadata: { rationale: input.rationale?.slice(0, 240) },
    });
}
function summarizeMultiAgentTrust(run) {
    const events = (0, trust_audit_1.listTrustAuditEvents)(run);
    const roles = (run.multiAgent?.roles || []);
    const rolePolicies = roles.map((role) => role.policy || (0, trust_policy_1.policyForRole)(role));
    const byKind = (kind) => events.filter((event) => event.kind === kind);
    const policyViolations = byKind("policy.violation");
    return {
        schemaVersion: 1,
        runId: run.id,
        rolePolicies,
        permissionDecisions: byKind("multi-agent.permission"),
        blackboardWrites: byKind("blackboard.write"),
        messageProvenance: byKind("blackboard.message-provenance"),
        judgeRationales: byKind("judge.rationale"),
        panelDecisions: byKind("judge.panel-decision"),
        policyViolations,
        nextAction: policyViolations.length ? `cw audit policy ${run.id}` : `cw audit multi-agent ${run.id} --json`,
    };
}
function hasAcceptedJudgeRationale(run, input = {}) {
    return (0, trust_audit_1.listTrustAuditEvents)(run).some((event) => event.kind === "judge.rationale" &&
        event.decision === "accepted" &&
        (!input.multiAgentRunId || event.multiAgentRunId === input.multiAgentRunId) &&
        (!input.candidateId || event.candidateId === input.candidateId) &&
        (!input.scoreId || !event.scoreId || event.scoreId === input.scoreId));
}
function recordRolePolicyAudit(run, role) {
    return (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "multi-agent.role-policy", decision: "recorded", source: "runtime-derived", multiAgentRunId: role.multiAgentRunId, agentRoleId: role.id, blackboardId: role.blackboardId, policyRef: role.policy?.policyRef, metadata: role.policy });
}
var trust_policy_2 = require("../core/multi-agent/trust-policy");
Object.defineProperty(exports, "policyForGroup", { enumerable: true, get: function () { return trust_policy_2.policyForGroup; } });
Object.defineProperty(exports, "policyForMembership", { enumerable: true, get: function () { return trust_policy_2.policyForMembership; } });
Object.defineProperty(exports, "policyForRole", { enumerable: true, get: function () { return trust_policy_2.policyForRole; } });
