import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  Blackboard,
  BlackboardArtifactRef,
  BlackboardAuthor,
  BlackboardContext,
  BlackboardContextKind,
  BlackboardLinks,
  BlackboardMessage,
  BlackboardRecordStatus,
  BlackboardScope,
  BlackboardSnapshot,
  BlackboardState,
  BlackboardSummary,
  BlackboardTopic,
  CoordinatorDecision,
  CoordinatorDecisionKind,
  CoordinatorDecisionOutcome,
  StateNodeStatus,
  WorkflowRun
} from "./types";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { safeFileName, writeJson } from "./state";
import { appendRunNode, createStateNode } from "./state-node";
import { getAgentGroup, getAgentMembership, getAgentRole, getMultiAgentRun } from "./multi-agent";
import { recordTrustAuditEvent } from "./trust-audit";
import { compareBytes } from "./compare";
import {
  assertMultiAgentActionAllowed,
  hashText,
  recordBlackboardWriteAudit,
  recordJudgeRationaleAudit,
  recordMessageProvenanceAudit,
  sourceForActor
} from "./multi-agent-trust";

export const BLACKBOARD_SCHEMA_VERSION = 1;

export interface ResolveBlackboardInput {
  id?: string;
  title?: string;
  multiAgentRunId?: string;
  groupId?: string;
  roleId?: string;
  membershipId?: string;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateTopicInput {
  id?: string;
  title: string;
  description?: string;
  blackboardId?: string;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface PostMessageInput {
  id?: string;
  topicId: string;
  body: string;
  blackboardId?: string;
  replyToId?: string;
  visibility?: BlackboardMessage["visibility"];
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  evidenceRefs?: string[];
  artifactRefIds?: string[];
  auditEventIds?: string[];
  links?: Partial<BlackboardLinks>;
  parentIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface PutContextInput {
  id?: string;
  topicId: string;
  kind: BlackboardContextKind;
  key?: string;
  value: string;
  blackboardId?: string;
  supersedesContextIds?: string[];
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  evidenceRefs?: string[];
  artifactRefIds?: string[];
  links?: Partial<BlackboardLinks>;
  parentIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface AddArtifactInput {
  id?: string;
  topicId?: string;
  kind: string;
  path?: string;
  locator?: string;
  blackboardId?: string;
  owner?: Partial<BlackboardAuthor>;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  source?: string;
  provenance?: Partial<BlackboardLinks>;
  evidenceRefs?: string[];
  auditEventIds?: string[];
  links?: Partial<BlackboardLinks>;
  parentIds?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface RecordDecisionInput {
  id?: string;
  blackboardId?: string;
  kind: CoordinatorDecisionKind;
  outcome: CoordinatorDecisionOutcome;
  reason: string;
  subjectIds?: string[];
  topicId?: string;
  author?: Partial<BlackboardAuthor>;
  scope?: Partial<BlackboardScope>;
  evidenceRefs?: string[];
  artifactRefIds?: string[];
  messageIds?: string[];
  parentIds?: string[];
  links?: Partial<BlackboardLinks>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface BlackboardGraph {
  nodes: Array<{ id: string; kind: string; status: string; label: string; path?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export function ensureBlackboardState(run: WorkflowRun): BlackboardState {
  run.paths.blackboardDir = blackboardRoot(run);
  fs.mkdirSync(run.paths.blackboardDir, { recursive: true });
  for (const dir of ["topics", "contexts", "artifacts", "snapshots", "decisions"]) {
    fs.mkdirSync(path.join(run.paths.blackboardDir, dir), { recursive: true });
  }
  if (!run.blackboard) {
    run.blackboard = emptyState();
  }
  run.blackboard.schemaVersion = BLACKBOARD_SCHEMA_VERSION;
  run.blackboard.boards = run.blackboard.boards || [];
  run.blackboard.topics = run.blackboard.topics || [];
  run.blackboard.messages = run.blackboard.messages || [];
  run.blackboard.contexts = run.blackboard.contexts || [];
  run.blackboard.artifacts = run.blackboard.artifacts || [];
  run.blackboard.snapshots = run.blackboard.snapshots || [];
  run.blackboard.decisions = run.blackboard.decisions || [];
  return run.blackboard;
}

export function resolveBlackboard(run: WorkflowRun, input: ResolveBlackboardInput = {}): Blackboard {
  const state = ensureBlackboardState(run);
  const existing = input.id
    ? state.boards.find((board) => board.id === input.id)
    : input.multiAgentRunId
      ? state.boards.find((board) => board.links.multiAgentRunId === input.multiAgentRunId)
      : state.boards[0];
  if (existing) {
    linkMultiAgent(run, existing.id, existing.topicIds, input);
    touch(existing);
    persistBlackboardState(run);
    return existing;
  }
  const id = input.id || createId("bb");
  assertUnique(state.boards, id, "Blackboard");
  const now = timestamp();
  const author = normalizeAuthor(input.author, "runtime");
  const scope = normalizeScope(input.scope, input.multiAgentRunId ? { kind: "multi-agent-run", id: input.multiAgentRunId } : { kind: "run", id: run.id });
  const board: Blackboard = {
    schemaVersion: BLACKBOARD_SCHEMA_VERSION,
    id,
    runId: run.id,
    createdAt: now,
    updatedAt: now,
    author,
    scope,
    status: "active",
    parentIds: [],
    tags: sortTags(input.tags),
    title: input.title || id,
    topicIds: [],
    messageCount: 0,
    contextIds: [],
    artifactRefIds: [],
    snapshotIds: [],
    decisionIds: [],
    links: compactLinks(run, {
      multiAgentRunId: input.multiAgentRunId,
      agentGroupId: input.groupId,
      agentRoleId: input.roleId,
      agentMembershipId: input.membershipId
    }),
    paths: boardPaths(run),
    metadata: scrub(input.metadata)
  };
  linkMultiAgent(run, board.id, [], input);
  state.boards.push(board);
  appendBlackboardNode(run, "blackboard", board.id, "running", board.title, board.paths.index);
  const audit = recordTrustAuditEvent(run, {
    kind: "blackboard.create",
    decision: "recorded",
    source: "runtime-derived",
    actor: author.id,
    multiAgentRunId: input.multiAgentRunId,
    agentGroupId: input.groupId,
    agentRoleId: input.roleId,
    agentMembershipId: input.membershipId,
    blackboardId: board.id,
    metadata: { scope, tags: board.tags }
  });
  board.links.auditEventIds = [audit.id];
  persistBlackboardState(run);
  return board;
}

export function createBlackboardTopic(run: WorkflowRun, input: CreateTopicInput): BlackboardTopic {
  const board = resolveBlackboard(run, { id: input.blackboardId });
  const state = ensureBlackboardState(run);
  const id = input.id || createId("topic");
  assertUnique(state.topics, id, "BlackboardTopic");
  const topicLinks = compactLinks(run, { ...board.links, ...roleLinkFromAuthor(input.author), ...input.scope });
  const now = timestamp();
  const topic: BlackboardTopic = {
    ...base(run, board.id, id, input.author, input.scope, "open", input.tags, input.metadata),
    createdAt: now,
    updatedAt: now,
    title: input.title,
    description: input.description,
    messageIds: [],
    contextIds: [],
    artifactRefIds: [],
    links: topicLinks
  };
  state.topics.push(topic);
  board.topicIds = unique([...board.topicIds, topic.id]);
  touch(board);
  linkMultiAgent(run, board.id, [topic.id], board.links);
  appendBlackboardNode(run, "blackboard-topic", topic.id, "running", topic.title, recordPath(run, "topics", topic.id), [`${run.id}:blackboard:${board.id}`]);
  const audit = recordTrustAuditEvent(run, {
    kind: "blackboard.topic",
    decision: "recorded",
    source: "operator-recorded",
    actor: topic.author.id,
    blackboardId: board.id,
    blackboardTopicId: topic.id,
    multiAgentRunId: topic.links.multiAgentRunId,
    agentGroupId: topic.links.agentGroupId,
    agentRoleId: topic.links.agentRoleId,
    agentMembershipId: topic.links.agentMembershipId,
    metadata: { title: topic.title, tags: topic.tags }
  });
  topic.links.auditEventIds = unique([...(topic.links.auditEventIds || []), audit.id]);
  recordBlackboardWriteAudit(run, {
    operation: "topic",
    status: topic.status,
    actor: topic.author,
    blackboardId: board.id,
    blackboardTopicId: topic.id,
    multiAgentRunId: topic.links.multiAgentRunId,
    agentGroupId: topic.links.agentGroupId,
    agentRoleId: topic.links.agentRoleId,
    agentMembershipId: topic.links.agentMembershipId,
    parentEventIds: [audit.id],
    metadata: { title: topic.title }
  });
  persistBlackboardState(run);
  return topic;
}

export function postBlackboardMessage(run: WorkflowRun, input: PostMessageInput): BlackboardMessage {
  const state = ensureBlackboardState(run);
  const topic = requireTopic(run, input.topicId);
  const board = requireBoard(run, input.blackboardId || topic.blackboardId);
  if (input.replyToId && !state.messages.some((message) => message.id === input.replyToId)) {
    throw new Error(`Unknown parent BlackboardMessage id: ${input.replyToId}`);
  }
  if (!input.body.trim()) throw new Error("Blackboard message body is required");
  const id = input.id || createId("msg");
  assertUnique(state.messages, id, "BlackboardMessage");
  const author = normalizeAuthor(input.author, "operator");
  const links = compactLinks(run, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
  const enforcePolicy = shouldEnforcePolicy(author, links);
  const permission = enforcePolicy
    ? assertMultiAgentActionAllowed(run, {
        operation: "message",
        actor: author,
        multiAgentRunId: links.multiAgentRunId,
        agentRoleId: links.agentRoleId,
        agentGroupId: links.agentGroupId,
        agentMembershipId: links.agentMembershipId,
        agentFanoutId: links.agentFanoutId,
        agentFaninId: links.agentFaninId,
        blackboardId: board.id,
        blackboardTopicId: topic.id,
        blackboardMessageId: id,
        evidenceRefs: input.evidenceRefs || []
      })
    : undefined;
  const message: BlackboardMessage = {
    ...base(run, board.id, id, author, input.scope, "active", input.tags, input.metadata),
    topicId: topic.id,
    body: input.body,
    visibility: input.visibility || "public",
    replyToId: input.replyToId,
    parentIds: unique([...(input.parentIds || []), ...(input.replyToId ? [input.replyToId] : [])]),
    linkedEvidenceRefs: unique(input.evidenceRefs || []),
    linkedArtifactRefIds: requireArtifactRefs(run, input.artifactRefIds || []),
    linkedAuditEventIds: unique(input.auditEventIds || []),
    links,
    provenance: {
      schemaVersion: 1,
      authorKind: author.kind,
      authorId: author.id,
      multiAgentRunId: links.multiAgentRunId,
      agentRoleId: links.agentRoleId,
      agentGroupId: links.agentGroupId,
      agentMembershipId: links.agentMembershipId,
      agentFanoutId: links.agentFanoutId,
      agentFaninId: links.agentFaninId,
      workerId: links.workerId || (author.kind === "worker" ? author.id : undefined),
      source: sourceForActor(author),
      linkedEvidenceRefs: unique(input.evidenceRefs || []),
      linkedAuditEventIds: unique(input.auditEventIds || []),
      parentMessageIds: unique([...(input.parentIds || []), ...(input.replyToId ? [input.replyToId] : [])]),
      topicScope: topic.id,
      bodyHash: hashText(input.body),
      locator: `${board.id}/messages/${id}`
    }
  };
  state.messages.push(message);
  topic.messageIds = unique([...topic.messageIds, message.id]);
  board.messageCount = state.messages.filter((entry) => entry.blackboardId === board.id).length;
  touch(topic);
  touch(board);
  appendBlackboardNode(run, "blackboard-message", message.id, "completed", truncate(message.body), messagesPath(run), [`${run.id}:blackboard:topic:${topic.id}`]);
  const audit = recordTrustAuditEvent(run, {
    kind: "blackboard.message",
    decision: "recorded",
    source: sourceForAuthor(message.author),
    actor: message.author.id,
    blackboardId: board.id,
    blackboardTopicId: topic.id,
    blackboardMessageId: message.id,
    workerId: message.links.workerId || (message.author.kind === "worker" ? message.author.id : undefined),
    taskId: message.links.taskId,
    multiAgentRunId: message.links.multiAgentRunId,
    agentGroupId: message.links.agentGroupId,
    agentRoleId: message.links.agentRoleId,
    agentMembershipId: message.links.agentMembershipId,
    evidenceRefs: message.linkedEvidenceRefs,
    parentEventIds: message.linkedAuditEventIds,
    metadata: { visibility: message.visibility }
  });
  const writeAudit = recordBlackboardWriteAudit(run, {
    operation: "message",
    status: message.status,
    actor: message.author,
    multiAgentRunId: message.links.multiAgentRunId,
    agentGroupId: message.links.agentGroupId,
    agentRoleId: message.links.agentRoleId,
    agentMembershipId: message.links.agentMembershipId,
    agentFanoutId: message.links.agentFanoutId,
    agentFaninId: message.links.agentFaninId,
    blackboardId: board.id,
    blackboardTopicId: topic.id,
    blackboardMessageId: message.id,
    evidenceRefs: message.linkedEvidenceRefs,
    parentEventIds: unique([...(permission ? [permission.event.id] : []), audit.id]),
    policyRef: permission?.policyRef,
    metadata: { visibility: message.visibility }
  });
  const provenanceAudit = recordMessageProvenanceAudit(run, {
    messageId: message.id,
    topicId: topic.id,
    blackboardId: board.id,
    actor: message.author,
    body: message.body,
    multiAgentRunId: message.links.multiAgentRunId,
    agentRoleId: message.links.agentRoleId,
    agentGroupId: message.links.agentGroupId,
    agentMembershipId: message.links.agentMembershipId,
    workerId: message.links.workerId,
    evidenceRefs: message.linkedEvidenceRefs,
    parentMessageIds: message.parentIds,
    parentEventIds: [audit.id, writeAudit.id],
    policyRef: permission?.policyRef
  });
  if (message.metadata?.judgeRationale || message.tags.includes("judge-rationale")) {
    const rationaleAudit = recordJudgeRationaleAudit(run, {
      kind: "judge.rationale",
      actor: message.author,
      multiAgentRunId: message.links.multiAgentRunId,
      agentRoleId: message.links.agentRoleId,
      agentGroupId: message.links.agentGroupId,
      agentMembershipId: message.links.agentMembershipId,
      blackboardId: board.id,
      blackboardTopicId: topic.id,
      blackboardMessageId: message.id,
      evidenceRefs: message.linkedEvidenceRefs,
      rationale: message.body,
      policyRef: permission?.policyRef,
      parentEventIds: [audit.id, writeAudit.id, provenanceAudit.id]
    });
    message.linkedAuditEventIds = unique([...message.linkedAuditEventIds, rationaleAudit.id]);
  }
  message.linkedAuditEventIds = unique([...message.linkedAuditEventIds, audit.id, writeAudit.id, provenanceAudit.id]);
  message.links.auditEventIds = unique([...(message.links.auditEventIds || []), audit.id, writeAudit.id, provenanceAudit.id]);
  if (message.provenance) {
    message.provenance.linkedAuditEventIds = unique([...message.provenance.linkedAuditEventIds, audit.id, writeAudit.id, provenanceAudit.id]);
  }
  persistBlackboardState(run);
  return message;
}

export function putBlackboardContext(run: WorkflowRun, input: PutContextInput): BlackboardContext {
  const state = ensureBlackboardState(run);
  const topic = requireTopic(run, input.topicId);
  const board = requireBoard(run, input.blackboardId || topic.blackboardId);
  const key = input.key || input.kind;
  const id = input.id || createId("ctx");
  assertUnique(state.contexts, id, "BlackboardContext");
  const author = normalizeAuthor(input.author, "operator");
  const links = compactLinks(run, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs });
  const permission = shouldEnforcePolicy(author, links)
    ? assertMultiAgentActionAllowed(run, {
        operation: "context",
        actor: author,
        multiAgentRunId: links.multiAgentRunId,
        agentRoleId: links.agentRoleId,
        agentGroupId: links.agentGroupId,
        agentMembershipId: links.agentMembershipId,
        blackboardId: board.id,
        blackboardTopicId: topic.id,
        blackboardContextId: id,
        evidenceRefs: input.evidenceRefs || []
      })
    : undefined;
  const conflicts = state.contexts.filter((context) =>
    context.blackboardId === board.id &&
    context.topicId === topic.id &&
    context.kind === input.kind &&
    context.key === key &&
    context.status !== "superseded" &&
    !input.supersedesContextIds?.includes(context.id) &&
    context.value !== input.value
  );
  for (const supersededId of input.supersedesContextIds || []) {
    const superseded = requireContext(run, supersededId);
    superseded.status = "superseded";
    superseded.supersededByContextId = id;
    touch(superseded);
  }
  const status: BlackboardRecordStatus = conflicts.length ? "conflicting" : input.kind === "question" ? "open" : "active";
  const context: BlackboardContext = {
    ...base(run, board.id, id, author, input.scope, status, input.tags, input.metadata),
    topicId: topic.id,
    kind: input.kind,
    key,
    value: input.value,
    supersedesContextIds: unique(input.supersedesContextIds || []),
    conflictingContextIds: conflicts.map((entry) => entry.id),
    evidenceRefs: unique(input.evidenceRefs || []),
    artifactRefIds: requireArtifactRefs(run, input.artifactRefIds || []),
    links
  };
  for (const conflict of conflicts) {
    conflict.status = "conflicting";
    conflict.conflictingContextIds = unique([...conflict.conflictingContextIds, context.id]);
    touch(conflict);
  }
  state.contexts.push(context);
  topic.contextIds = unique([...topic.contextIds, context.id]);
  board.contextIds = unique([...board.contextIds, context.id]);
  touch(topic);
  touch(board);
  const decision = recordCoordinatorDecision(run, {
    blackboardId: board.id,
    topicId: topic.id,
    kind: conflicts.length ? "conflict-resolution" : "context-update",
    outcome: conflicts.length ? "conflicting" : "accepted",
    reason: conflicts.length
      ? `Context ${context.id} conflicts with ${conflicts.map((entry) => entry.id).join(", ")}`
      : `Accepted ${input.kind} context ${context.id}`,
    subjectIds: [context.id, ...conflicts.map((entry) => entry.id)],
    evidenceRefs: context.evidenceRefs,
    artifactRefIds: context.artifactRefIds,
    author: { kind: "coordinator", id: "cw" },
    scope: context.scope,
    parentIds: context.parentIds,
    tags: ["context", input.kind]
  });
  context.decisionId = decision.id;
  appendBlackboardNode(run, "blackboard-context", context.id, statusToNodeStatus(context.status), `${context.kind}:${context.key}`, recordPath(run, "contexts", context.id), [`${run.id}:blackboard:topic:${topic.id}`]);
  const audit = recordTrustAuditEvent(run, {
    kind: "blackboard.context",
    decision: conflicts.length ? "failed" : "accepted",
    source: sourceForAuthor(context.author),
    actor: context.author.id,
    blackboardId: board.id,
    blackboardTopicId: topic.id,
    blackboardContextId: context.id,
    coordinatorDecisionId: decision.id,
    evidenceRefs: context.evidenceRefs,
    multiAgentRunId: context.links.multiAgentRunId,
    agentGroupId: context.links.agentGroupId,
    agentRoleId: context.links.agentRoleId,
    agentMembershipId: context.links.agentMembershipId,
    metadata: { kind: context.kind, key: context.key, conflicts: context.conflictingContextIds }
  });
  const writeAudit = recordBlackboardWriteAudit(run, {
    operation: "context",
    status: context.status,
    actor: context.author,
    multiAgentRunId: context.links.multiAgentRunId,
    agentGroupId: context.links.agentGroupId,
    agentRoleId: context.links.agentRoleId,
    agentMembershipId: context.links.agentMembershipId,
    blackboardId: board.id,
    blackboardTopicId: topic.id,
    blackboardContextId: context.id,
    coordinatorDecisionId: decision.id,
    evidenceRefs: context.evidenceRefs,
    parentEventIds: unique([...(permission ? [permission.event.id] : []), audit.id]),
    policyRef: permission?.policyRef,
    metadata: { kind: context.kind, key: context.key, conflicts: context.conflictingContextIds }
  });
  context.links.auditEventIds = unique([...(context.links.auditEventIds || []), audit.id]);
  context.links.auditEventIds = unique([...(context.links.auditEventIds || []), writeAudit.id]);
  persistBlackboardState(run);
  return context;
}

export function addBlackboardArtifact(run: WorkflowRun, input: AddArtifactInput): BlackboardArtifactRef {
  if (!input.path && !input.locator) throw new Error("Blackboard artifact requires --path or --locator");
  const state = ensureBlackboardState(run);
  const board = resolveBlackboard(run, { id: input.blackboardId });
  const topic = input.topicId ? requireTopic(run, input.topicId) : undefined;
  if (topic && topic.blackboardId !== board.id) throw new Error(`Topic ${topic.id} does not belong to blackboard ${board.id}`);
  const id = input.id || createId("artifact");
  assertUnique(state.artifacts, id, "BlackboardArtifactRef");
  const author = normalizeAuthor(input.author, "operator");
  const links = compactLinks(run, { ...board.links, ...(topic?.links || {}), ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
  const permission = shouldEnforcePolicy(author, links)
    ? assertMultiAgentActionAllowed(run, {
        operation: "artifact",
        actor: author,
        multiAgentRunId: links.multiAgentRunId,
        agentRoleId: links.agentRoleId,
        agentGroupId: links.agentGroupId,
        agentMembershipId: links.agentMembershipId,
        blackboardId: board.id,
        blackboardTopicId: topic?.id,
        blackboardArtifactRefId: id,
        evidenceRefs: input.evidenceRefs || []
      })
    : undefined;
  const absolutePath = input.path ? path.resolve(input.path) : undefined;
  const artifact: BlackboardArtifactRef = {
    ...base(run, board.id, id, author, input.scope, "active", input.tags, input.metadata),
    topicId: topic?.id,
    kind: input.kind,
    path: absolutePath,
    locator: input.locator,
    owner: normalizeAuthor(input.owner || input.author, "operator"),
    source: input.source || "operator-recorded",
    provenance: compactLinks(run, { ...(input.provenance || {}), ...links }),
    evidenceRefs: unique(input.evidenceRefs || []),
    checksum: absolutePath && fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? checksumFile(absolutePath) : undefined,
    trustAuditEventIds: unique(input.auditEventIds || [])
  };
  state.artifacts.push(artifact);
  board.artifactRefIds = unique([...board.artifactRefIds, artifact.id]);
  if (topic) topic.artifactRefIds = unique([...topic.artifactRefIds, artifact.id]);
  touch(board);
  if (topic) touch(topic);
  const decision = recordCoordinatorDecision(run, {
    blackboardId: board.id,
    topicId: topic?.id,
    kind: "artifact-index",
    outcome: "accepted",
    reason: `Indexed ${artifact.kind} artifact ${artifact.id}`,
    subjectIds: [artifact.id],
    evidenceRefs: artifact.evidenceRefs,
    artifactRefIds: [artifact.id],
    author: { kind: "coordinator", id: "cw" },
    scope: artifact.scope,
    tags: ["artifact", artifact.kind]
  });
  appendBlackboardNode(run, "blackboard-artifact", artifact.id, "completed", artifact.kind, recordPath(run, "artifacts", artifact.id), [
    topic ? `${run.id}:blackboard:topic:${topic.id}` : `${run.id}:blackboard:${board.id}`
  ]);
  const audit = recordTrustAuditEvent(run, {
    kind: "blackboard.artifact",
    decision: "accepted",
    source: sourceForAuthor(artifact.author),
    actor: artifact.author.id,
    blackboardId: board.id,
    blackboardTopicId: topic?.id,
    blackboardArtifactRefId: artifact.id,
    coordinatorDecisionId: decision.id,
    workerId: artifact.provenance.workerId,
    taskId: artifact.provenance.taskId,
    candidateId: artifact.provenance.candidateId,
    commitId: artifact.provenance.commitId,
    normalizedPath: absolutePath,
    evidenceRefs: artifact.evidenceRefs,
    parentEventIds: artifact.trustAuditEventIds,
    metadata: { kind: artifact.kind, locator: artifact.locator, checksum: artifact.checksum }
  });
  const writeAudit = recordBlackboardWriteAudit(run, {
    operation: "artifact",
    status: artifact.status,
    actor: artifact.author,
    multiAgentRunId: artifact.provenance.multiAgentRunId,
    agentGroupId: artifact.provenance.agentGroupId,
    agentRoleId: artifact.provenance.agentRoleId,
    agentMembershipId: artifact.provenance.agentMembershipId,
    blackboardId: board.id,
    blackboardTopicId: topic?.id,
    blackboardArtifactRefId: artifact.id,
    coordinatorDecisionId: decision.id,
    evidenceRefs: artifact.evidenceRefs,
    parentEventIds: unique([...(permission ? [permission.event.id] : []), audit.id]),
    policyRef: permission?.policyRef,
    metadata: { kind: artifact.kind, locator: artifact.locator, checksum: artifact.checksum }
  });
  artifact.trustAuditEventIds = unique([...artifact.trustAuditEventIds, audit.id, writeAudit.id]);
  persistBlackboardState(run);
  return artifact;
}

export function createBlackboardSnapshot(run: WorkflowRun, blackboardId?: string): BlackboardSnapshot {
  const state = ensureBlackboardState(run);
  const board = resolveBlackboard(run, { id: blackboardId });
  const id = createId("snapshot");
  const snapshotPath = recordPath(run, "snapshots", id);
  const summary = summarizeBlackboard(run, board.id) as unknown as Record<string, unknown>;
  const snapshot: BlackboardSnapshot = {
    ...base(run, board.id, id, { kind: "runtime", id: "cw" }, { kind: "run", id: run.id }, "active", ["snapshot"], undefined),
    topicIds: [...board.topicIds].sort(),
    messageIds: state.messages.filter((entry) => entry.blackboardId === board.id).map((entry) => entry.id).sort(),
    contextIds: [...board.contextIds].sort(),
    artifactRefIds: [...board.artifactRefIds].sort(),
    decisionIds: [...board.decisionIds].sort(),
    snapshotPath,
    indexPath: board.paths.index,
    summary,
    links: compactLinks(run, board.links)
  };
  state.snapshots.push(snapshot);
  board.snapshotIds = unique([...board.snapshotIds, snapshot.id]);
  touch(board);
  appendBlackboardNode(run, "blackboard-snapshot", snapshot.id, "completed", snapshot.id, snapshotPath, [`${run.id}:blackboard:${board.id}`]);
  const audit = recordTrustAuditEvent(run, {
    kind: "blackboard.snapshot",
    decision: "recorded",
    source: "runtime-derived",
    actor: "cw",
    blackboardId: board.id,
    blackboardSnapshotId: snapshot.id,
    metadata: { snapshotPath, counts: summary }
  });
  const writeAudit = recordBlackboardWriteAudit(run, {
    operation: "snapshot",
    status: snapshot.status,
    actor: snapshot.author,
    multiAgentRunId: snapshot.links.multiAgentRunId,
    agentGroupId: snapshot.links.agentGroupId,
    agentRoleId: snapshot.links.agentRoleId,
    agentMembershipId: snapshot.links.agentMembershipId,
    blackboardId: board.id,
    blackboardSnapshotId: snapshot.id,
    parentEventIds: [audit.id],
    metadata: { snapshotPath }
  });
  snapshot.links.auditEventIds = [audit.id];
  snapshot.links.auditEventIds = unique([...snapshot.links.auditEventIds, writeAudit.id]);
  persistBlackboardState(run);
  return snapshot;
}

export function recordCoordinatorDecision(run: WorkflowRun, input: RecordDecisionInput): CoordinatorDecision {
  const state = ensureBlackboardState(run);
  const board = resolveBlackboard(run, { id: input.blackboardId });
  const id = input.id || createId("decision");
  assertUnique(state.decisions, id, "CoordinatorDecision");
  const decision: CoordinatorDecision = {
    ...base(run, board.id, id, input.author || { kind: "coordinator", id: "cw" }, input.scope, decisionStatus(input.outcome), input.tags, input.metadata),
    kind: input.kind,
    outcome: input.outcome,
    subjectIds: unique(input.subjectIds || []),
    reason: input.reason,
    evidenceRefs: unique(input.evidenceRefs || []),
    artifactRefIds: requireArtifactRefs(run, input.artifactRefIds || []),
    messageIds: requireMessages(run, input.messageIds || []),
    links: compactLinks(run, { ...board.links, ...roleLinkFromAuthor(input.author), ...(input.links || {}), evidenceRefs: input.evidenceRefs })
  };
  state.decisions.push(decision);
  board.decisionIds = unique([...board.decisionIds, decision.id]);
  touch(board);
  appendBlackboardNode(run, "coordinator-decision", decision.id, statusToNodeStatus(decision.status), `${decision.kind}:${decision.outcome}`, recordPath(run, "decisions", decision.id), [
    `${run.id}:blackboard:${board.id}`,
    ...(input.topicId ? [`${run.id}:blackboard:topic:${input.topicId}`] : [])
  ]);
  const audit = recordTrustAuditEvent(run, {
    kind: "coordinator.decision",
    decision: auditDecision(input.outcome),
    source: "cw-validated",
    actor: decision.author.id,
    blackboardId: board.id,
    blackboardTopicId: input.topicId,
    coordinatorDecisionId: decision.id,
    multiAgentRunId: decision.links.multiAgentRunId,
    agentGroupId: decision.links.agentGroupId,
    agentRoleId: decision.links.agentRoleId,
    agentMembershipId: decision.links.agentMembershipId,
    evidenceRefs: decision.evidenceRefs,
    metadata: {
      kind: decision.kind,
      outcome: decision.outcome,
      subjectIds: decision.subjectIds,
      reason: decision.reason
    }
  });
  const writeAudit = recordBlackboardWriteAudit(run, {
    operation: "coordinator-decision",
    status: decision.status,
    actor: decision.author,
    multiAgentRunId: decision.links.multiAgentRunId,
    agentGroupId: decision.links.agentGroupId,
    agentRoleId: decision.links.agentRoleId,
    agentMembershipId: decision.links.agentMembershipId,
    blackboardId: board.id,
    blackboardTopicId: input.topicId,
    coordinatorDecisionId: decision.id,
    evidenceRefs: decision.evidenceRefs,
    parentEventIds: [audit.id],
    metadata: { kind: decision.kind, outcome: decision.outcome }
  });
  if (decision.kind === "candidate-synthesis" || decision.tags.includes("panel-decision")) {
    const panelAudit = recordJudgeRationaleAudit(run, {
      kind: "judge.panel-decision",
      actor: decision.author,
      multiAgentRunId: decision.links.multiAgentRunId,
      agentGroupId: decision.links.agentGroupId,
      agentRoleId: decision.links.agentRoleId,
      agentMembershipId: decision.links.agentMembershipId,
      blackboardId: board.id,
      blackboardTopicId: input.topicId,
      coordinatorDecisionId: decision.id,
      evidenceRefs: decision.evidenceRefs,
      rationale: decision.reason,
      parentEventIds: [audit.id, writeAudit.id]
    });
    decision.links.auditEventIds = unique([...(decision.links.auditEventIds || []), panelAudit.id]);
  }
  decision.links.auditEventIds = unique([...(decision.links.auditEventIds || []), audit.id, writeAudit.id]);
  persistBlackboardState(run);
  return decision;
}

export function summarizeBlackboard(run: WorkflowRun, blackboardId?: string): BlackboardSummary {
  const state = ensureBlackboardState(run);
  const board = blackboardId ? state.boards.find((entry) => entry.id === blackboardId) : state.boards[0];
  const scoped = <T extends { blackboardId: string }>(items: T[]) => board ? items.filter((item) => item.blackboardId === board.id) : [];
  const contexts = scoped(state.contexts);
  const artifacts = scoped(state.artifacts);
  const openQuestions = contexts.filter((context) => context.kind === "question" && context.status === "open");
  const conflicts = contexts.filter((context) => context.status === "conflicting" || context.conflictingContextIds.length);
  const missingEvidence = [
    ...openQuestions.filter((context) => !context.evidenceRefs.length && !context.artifactRefIds.length).map((context) => `question ${context.id} has no indexed evidence`),
    ...contexts.filter((context) => context.kind !== "question" && context.status !== "superseded" && !context.evidenceRefs.length && !context.artifactRefIds.length).map((context) => `context ${context.id} has no indexed evidence`)
  ].sort();
  const readyForFanin = Boolean(board && !openQuestions.length && !conflicts.length && artifacts.length > 0 && missingEvidence.length === 0);
  const latestSnapshot = scoped(state.snapshots).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
  return {
    runId: run.id,
    blackboardId: board?.id,
    topics: scoped(state.topics).length,
    messages: scoped(state.messages).length,
    contexts: contexts.length,
    artifacts: artifacts.length,
    snapshots: scoped(state.snapshots).length,
    decisions: scoped(state.decisions).length,
    openQuestions,
    conflicts,
    missingEvidence,
    readyForFanin,
    latestSnapshotPath: latestSnapshot?.snapshotPath,
    indexPath: board?.paths.index || path.join(blackboardRoot(run), "index.json"),
    nextAction: nextAction(run, board, openQuestions, conflicts, artifacts)
  };
}

export function listBlackboardMessages(run: WorkflowRun, options: { topicId?: string; blackboardId?: string } = {}): BlackboardMessage[] {
  const state = ensureBlackboardState(run);
  return state.messages
    .filter((message) => (!options.blackboardId || message.blackboardId === options.blackboardId) && (!options.topicId || message.topicId === options.topicId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function listBlackboardArtifacts(run: WorkflowRun, options: { topicId?: string; blackboardId?: string } = {}): BlackboardArtifactRef[] {
  const state = ensureBlackboardState(run);
  return state.artifacts
    .filter((artifact) => (!options.blackboardId || artifact.blackboardId === options.blackboardId) && (!options.topicId || artifact.topicId === options.topicId))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildBlackboardGraph(run: WorkflowRun): BlackboardGraph {
  const state = ensureBlackboardState(run);
  const nodes: BlackboardGraph["nodes"] = [];
  const edges: BlackboardGraph["edges"] = [];
  for (const board of state.boards) {
    nodes.push({ id: `${run.id}:blackboard:${board.id}`, kind: "blackboard", status: board.status, label: board.title, path: board.paths.index });
    edges.push({ from: `${run.id}:run`, to: `${run.id}:blackboard:${board.id}` });
    if (board.links.multiAgentRunId) edges.push({ from: `${run.id}:multi-agent:${board.links.multiAgentRunId}`, to: `${run.id}:blackboard:${board.id}`, label: "coordinates" });
  }
  for (const topic of state.topics) {
    nodes.push({ id: `${run.id}:blackboard:topic:${topic.id}`, kind: "blackboard-topic", status: topic.status, label: topic.title, path: recordPath(run, "topics", topic.id) });
    edges.push({ from: `${run.id}:blackboard:${topic.blackboardId}`, to: `${run.id}:blackboard:topic:${topic.id}` });
  }
  for (const context of state.contexts) {
    nodes.push({ id: `${run.id}:blackboard:context:${context.id}`, kind: "blackboard-context", status: context.status, label: `${context.kind}:${context.key}`, path: recordPath(run, "contexts", context.id) });
    edges.push({ from: `${run.id}:blackboard:topic:${context.topicId}`, to: `${run.id}:blackboard:context:${context.id}` });
    for (const conflicting of context.conflictingContextIds) edges.push({ from: `${run.id}:blackboard:context:${context.id}`, to: `${run.id}:blackboard:context:${conflicting}`, label: "conflicts" });
  }
  for (const artifact of state.artifacts) {
    nodes.push({ id: `${run.id}:blackboard:artifact:${artifact.id}`, kind: "blackboard-artifact", status: artifact.status, label: artifact.kind, path: recordPath(run, "artifacts", artifact.id) });
    edges.push({ from: artifact.topicId ? `${run.id}:blackboard:topic:${artifact.topicId}` : `${run.id}:blackboard:${artifact.blackboardId}`, to: `${run.id}:blackboard:artifact:${artifact.id}` });
  }
  for (const message of state.messages) {
    nodes.push({ id: `${run.id}:blackboard:message:${message.id}`, kind: "blackboard-message", status: message.status, label: truncate(message.body), path: messagesPath(run) });
    edges.push({ from: `${run.id}:blackboard:topic:${message.topicId}`, to: `${run.id}:blackboard:message:${message.id}` });
    if (message.replyToId) edges.push({ from: `${run.id}:blackboard:message:${message.replyToId}`, to: `${run.id}:blackboard:message:${message.id}`, label: "reply" });
    for (const artifactId of message.linkedArtifactRefIds) edges.push({ from: `${run.id}:blackboard:message:${message.id}`, to: `${run.id}:blackboard:artifact:${artifactId}`, label: "cites" });
  }
  for (const decision of state.decisions) {
    nodes.push({ id: `${run.id}:coordinator:decision:${decision.id}`, kind: "coordinator-decision", status: decision.status, label: `${decision.kind}:${decision.outcome}`, path: recordPath(run, "decisions", decision.id) });
    edges.push({ from: `${run.id}:blackboard:${decision.blackboardId}`, to: `${run.id}:coordinator:decision:${decision.id}` });
    for (const subjectId of decision.subjectIds) edges.push({ from: `${run.id}:coordinator:decision:${decision.id}`, to: graphSubject(run, subjectId), label: "subject" });
  }
  for (const snapshot of state.snapshots) {
    nodes.push({ id: `${run.id}:blackboard:snapshot:${snapshot.id}`, kind: "blackboard-snapshot", status: snapshot.status, label: snapshot.id, path: snapshot.snapshotPath });
    edges.push({ from: `${run.id}:blackboard:${snapshot.blackboardId}`, to: `${run.id}:blackboard:snapshot:${snapshot.id}` });
  }
  return { nodes, edges: uniqueEdges(edges) };
}

export function persistBlackboardState(run: WorkflowRun): void {
  const state = ensureBlackboardState(run);
  const root = blackboardRoot(run);
  assertNoRecordPathCollisions("BlackboardTopic", state.topics);
  assertNoRecordPathCollisions("BlackboardContext", state.contexts);
  assertNoRecordPathCollisions("BlackboardArtifactRef", state.artifacts);
  assertNoRecordPathCollisions("BlackboardSnapshot", state.snapshots);
  assertNoRecordPathCollisions("CoordinatorDecision", state.decisions);
  const index = {
    schemaVersion: BLACKBOARD_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: timestamp(),
    counts: {
      boards: state.boards.length,
      topics: state.topics.length,
      messages: state.messages.length,
      contexts: state.contexts.length,
      artifacts: state.artifacts.length,
      snapshots: state.snapshots.length,
      decisions: state.decisions.length
    },
    boards: state.boards.map(indexRow),
    topics: state.topics.map(indexRow),
    contexts: state.contexts.map(indexRow),
    artifacts: state.artifacts.map(indexRow),
    snapshots: state.snapshots.map(indexRow),
    decisions: state.decisions.map(indexRow),
    messages: state.messages.map((message) => ({
      id: message.id,
      blackboardId: message.blackboardId,
      topicId: message.topicId,
      createdAt: message.createdAt,
      status: message.status,
      author: message.author,
      evidenceRefs: message.linkedEvidenceRefs,
      artifactRefIds: message.linkedArtifactRefIds
    }))
  };
  writeJson(path.join(root, "index.json"), index);
  fs.writeFileSync(messagesPath(run), state.messages.sort(compareRecords).map((message) => JSON.stringify(message)).join("\n") + (state.messages.length ? "\n" : ""), "utf8");
  for (const topic of state.topics) writeJson(recordPath(run, "topics", topic.id), topic);
  for (const context of state.contexts) writeJson(recordPath(run, "contexts", context.id), context);
  for (const artifact of state.artifacts) writeJson(recordPath(run, "artifacts", artifact.id), artifact);
  for (const snapshot of state.snapshots) writeJson(recordPath(run, "snapshots", snapshot.id), snapshot);
  for (const decision of state.decisions) writeJson(recordPath(run, "decisions", decision.id), decision);
}

function emptyState(): BlackboardState {
  return {
    schemaVersion: BLACKBOARD_SCHEMA_VERSION,
    boards: [],
    topics: [],
    messages: [],
    contexts: [],
    artifacts: [],
    snapshots: [],
    decisions: []
  };
}

function roleLinkFromAuthor(author: Partial<BlackboardAuthor> | undefined): Partial<BlackboardLinks> {
  if (!author?.id) return {};
  if (author.kind === "role") return { agentRoleId: author.id };
  if (author.kind === "group") return { agentGroupId: author.id };
  if (author.kind === "membership") return { agentMembershipId: author.id };
  if (author.kind === "worker") return { workerId: author.id };
  return {};
}

function shouldEnforcePolicy(author: BlackboardAuthor, links: BlackboardLinks): boolean {
  if (author.kind === "role" || author.kind === "group" || author.kind === "membership" || author.kind === "worker") return true;
  return Boolean(links.agentRoleId || links.agentGroupId || links.agentMembershipId);
}

function base(
  run: WorkflowRun,
  blackboardId: string,
  id: string,
  author?: Partial<BlackboardAuthor>,
  scope?: Partial<BlackboardScope>,
  status: BlackboardRecordStatus = "active",
  tags?: string[],
  metadata?: Record<string, unknown>
) {
  const now = timestamp();
  return {
    schemaVersion: BLACKBOARD_SCHEMA_VERSION as 1,
    id,
    runId: run.id,
    blackboardId,
    createdAt: now,
    updatedAt: now,
    author: normalizeAuthor(author, "operator"),
    scope: normalizeScope(scope, { kind: "run", id: run.id }),
    status,
    parentIds: [],
    tags: sortTags(tags),
    metadata: scrub(metadata)
  };
}

function normalizeAuthor(input: Partial<BlackboardAuthor> | undefined, fallbackKind: BlackboardAuthor["kind"]): BlackboardAuthor {
  const kind = input?.kind || fallbackKind;
  const id = input?.id || (kind === "runtime" || kind === "coordinator" ? "cw" : kind === "operator" ? "operator" : undefined);
  if (!id) throw new Error("Blackboard author requires an explicit id");
  return { kind, id, displayName: input?.displayName };
}

function normalizeScope(input: Partial<BlackboardScope> | undefined, fallback: BlackboardScope): BlackboardScope {
  const kind = input?.kind || fallback.kind;
  const id = input?.id || fallback.id;
  if (!kind || !id) throw new Error("Blackboard scope requires kind and id");
  return { kind, id };
}

function compactLinks(run: WorkflowRun, input: Partial<BlackboardLinks>): BlackboardLinks {
  return compact({
    workflowRunId: run.id,
    multiAgentRunId: input.multiAgentRunId,
    agentGroupId: input.agentGroupId,
    agentRoleId: input.agentRoleId,
    agentMembershipId: input.agentMembershipId,
    agentFanoutId: input.agentFanoutId,
    agentFaninId: input.agentFaninId,
    taskId: input.taskId,
    workerId: input.workerId,
    candidateId: input.candidateId,
    verifierNodeId: input.verifierNodeId,
    commitId: input.commitId,
    auditEventIds: unique(input.auditEventIds || []),
    evidenceRefs: unique(input.evidenceRefs || [])
  }) as unknown as BlackboardLinks;
}

function linkMultiAgent(run: WorkflowRun, blackboardId: string, topicIds: string[], input: Partial<BlackboardLinks> | ResolveBlackboardInput): void {
  const groupId = "agentGroupId" in input ? input.agentGroupId : ("groupId" in input ? input.groupId : undefined);
  const roleId = "agentRoleId" in input ? input.agentRoleId : ("roleId" in input ? input.roleId : undefined);
  const membershipId = "agentMembershipId" in input ? input.agentMembershipId : ("membershipId" in input ? input.membershipId : undefined);
  if (input.multiAgentRunId) {
    const record = getMultiAgentRun(run, input.multiAgentRunId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = unique([...(record.topicIds || []), ...topicIds]);
      record.links.blackboardId = blackboardId;
      record.links.blackboardTopicIds = unique([...(record.links.blackboardTopicIds || []), ...topicIds]);
    }
  }
  if (groupId) {
    const record = getAgentGroup(run, groupId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = unique([...(record.topicIds || []), ...topicIds]);
    }
  }
  if (roleId) {
    const record = getAgentRole(run, roleId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = unique([...(record.topicIds || []), ...topicIds]);
    }
  }
  if (membershipId) {
    const record = getAgentMembership(run, membershipId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = unique([...(record.topicIds || []), ...topicIds]);
    }
  }
}

function requireBoard(run: WorkflowRun, id: string): Blackboard {
  const board = ensureBlackboardState(run).boards.find((entry) => entry.id === id);
  if (!board) throw new Error(`Unknown Blackboard id: ${id}`);
  return board;
}

function requireTopic(run: WorkflowRun, id: string): BlackboardTopic {
  const topic = ensureBlackboardState(run).topics.find((entry) => entry.id === id);
  if (!topic) throw new Error(`Unknown BlackboardTopic id: ${id}`);
  return topic;
}

function requireContext(run: WorkflowRun, id: string): BlackboardContext {
  const context = ensureBlackboardState(run).contexts.find((entry) => entry.id === id);
  if (!context) throw new Error(`Unknown BlackboardContext id: ${id}`);
  return context;
}

function requireArtifactRefs(run: WorkflowRun, ids: string[]): string[] {
  const state = ensureBlackboardState(run);
  for (const id of ids) {
    if (!state.artifacts.some((artifact) => artifact.id === id)) throw new Error(`Unknown BlackboardArtifactRef id: ${id}`);
  }
  return unique(ids);
}

function requireMessages(run: WorkflowRun, ids: string[]): string[] {
  const state = ensureBlackboardState(run);
  for (const id of ids) {
    if (!state.messages.some((message) => message.id === id)) throw new Error(`Unknown BlackboardMessage id: ${id}`);
  }
  return unique(ids);
}

function appendBlackboardNode(
  run: WorkflowRun,
  kind: "blackboard" | "blackboard-topic" | "blackboard-message" | "blackboard-context" | "blackboard-artifact" | "blackboard-snapshot" | "coordinator-decision",
  id: string,
  status: StateNodeStatus,
  label: string,
  artifactPath: string,
  parents: string[] = []
): void {
  const nodeId = kind === "blackboard"
    ? `${run.id}:blackboard:${id}`
    : kind === "coordinator-decision"
      ? `${run.id}:coordinator:decision:${id}`
      : `${run.id}:blackboard:${kind.replace("blackboard-", "")}:${id}`;
  appendRunNode(
    run,
    createStateNode({
      id: nodeId,
      kind,
      status,
      loopStage: run.loopStage,
      outputs: { id, label },
      artifacts: [{ id: kind, kind: "json", path: artifactPath }],
      parents,
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: { id, label }
    })
  );
}

function statusToNodeStatus(status: string): StateNodeStatus {
  switch (status) {
    case "active":
    case "open":
      return "running";
    case "resolved":
    case "superseded":
      return "completed";
    case "conflicting":
      return "blocked";
    case "rejected":
      return "rejected";
    default:
      return "completed";
  }
}

function decisionStatus(outcome: CoordinatorDecisionOutcome): BlackboardRecordStatus {
  if (outcome === "conflicting" || outcome === "blocked") return "conflicting";
  if (outcome === "rejected") return "rejected";
  if (outcome === "superseded") return "superseded";
  return "active";
}

function auditDecision(outcome: CoordinatorDecisionOutcome) {
  if (outcome === "rejected") return "rejected" as const;
  if (outcome === "blocked" || outcome === "conflicting") return "failed" as const;
  return "accepted" as const;
}

function sourceForAuthor(author: BlackboardAuthor) {
  if (author.kind === "runtime" || author.kind === "coordinator") return "runtime-derived" as const;
  if (author.kind === "worker" || author.kind === "verifier") return "cw-validated" as const;
  return "operator-recorded" as const;
}

function boardPaths(run: WorkflowRun): Blackboard["paths"] {
  const root = blackboardRoot(run);
  return {
    root,
    index: path.join(root, "index.json"),
    messages: messagesPath(run),
    topicsDir: path.join(root, "topics"),
    contextsDir: path.join(root, "contexts"),
    artifactsDir: path.join(root, "artifacts"),
    snapshotsDir: path.join(root, "snapshots"),
    decisionsDir: path.join(root, "decisions")
  };
}

function blackboardRoot(run: WorkflowRun): string {
  return run.paths.blackboardDir || path.join(run.paths.runDir, "blackboard");
}

function messagesPath(run: WorkflowRun): string {
  return path.join(blackboardRoot(run), "messages.jsonl");
}

function recordPath(run: WorkflowRun, kind: string, id: string): string {
  return path.join(blackboardRoot(run), kind, `${safeFileName(id)}.json`);
}

function graphSubject(run: WorkflowRun, id: string): string {
  const state = ensureBlackboardState(run);
  if (state.contexts.some((entry) => entry.id === id)) return `${run.id}:blackboard:context:${id}`;
  if (state.artifacts.some((entry) => entry.id === id)) return `${run.id}:blackboard:artifact:${id}`;
  if (state.messages.some((entry) => entry.id === id)) return `${run.id}:blackboard:message:${id}`;
  return id;
}

function nextAction(run: WorkflowRun, board: Blackboard | undefined, openQuestions: BlackboardContext[], conflicts: BlackboardContext[], artifacts: BlackboardArtifactRef[]): string | undefined {
  if (!board) return `node scripts/cw.js blackboard topic create ${run.id} --id <topic-id> --title "<title>"`;
  if (conflicts.length) return `node scripts/cw.js coordinator decision ${run.id} --kind conflict-resolution --outcome accepted --subject ${conflicts[0].id} --reason "<reason>"`;
  if (openQuestions.length) return `node scripts/cw.js blackboard message post ${run.id} --topic ${openQuestions[0].topicId} --body "<answer with evidence>"`;
  if (!artifacts.length) return `node scripts/cw.js blackboard artifact add ${run.id} --path <path> --kind <kind>`;
  return `node scripts/cw.js blackboard snapshot ${run.id}`;
}

function checksumFile(file: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function assertUnique(items: Array<{ id: string }>, id: string, label: string): void {
  if (items.some((item) => item.id === id)) throw new Error(`Duplicate ${label} id: ${id}`);
}

function assertNoRecordPathCollisions(label: string, records: Array<{ id: string }>): void {
  const seen = new Map<string, string>();
  for (const record of records) {
    const safe = safeFileName(record.id);
    const existing = seen.get(safe);
    if (existing && existing !== record.id) {
      throw new Error(`${label} ids ${existing} and ${record.id} collide on safe file name ${safe}`);
    }
    seen.set(safe, record.id);
  }
}

function indexRow(record: { id: string; status?: string; updatedAt?: string; blackboardId?: string; topicId?: string }): Record<string, unknown> {
  return { id: record.id, blackboardId: record.blackboardId, topicId: record.topicId, status: record.status, updatedAt: record.updatedAt };
}

function compareRecords(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number {
  return compareBytes(left.createdAt, right.createdAt) || compareBytes(left.id, right.id);
}

function uniqueEdges(edges: BlackboardGraph["edges"]): BlackboardGraph["edges"] {
  const seen = new Set<string>();
  const result: BlackboardGraph["edges"] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

function createId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function touch<T extends { updatedAt: string }>(record: T): T {
  record.updatedAt = timestamp();
  return record;
}

function timestamp(): string {
  return new Date().toISOString();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function sortTags(values: string[] | undefined): string[] {
  return unique(values || []);
}

function truncate(value: string): string {
  return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && (!Array.isArray(entry) || entry.length > 0)));
}

// Recursive secret redaction (v0.1.40 self-audit P3): the previous scrub only
// inspected TOP-LEVEL keys, so a secret nested under an allowed key
// (e.g. `metadata.config.token`) leaked into the recorded coordinator decision.
// Now we recurse into nested objects and arrays so a secret-named key at any depth
// is dropped and an obvious credential value is redacted.
const SECRET_KEY_RE = /secret|token|password|credential|authorization|api[_-]?key|env/i;
const SECRET_VALUE_RE = /secret|token|password|credential/i;

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") return scrub(value as Record<string, unknown>);
  if (typeof value === "string" && SECRET_VALUE_RE.test(value)) return "[redacted]";
  return value;
}

function scrub(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (SECRET_KEY_RE.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = scrubValue(entry);
    }
  }
  return Object.keys(result).length ? result : undefined;
}
