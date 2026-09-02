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

import { WorkflowRun } from "../core/state/types";
import { AgentGroup, AgentMembership, AgentRole, MultiAgentPolicy, MultiAgentPolicyOperation, getAgentGroup, getAgentMembership, getAgentRole } from "../core/multi-agent/runtime";
import { evaluateMultiAgentAction, policyForGroup, policyForRole, resolvePolicy } from "../core/multi-agent/trust-policy";
import { listTrustAuditEvents, recordTrustAuditEvent, TrustAuditEvent } from "./trust-audit";
import { sha256 } from "../core/hash";

export interface BlackboardAuthorLike {
  kind: string;
  id: string;
}

export interface MultiAgentTrustDecision {
  allowed: boolean;
  decision: "allowed" | "denied";
  reason: string;
  policyRef?: string;
  policy?: MultiAgentPolicy;
  missingEvidenceRefs: string[];
  event: TrustAuditEvent;
}

export interface AuthorizeMultiAgentActionInput {
  operation: MultiAgentPolicyOperation;
  actor?: BlackboardAuthorLike;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  blackboardContextId?: string;
  blackboardArtifactRefId?: string;
  blackboardSnapshotId?: string;
  coordinatorDecisionId?: string;
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  commitId?: string;
  sandboxProfileId?: string;
  evidenceRefs?: string[];
  evidence?: import("../core/state/types").StateEvidence[];
  metadata?: Record<string, unknown>;
}

function policyRunId(run: WorkflowRun, roleId?: string, groupId?: string, membershipId?: string): string | undefined {
  const membership = membershipId ? getAgentMembership(run, membershipId) : undefined;
  if (membership) return membership.multiAgentRunId;
  const role = roleId ? getAgentRole(run, roleId) : undefined;
  if (role) return role.multiAgentRunId;
  const group = groupId ? getAgentGroup(run, groupId) : undefined;
  return group?.multiAgentRunId;
}

