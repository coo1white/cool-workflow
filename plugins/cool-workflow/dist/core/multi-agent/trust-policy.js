"use strict";
// core/multi-agent/trust-policy.ts — policyForRole/Group/Membership,
// authorizeMultiAgentAction's PURE decision half.
//
// MILESTONE 9. Byte-exact port of the decision logic in the old build's
// src/multi-agent-trust.ts. Audit-event recording (recordTrustAuditEvent,
// which appends to disk) is the caller's job — see
// shell/multi-agent-io.ts's `authorizeMultiAgentAction` wrapper, which
// calls `evaluateMultiAgentAction` below then records the two audit
// events exactly like the old build did.
//
// Evidence: SPEC/multi-agent.md section D ("Trust policies"), "Trust
// denial reasons"; plugins/cool-workflow/src/multi-agent-trust.ts
// (byte-exact source for policyForRole/Group/Membership + evaluatePolicy/
// missingEvidence).
Object.defineProperty(exports, "__esModule", { value: true });
exports.policyForRole = policyForRole;
exports.policyForGroup = policyForGroup;
exports.policyForMembership = policyForMembership;
exports.evaluateMultiAgentAction = evaluateMultiAgentAction;
exports.resolvePolicy = resolvePolicy;
exports.sourceForActor = sourceForActor;
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
/** Chair detection: lowercased `metadata.topologyRoleId` (or title)
 *  contains "chair", "reducer", or "synthesizer". Judge detection:
 *  contains "judge". Renaming a role changes its authority (plugins/cool-workflow/project/docs/rebuild/PLAN.md
 *  byte-compat / rebuild risk 4 — substring match, not a flag). */
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
            ...(isChair ? ["snapshot", "coordinator-decision"] : []),
        ]),
        allowedCandidateOperations: (isChair ? ["score", "select"] : ["score"]),
        allowedJudgeOperations: unique([
            ...(isJudge ? ["verdict", "rationale"] : []),
            ...(isChair ? ["rationale", "panel-decision"] : []),
        ]),
        sandboxProfileHints: unique(role.sandboxProfileHints || []),
        requiredEvidenceRefs: unique(role.requiredEvidence || []),
        requiredEvidenceFor: {
            "judge.rationale": ["judge rationale evidence"],
            "judge.verdict": ["judge verdict evidence"],
            "judge.panel-decision": ["judge messages", "score evidence", "coordinator decision"],
            "candidate.select": ["score evidence", "judge rationale"],
        },
        deniedOperations: [],
        metadata: { title: role.title, topologyRoleId: role.metadata?.topologyRoleId },
    };
}
/** Wide-open group policy: all write/candidate/judge ops allowed, topics
 *  from the group or `["*"]`. */
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
        metadata: { phase: group.phase },
    };
}
/** Copies the role policy (or a minimal message/context/artifact-only
 *  policy if no role) and re-subjects it to the membership. */
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
            deniedOperations: [],
        }),
        id: `${membership.id}-policy`,
        policyRef: `multiAgent.memberships.${membership.id}.policy`,
        subjectKind: "membership",
        subjectId: membership.id,
    };
}
/** The pure decision half of `authorizeMultiAgentAction`: resolves the
 *  policy (membership -> role -> group, in that priority order) and
 *  evaluates denied ops / topic scope / op-class membership / required
 *  evidence. Audit recording is NOT done here (shell/multi-agent-io.ts's
 *  wrapper does that, injecting the resolved policy + reason into
 *  recordTrustAuditEvent calls byte-identical to the old build's). */
function evaluateMultiAgentAction(policy, operation, topicId, evidenceRefs) {
    const reason = evaluatePolicy(policy, operation, topicId, evidenceRefs);
    const allowed = !reason;
    return {
        allowed,
        decision: allowed ? "allowed" : "denied",
        reason: reason || "allowed by explicit multi-agent policy",
        policyRef: policy?.policyRef,
        policy,
        missingEvidenceRefs: missingEvidence(policy, operation, evidenceRefs),
    };
}
/** Resolves the effective policy for an action: membership wins, else
 *  role, else group — same priority chain as the old build's
 *  `resolvePolicy`. Callers supply lookup functions so this stays pure
 *  (no direct WorkflowRun/state coupling beyond what's passed in). */
function resolvePolicy(input, lookups) {
    const membership = input.membershipId ? lookups.membership?.(input.membershipId) : undefined;
    if (membership?.policy)
        return membership.policy;
    const roleId = input.roleId || membership?.roleId;
    const role = roleId ? lookups.role?.(roleId) : undefined;
    if (role?.policy)
        return role.policy;
    if (role)
        return policyForRole(role);
    const group = input.groupId ? lookups.group?.(input.groupId) : undefined;
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
        return `operation ${operation} requires evidence refs (at least one; expected kinds: ${missing.join(", ")})`;
    return undefined;
}
/** The requiredEvidenceFor entries are prose descriptions ("judge
 *  messages", "score evidence"), not machine-matchable ids — so this can
 *  only check that SOME evidence ref was supplied, not that each named
 *  kind is present. The denial message above says exactly that ("at least
 *  one; expected kinds: ...") rather than promising a per-item match this
 *  check cannot do. */
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
/** no actor -> operator-recorded; worker -> host-attested; operator ->
 *  operator-recorded; runtime/coordinator/verifier -> runtime-derived;
 *  else cw-validated. */
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
