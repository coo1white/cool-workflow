"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.policyForRole = policyForRole;
exports.policyForGroup = policyForGroup;
exports.policyForMembership = policyForMembership;
exports.recordRolePolicyAudit = recordRolePolicyAudit;
exports.authorizeMultiAgentAction = authorizeMultiAgentAction;
exports.assertMultiAgentActionAllowed = assertMultiAgentActionAllowed;
exports.recordBlackboardWriteAudit = recordBlackboardWriteAudit;
exports.recordMessageProvenanceAudit = recordMessageProvenanceAudit;
exports.recordJudgeRationaleAudit = recordJudgeRationaleAudit;
exports.summarizeMultiAgentTrust = summarizeMultiAgentTrust;
exports.hasAcceptedJudgeRationale = hasAcceptedJudgeRationale;
exports.sourceForActor = sourceForActor;
exports.hashText = hashText;
const execution_backend_1 = require("./execution-backend");
const trust_audit_1 = require("./trust-audit");
function policyForRole(role) {
    const topologyRole = String(role.metadata?.topologyRoleId || role.title || "").toLowerCase();
    const isChair = topologyRole.includes("chair") || topologyRole.includes("reducer") || topologyRole.includes("synthesizer");
    const isJudge = topologyRole.includes("judge");
    return {
        schemaVersion: 1,
        id: `${role.id}-policy`,
        policyRef: `multiAgent.roles.${role.id}.policy`,
        subjectKind: "role",
        subjectId: role.id,
        allowedBlackboardTopicIds: unique(role.topicIds || ["*"]),
        allowedWriteOperations: unique([
            "message",
            "context",
            "artifact",
            ...(isChair ? ["snapshot", "coordinator-decision"] : [])
        ]),
        allowedCandidateOperations: isChair ? ["score", "select"] : ["score"],
        allowedJudgeOperations: unique([
            ...(isJudge ? ["verdict", "rationale"] : []),
            ...(isChair ? ["rationale", "panel-decision"] : [])
        ]),
        sandboxProfileHints: unique(role.sandboxProfileHints || []),
        requiredEvidenceRefs: unique(role.requiredEvidence || []),
        requiredEvidenceFor: {
            "judge.rationale": ["judge rationale evidence"],
            "judge.verdict": ["judge verdict evidence"],
            "judge.panel-decision": ["judge messages", "score evidence", "coordinator decision"],
            "candidate.select": ["score evidence", "judge rationale"]
        },
        deniedOperations: [],
        metadata: { title: role.title, topologyRoleId: role.metadata?.topologyRoleId }
    };
}
function policyForGroup(group) {
    return {
        schemaVersion: 1,
        id: `${group.id}-policy`,
        policyRef: `multiAgent.groups.${group.id}.policy`,
        subjectKind: "group",
        subjectId: group.id,
        allowedBlackboardTopicIds: unique(group.topicIds || ["*"]),
        allowedWriteOperations: ["message", "context", "artifact", "snapshot", "coordinator-decision"],
        allowedCandidateOperations: ["register", "score", "select"],
        allowedJudgeOperations: ["verdict", "rationale", "panel-decision"],
        sandboxProfileHints: [],
        requiredEvidenceRefs: [],
        deniedOperations: [],
        metadata: { phase: group.phase }
    };
}
function policyForMembership(membership, role) {
    const source = role?.policy || (role ? policyForRole(role) : undefined);
    return {
        ...(source || {
            schemaVersion: 1,
            id: `${membership.id}-policy`,
            policyRef: `multiAgent.memberships.${membership.id}.policy`,
            subjectKind: "membership",
            subjectId: membership.id,
            allowedBlackboardTopicIds: unique(membership.topicIds || ["*"]),
            allowedWriteOperations: ["message", "context", "artifact"],
            allowedCandidateOperations: [],
            allowedJudgeOperations: [],
            sandboxProfileHints: [],
            requiredEvidenceRefs: [],
            deniedOperations: []
        }),
        id: `${membership.id}-policy`,
        policyRef: `multiAgent.memberships.${membership.id}.policy`,
        subjectKind: "membership",
        subjectId: membership.id
    };
}
function recordRolePolicyAudit(run, role) {
    return (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.role-policy",
        decision: "recorded",
        source: "runtime-derived",
        multiAgentRunId: role.multiAgentRunId,
        agentRoleId: role.id,
        blackboardId: role.blackboardId,
        policyRef: role.policy?.policyRef,
        metadata: role.policy
    });
}
function authorizeMultiAgentAction(run, input) {
    const roleId = input.agentRoleId || (input.actor?.kind === "role" ? input.actor.id : undefined);
    const membershipId = input.agentMembershipId || (input.actor?.kind === "membership" ? input.actor.id : undefined);
    const groupId = input.agentGroupId || (input.actor?.kind === "group" ? input.actor.id : undefined);
    const policy = resolvePolicy(run, { roleId, membershipId, groupId });
    const reason = evaluatePolicy(policy, input.operation, input.blackboardTopicId, input.evidenceRefs || []);
    const allowed = !reason;
    const metadata = {
        operation: input.operation,
        reason: reason || "allowed by explicit multi-agent policy",
        policyRef: policy?.policyRef,
        ...(input.metadata || {})
    };
    const event = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.permission",
        decision: allowed ? "allowed" : "denied",
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
        metadata
    });
    if (!allowed) {
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
            metadata
        });
    }
    return {
        allowed,
        decision: allowed ? "allowed" : "denied",
        reason: reason || "allowed by explicit multi-agent policy",
        policyRef: policy?.policyRef,
        policy,
        missingEvidenceRefs: missingEvidence(policy, input.operation, input.evidenceRefs || []),
        event
    };
}
function assertMultiAgentActionAllowed(run, input) {
    const decision = authorizeMultiAgentAction(run, input);
    if (!decision.allowed)
        throw new Error(decision.reason);
    return decision;
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
        metadata: { operation: input.operation, status: input.status, ...(input.metadata || {}) }
    });
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
            locator: `${input.blackboardId}/messages/${input.messageId}`
        }
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
        metadata: { rationale: input.rationale?.slice(0, 240) }
    });
}
function summarizeMultiAgentTrust(run) {
    const events = (0, trust_audit_1.listTrustAuditEvents)(run);
    const rolePolicies = (run.multiAgent?.roles || []).map((role) => role.policy || policyForRole(role));
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
        nextAction: policyViolations.length
            ? `node scripts/cw.js audit policy ${run.id}`
            : `node scripts/cw.js audit multi-agent ${run.id} --json`
    };
}
function hasAcceptedJudgeRationale(run, input = {}) {
    return (0, trust_audit_1.listTrustAuditEvents)(run).some((event) => event.kind === "judge.rationale" &&
        event.decision === "accepted" &&
        (!input.multiAgentRunId || event.multiAgentRunId === input.multiAgentRunId) &&
        (!input.candidateId || event.candidateId === input.candidateId) &&
        (!input.scoreId || !event.scoreId || event.scoreId === input.scoreId));
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
// Delegates to the shared execution-backend sha256 (F10 dedup). Byte-identical:
// both emit `sha256:<hex>` and Node's Hash.update(string) defaults to utf8, the
// same encoding the shared helper passes explicitly.
function hashText(value) {
    return (0, execution_backend_1.sha256)(value);
}
function resolvePolicy(run, input) {
    const membership = input.membershipId ? run.multiAgent?.memberships.find((entry) => entry.id === input.membershipId) : undefined;
    if (membership?.policy)
        return membership.policy;
    const roleId = input.roleId || membership?.roleId;
    const role = roleId ? run.multiAgent?.roles.find((entry) => entry.id === roleId) : undefined;
    if (role?.policy)
        return role.policy;
    if (role)
        return policyForRole(role);
    const group = input.groupId ? run.multiAgent?.groups.find((entry) => entry.id === input.groupId) : undefined;
    if (group?.policy)
        return group.policy;
    if (group)
        return policyForGroup(group);
    return undefined;
}
function evaluatePolicy(policy, operation, topicId, evidenceRefs) {
    if (!policy)
        return "missing role authority or policy";
    const denied = policy.deniedOperations.find((entry) => entry.operation === operation);
    if (denied)
        return denied.reason;
    if (topicId && policy.allowedBlackboardTopicIds.length && !policy.allowedBlackboardTopicIds.includes("*") && !policy.allowedBlackboardTopicIds.includes(topicId)) {
        return `topic ${topicId} is outside policy ${policy.policyRef}`;
    }
    if (operation.startsWith("candidate.")) {
        const op = operation.slice("candidate.".length);
        if (!policy.allowedCandidateOperations.includes(op))
            return `candidate operation ${op} is outside policy ${policy.policyRef}`;
    }
    else if (operation.startsWith("judge.")) {
        const op = operation.slice("judge.".length);
        if (!policy.allowedJudgeOperations.includes(op))
            return `judge operation ${op} is outside policy ${policy.policyRef}`;
    }
    else if (!policy.allowedWriteOperations.includes(operation)) {
        return `blackboard write operation ${operation} is outside policy ${policy.policyRef}`;
    }
    const missing = missingEvidence(policy, operation, evidenceRefs);
    if (missing.length)
        return `operation ${operation} requires evidence refs: ${missing.join(", ")}`;
    return undefined;
}
function missingEvidence(policy, operation, evidenceRefs) {
    if (!policy)
        return [];
    const required = unique([...(policy.requiredEvidenceFor?.[operation] || [])]);
    if (!required.length)
        return [];
    if (evidenceRefs.length)
        return [];
    return required;
}
function policyRunId(run, roleId, groupId, membershipId) {
    const membership = membershipId ? run.multiAgent?.memberships.find((entry) => entry.id === membershipId) : undefined;
    if (membership)
        return membership.multiAgentRunId;
    const role = roleId ? run.multiAgent?.roles.find((entry) => entry.id === roleId) : undefined;
    if (role)
        return role.multiAgentRunId;
    const group = groupId ? run.multiAgent?.groups.find((entry) => entry.id === groupId) : undefined;
    return group?.multiAgentRunId;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
