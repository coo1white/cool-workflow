"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
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
exports.missingEvidence = missingEvidence;
const node_crypto_1 = __importDefault(require("node:crypto"));
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
    const reason = evaluatePolicy(policy, input.operation, input.blackboardTopicId, input.evidenceRefs || [], input.evidence);
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
        missingEvidenceRefs: missingEvidence(policy, input.operation, input.evidenceRefs || [], input.evidence),
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
function hashText(value) {
    return `sha256:${node_crypto_1.default.createHash("sha256").update(value).digest("hex")}`;
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
function evaluatePolicy(policy, operation, topicId, evidenceRefs, evidence) {
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
    const missing = missingEvidence(policy, operation, evidenceRefs, evidence);
    if (missing.length)
        return `operation ${operation} requires evidence refs: ${missing.join(", ")}`;
    return undefined;
}
/**
 * Required-evidence gate (L7 fix).
 *
 * Each required item in `requiredEvidenceFor[operation]` is a human-readable KIND
 * label (e.g. "judge messages"). Callers pass content LOCATORS (e.g. "/tmp/x.md:1")
 * which live in a different namespace, so a naive set-match would false-REJECT the
 * legitimate happy path. We therefore match per-required-kind against the present
 * evidence, modelled on `state-node.ts` assertRequiredEvidence:
 *
 *  - A required kind is COVERED by a ref that carries a matching kind tag
 *    (recordRef.kind, a "kind:<label>" locator prefix) or whose label/locator/id/
 *    summary mentions the required label. Each ref can cover at most one required
 *    kind (consumed greedily), so one ref can no longer satisfy several distinct
 *    requirements.
 *  - When the present refs carry NO kind signal at all (pure legacy bare locators),
 *    we fall back to the prior "any ref is accepted" behaviour to avoid a happy-path
 *    false-reject — this is the documented residual: untagged callers are not yet
 *    enforced per-kind. Tagged callers (and the kind-tagging scheme below) get true
 *    per-kind enforcement.
 *
 * Returns the specific required kinds that remain uncovered.
 */
function missingEvidence(policy, operation, evidenceRefs, evidence) {
    if (!policy)
        return [];
    const required = unique([...(policy.requiredEvidenceFor?.[operation] || [])]);
    if (!required.length)
        return [];
    if (!evidenceRefs.length)
        return required;
    const refs = buildEvidenceRefIndex(evidenceRefs, evidence);
    const anyKindSignal = refs.some((ref) => ref.kinds.length > 0);
    if (!anyKindSignal) {
        // Residual: legacy bare locators carry no kind to match against. Preserve the
        // historical contract (presence satisfies) rather than false-reject the caller.
        return [];
    }
    const consumed = new Set();
    const uncovered = [];
    for (const need of required) {
        const needle = need.toLowerCase();
        const matchIndex = refs.findIndex((ref, index) => !consumed.has(index) &&
            (ref.kinds.includes(needle) || ref.haystacks.some((hay) => hay.includes(needle) || needle.includes(hay))));
        if (matchIndex === -1) {
            uncovered.push(need);
        }
        else {
            consumed.add(matchIndex);
        }
    }
    return uncovered;
}
/**
 * Project the parallel `evidenceRefs` (locators) and optional `evidence` records
 * into a per-ref view that exposes any kind tag plus searchable text. Indexes are
 * aligned with `evidenceRefs`; extra `evidence` entries (if any) are appended so a
 * caller that supplies richer `evidence` than bare refs is not penalised.
 */
function buildEvidenceRefIndex(evidenceRefs, evidence) {
    const views = evidenceRefs.map((ref, index) => {
        const record = evidence?.[index];
        return mergeEvidenceView(ref, record);
    });
    if (evidence) {
        for (let i = evidenceRefs.length; i < evidence.length; i++) {
            views.push(mergeEvidenceView(undefined, evidence[i]));
        }
    }
    return views;
}
function mergeEvidenceView(ref, record) {
    const kinds = [];
    const haystacks = [];
    const pushText = (value) => {
        if (value)
            haystacks.push(value.toLowerCase());
    };
    // A "kind:<label>" locator prefix is an explicit, replay-stable kind tag.
    const taggedKind = (value) => {
        if (!value)
            return undefined;
        const match = /^kind:([^:]+):?/i.exec(value.trim());
        return match ? match[1].trim().toLowerCase() : undefined;
    };
    for (const value of [ref, record?.locator, record?.id, record?.source]) {
        const kind = taggedKind(value);
        if (kind)
            kinds.push(kind);
    }
    if (record?.recordRef?.kind)
        kinds.push(record.recordRef.kind.toLowerCase());
    pushText(ref);
    pushText(record?.locator);
    pushText(record?.id);
    pushText(record?.source);
    pushText(record?.summary);
    return { kinds: unique(kinds), haystacks };
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