export function authorizeMultiAgentAction(run: WorkflowRun, input: AuthorizeMultiAgentActionInput): MultiAgentTrustDecision {
  const roleId = input.agentRoleId || (input.actor?.kind === "role" ? input.actor.id : undefined);
  const membershipId = input.agentMembershipId || (input.actor?.kind === "membership" ? input.actor.id : undefined);
  const groupId = input.agentGroupId || (input.actor?.kind === "group" ? input.actor.id : undefined);
  const policy = resolvePolicy(
    { roleId, membershipId, groupId },
    {
      membership: (id) => getAgentMembership(run, id) as AgentMembership | undefined,
      role: (id) => getAgentRole(run, id) as AgentRole | undefined,
      group: (id) => getAgentGroup(run, id) as AgentGroup | undefined,
    }
  );
  const core = evaluateMultiAgentAction(policy, input.operation, input.blackboardTopicId, input.evidenceRefs || []);
  const metadata = { operation: input.operation, reason: core.reason, policyRef: policy?.policyRef, ...(input.metadata || {}) };
  const event = recordTrustAuditEvent(run, {
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
    recordTrustAuditEvent(run, {
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

export function assertMultiAgentActionAllowed(run: WorkflowRun, input: AuthorizeMultiAgentActionInput): MultiAgentTrustDecision {
  const decision = authorizeMultiAgentAction(run, input);
  if (!decision.allowed) throw new Error(decision.reason);
  return decision;
}

export interface RecordBlackboardWriteAuditInput {
  operation: MultiAgentPolicyOperation;
  status: string;
  actor?: BlackboardAuthorLike;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  agentFanoutId?: string;
  agentFaninId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  blackboardContextId?: string;
  blackboardArtifactRefId?: string;
  blackboardSnapshotId?: string;
  coordinatorDecisionId?: string;
  evidenceRefs?: string[];
  parentEventIds?: string[];
  policyRef?: string;
  metadata?: Record<string, unknown>;
}

function sourceForActor(actor?: BlackboardAuthorLike): "cw-validated" | "host-attested" | "operator-recorded" | "runtime-derived" {
  if (!actor) return "operator-recorded";
  if (actor.kind === "worker") return "host-attested";
  if (actor.kind === "operator") return "operator-recorded";
  if (actor.kind === "runtime" || actor.kind === "coordinator" || actor.kind === "verifier") return "runtime-derived";
  return "cw-validated";
}

export function recordBlackboardWriteAudit(run: WorkflowRun, input: RecordBlackboardWriteAuditInput): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
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

export interface RecordMessageProvenanceAuditInput {
  messageId: string;
  topicId: string;
  blackboardId: string;
  actor?: BlackboardAuthorLike;
  body: string;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  workerId?: string;
  evidenceRefs?: string[];
  parentMessageIds?: string[];
  parentEventIds?: string[];
  policyRef?: string;
}

export function hashText(value: string): string {
  return sha256(value);
}

export function recordMessageProvenanceAudit(run: WorkflowRun, input: RecordMessageProvenanceAuditInput): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
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

export interface RecordJudgeRationaleAuditInput {
  kind?: "judge.rationale" | "judge.panel-decision";
  actor?: BlackboardAuthorLike;
  multiAgentRunId?: string;
  agentRoleId?: string;
  agentGroupId?: string;
  agentMembershipId?: string;
  blackboardId?: string;
  blackboardTopicId?: string;
  blackboardMessageId?: string;
  coordinatorDecisionId?: string;
  candidateId?: string;
  scoreId?: string;
  selectionId?: string;
  evidenceRefs?: string[];
  rationale?: string;
  policyRef?: string;
  parentEventIds?: string[];
}

export function recordJudgeRationaleAudit(run: WorkflowRun, input: RecordJudgeRationaleAuditInput): TrustAuditEvent {
  return recordTrustAuditEvent(run, {
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

export interface MultiAgentTrustSummary {
  schemaVersion: 1;
  runId: string;
  rolePolicies: MultiAgentPolicy[];
  permissionDecisions: TrustAuditEvent[];
  blackboardWrites: TrustAuditEvent[];
  messageProvenance: TrustAuditEvent[];
  judgeRationales: TrustAuditEvent[];
  panelDecisions: TrustAuditEvent[];
  policyViolations: TrustAuditEvent[];
  nextAction: string;
}

export function summarizeMultiAgentTrust(run: WorkflowRun): MultiAgentTrustSummary {
  const events = listTrustAuditEvents(run);
  const roles = ((run.multiAgent as unknown as { roles?: AgentRole[] } | undefined)?.roles || []) as AgentRole[];
  const rolePolicies = roles.map((role) => role.policy || policyForRole(role));
  const byKind = (kind: string) => events.filter((event) => event.kind === kind);
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

export function hasAcceptedJudgeRationale(run: WorkflowRun, input: { multiAgentRunId?: string; candidateId?: string; scoreId?: string } = {}): boolean {
  return listTrustAuditEvents(run).some(
    (event) =>
      event.kind === "judge.rationale" &&
      event.decision === "accepted" &&
      (!input.multiAgentRunId || event.multiAgentRunId === input.multiAgentRunId) &&
      (!input.candidateId || event.candidateId === input.candidateId) &&
      (!input.scoreId || !event.scoreId || event.scoreId === input.scoreId)
  );
}

export function recordRolePolicyAudit(run: WorkflowRun, role: AgentRole): TrustAuditEvent {
  return recordTrustAuditEvent(run, { kind: "multi-agent.role-policy", decision: "recorded", source: "runtime-derived", multiAgentRunId: role.multiAgentRunId, agentRoleId: role.id, blackboardId: role.blackboardId, policyRef: role.policy?.policyRef, metadata: role.policy as unknown as Record<string, unknown> });
}

export { policyForGroup, policyForMembership, policyForRole } from "../core/multi-agent/trust-policy";
