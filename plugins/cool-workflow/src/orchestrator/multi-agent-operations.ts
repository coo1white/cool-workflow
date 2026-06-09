// Multi-agent + blackboard domain operations (v0.1.40 self-audit P3 router pattern).
// The largest fat cluster carved out of CoolWorkflowRunner. Namespace imports (ma,
// cb) avoid the runner-method/impl name collisions. Behavior is identical to the
// inline versions — every mutating op persists via writeReport + saveCheckpoint.
import { WorkflowRun } from "../types";
import { saveCheckpoint } from "../state";
import { writeReport } from "./report";
import {
  arrayOption,
  metadataOption,
  numberOption,
  parseBlackboardAuthor,
  parseBlackboardLinks,
  parseBlackboardScope,
  parseSandboxChoices,
  requiredStringOption,
  stringOption
} from "./cli-options";
import * as ma from "../multi-agent";
import * as cb from "../coordinator";

export function createMultiAgentRun(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof ma.createMultiAgentRun> {
  const record = ma.createMultiAgentRun(run, {
    id: stringOption(options.id),
    title: stringOption(options.title),
    objective: stringOption(options.objective || options.reason),
    parentMultiAgentRunId: stringOption(options.parent || options.parentMultiAgentRunId),
    phase: stringOption(options.phase),
    phaseId: stringOption(options.phaseId),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function transitionMultiAgentRun(run: WorkflowRun, multiAgentRunId: string, options: Record<string, unknown> = {}): ReturnType<typeof ma.transitionMultiAgentRun> {
  const record = ma.transitionMultiAgentRun(run, multiAgentRunId, String(options.status || "running") as never, {
    reason: stringOption(options.reason),
    actor: stringOption(options.actor),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function createAgentRole(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof ma.createAgentRole> {
  const record = ma.createAgentRole(run, {
    id: stringOption(options.id),
    multiAgentRunId: requiredStringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
    title: stringOption(options.title),
    responsibilities: arrayOption(options.responsibility || options.responsibilities).map(String),
    requiredEvidence: arrayOption(options.requiredEvidence || options["required-evidence"]).map(String),
    sandboxProfileHints: arrayOption(options.sandbox || options.sandboxProfile || options.sandboxProfileHint || options["sandbox-profile"]).map(String),
    expectedArtifacts: arrayOption(options.expectedArtifact || options.expectedArtifacts || options["expected-artifact"]).map(String),
    faninObligations: arrayOption(options.faninObligation || options.faninObligations || options["fanin-obligation"]).map(String),
    parentRoleId: stringOption(options.parent || options.parentRoleId),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function createAgentGroup(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof ma.createAgentGroup> {
  const record = ma.createAgentGroup(run, {
    id: stringOption(options.id),
    multiAgentRunId: requiredStringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
    title: stringOption(options.title),
    phase: stringOption(options.phase),
    phaseId: stringOption(options.phaseId),
    taskIds: arrayOption(options.task || options.taskId || options.tasks).map(String),
    parentGroupId: stringOption(options.parent || options.parentGroupId),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function assignAgentMembership(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof ma.assignAgentMembership> {
  const record = ma.assignAgentMembership(run, {
    id: stringOption(options.id),
    multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
    groupId: requiredStringOption(options.group || options.groupId || options["multi-agent-group"], "group id"),
    roleId: requiredStringOption(options.role || options.roleId || options["multi-agent-role"], "role id"),
    taskId: requiredStringOption(options.task || options.taskId, "task id"),
    workerId: stringOption(options.worker || options.workerId),
    dispatchId: stringOption(options.dispatch || options.dispatchId),
    fanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
    status: stringOption(options.status) as never,
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function createAgentFanout(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof ma.createAgentFanout> {
  const record = ma.createAgentFanout(run, {
    id: stringOption(options.id),
    multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
    groupId: requiredStringOption(options.group || options.groupId || options["multi-agent-group"], "group id"),
    reason: stringOption(options.reason) || "work split",
    roleIds: arrayOption(options.role || options.roleId || options.roles).map(String),
    taskIds: arrayOption(options.task || options.taskId || options.tasks).map(String),
    workerIds: arrayOption(options.worker || options.workerId || options.workers).map(String),
    membershipIds: arrayOption(options.membership || options.membershipId || options.memberships).map(String),
    dispatchIds: arrayOption(options.dispatch || options.dispatchId || options.dispatches).map(String),
    concurrencyLimit: numberOption(options.limit || options.concurrency || options.concurrencyLimit),
    sandboxProfileChoices: parseSandboxChoices(options),
    expectedReturnShape: stringOption(options.expectedReturnShape || options["expected-return-shape"]),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function collectAgentFanin(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof ma.collectAgentFanin> {
  const record = ma.collectAgentFanin(run, {
    id: stringOption(options.id),
    multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
    groupId: stringOption(options.group || options.groupId || options["multi-agent-group"]),
    fanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
    requiredRoleIds: arrayOption(options.requiredRole || options.requiredRoleId || options["required-role"]).map(String),
    strategy: stringOption(options.strategy),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function showMultiAgentRun(run: WorkflowRun, multiAgentRunId: string): NonNullable<ReturnType<typeof ma.getMultiAgentRun>> {
  const record = ma.getMultiAgentRun(run, multiAgentRunId);
  if (!record) throw new Error(`Unknown MultiAgentRun id for run ${run.id}: ${multiAgentRunId}`);
  return record;
}

export function showAgentRole(run: WorkflowRun, roleId: string): NonNullable<ReturnType<typeof ma.getAgentRole>> {
  const record = ma.getAgentRole(run, roleId);
  if (!record) throw new Error(`Unknown AgentRole id for run ${run.id}: ${roleId}`);
  return record;
}

export function showAgentGroup(run: WorkflowRun, groupId: string): NonNullable<ReturnType<typeof ma.getAgentGroup>> {
  const record = ma.getAgentGroup(run, groupId);
  if (!record) throw new Error(`Unknown AgentGroup id for run ${run.id}: ${groupId}`);
  return record;
}

export function showAgentMembership(run: WorkflowRun, membershipId: string): NonNullable<ReturnType<typeof ma.getAgentMembership>> {
  const record = ma.getAgentMembership(run, membershipId);
  if (!record) throw new Error(`Unknown AgentMembership id for run ${run.id}: ${membershipId}`);
  return record;
}

export function showAgentFanout(run: WorkflowRun, fanoutId: string): NonNullable<ReturnType<typeof ma.getAgentFanout>> {
  const record = ma.getAgentFanout(run, fanoutId);
  if (!record) throw new Error(`Unknown AgentFanout id for run ${run.id}: ${fanoutId}`);
  return record;
}

export function showAgentFanin(run: WorkflowRun, faninId: string): NonNullable<ReturnType<typeof ma.getAgentFanin>> {
  const record = ma.getAgentFanin(run, faninId);
  if (!record) throw new Error(`Unknown AgentFanin id for run ${run.id}: ${faninId}`);
  return record;
}

export function blackboardSummary(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.summarizeBlackboard> {
  return cb.summarizeBlackboard(run, stringOption(options.blackboard || options.blackboardId));
}

export function blackboardGraph(run: WorkflowRun): ReturnType<typeof cb.buildBlackboardGraph> {
  return cb.buildBlackboardGraph(run);
}

export function resolveRunBlackboard(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.resolveBlackboard> {
  const board = cb.resolveBlackboard(run, {
    id: stringOption(options.id || options.blackboard || options.blackboardId),
    title: stringOption(options.title),
    multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
    groupId: stringOption(options.group || options.groupId || options["multi-agent-group"]),
    roleId: stringOption(options.role || options.roleId || options["multi-agent-role"]),
    membershipId: stringOption(options.membership || options.membershipId || options["multi-agent-membership"]),
    author: parseBlackboardAuthor(options),
    scope: parseBlackboardScope(options),
    tags: arrayOption(options.tag || options.tags).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return board;
}

export function createBlackboardTopic(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.createBlackboardTopic> {
  const topic = cb.createBlackboardTopic(run, {
    id: stringOption(options.id),
    title: requiredStringOption(options.title, "topic title"),
    description: stringOption(options.description),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    author: parseBlackboardAuthor(options),
    scope: parseBlackboardScope(options),
    tags: arrayOption(options.tag || options.tags).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return topic;
}

export function postBlackboardMessage(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.postBlackboardMessage> {
  const message = cb.postBlackboardMessage(run, {
    id: stringOption(options.id),
    topicId: requiredStringOption(options.topic || options.topicId, "topic id"),
    body: requiredStringOption(options.body || options.message, "message body"),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    replyToId: stringOption(options.replyTo || options.replyToId || options.parent),
    visibility: stringOption(options.visibility) as never,
    author: parseBlackboardAuthor(options),
    scope: parseBlackboardScope(options),
    evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
    artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
    auditEventIds: arrayOption(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
    parentIds: arrayOption(options.parentId || options.parentIds).map(String),
    tags: arrayOption(options.tag || options.tags).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return message;
}

export function listBlackboardMessages(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.listBlackboardMessages> {
  return cb.listBlackboardMessages(run, {
    topicId: stringOption(options.topic || options.topicId),
    blackboardId: stringOption(options.blackboard || options.blackboardId)
  });
}

export function putBlackboardContext(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.putBlackboardContext> {
  const context = cb.putBlackboardContext(run, {
    id: stringOption(options.id),
    topicId: requiredStringOption(options.topic || options.topicId, "topic id"),
    kind: requiredStringOption(options.kind, "context kind") as never,
    key: stringOption(options.key),
    value: requiredStringOption(options.value || options.body, "context value"),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    supersedesContextIds: arrayOption(options.supersedes || options.supersedesContext || options.supersedesContextId).map(String),
    author: parseBlackboardAuthor(options),
    scope: parseBlackboardScope(options),
    evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
    artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
    parentIds: arrayOption(options.parent || options.parentId || options.parentIds).map(String),
    tags: arrayOption(options.tag || options.tags).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return context;
}

export function addBlackboardArtifact(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.addBlackboardArtifact> {
  const artifact = cb.addBlackboardArtifact(run, {
    id: stringOption(options.id),
    topicId: stringOption(options.topic || options.topicId),
    kind: requiredStringOption(options.kind, "artifact kind"),
    path: stringOption(options.path),
    locator: stringOption(options.locator),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    owner: parseBlackboardAuthor({ ...options, authorKind: options.ownerKind || options.authorKind, authorId: options.owner || options.ownerId || options.authorId }),
    author: parseBlackboardAuthor(options),
    scope: parseBlackboardScope(options),
    source: stringOption(options.source),
    provenance: parseBlackboardLinks(run.id, options),
    evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
    auditEventIds: arrayOption(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
    parentIds: arrayOption(options.parent || options.parentId || options.parentIds).map(String),
    tags: arrayOption(options.tag || options.tags).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return artifact;
}

export function listBlackboardArtifacts(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.listBlackboardArtifacts> {
  return cb.listBlackboardArtifacts(run, {
    topicId: stringOption(options.topic || options.topicId),
    blackboardId: stringOption(options.blackboard || options.blackboardId)
  });
}

export function snapshotBlackboard(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.createBlackboardSnapshot> {
  const snapshot = cb.createBlackboardSnapshot(run, stringOption(options.blackboard || options.blackboardId));
  writeReport(run);
  saveCheckpoint(run);
  return snapshot;
}

export function recordCoordinatorDecision(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof cb.recordCoordinatorDecision> {
  const decision = cb.recordCoordinatorDecision(run, {
    id: stringOption(options.id),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    kind: requiredStringOption(options.kind, "decision kind") as never,
    outcome: requiredStringOption(options.outcome, "decision outcome") as never,
    reason: requiredStringOption(options.reason, "decision reason"),
    subjectIds: arrayOption(options.subject || options.subjectId || options.subjectIds).map(String),
    topicId: stringOption(options.topic || options.topicId),
    author: parseBlackboardAuthor({ ...options, authorKind: options.authorKind || "coordinator", authorId: options.authorId || "cw" }),
    scope: parseBlackboardScope(options),
    evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
    artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
    messageIds: arrayOption(options.message || options.messageId || options.messageIds).map(String),
    parentIds: arrayOption(options.parent || options.parentId || options.parentIds).map(String),
    tags: arrayOption(options.tag || options.tags).map(String),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return decision;
}
