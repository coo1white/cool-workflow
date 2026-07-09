// shell/coordinator-io.ts — the impure wrapper wiring core/multi-agent/
// coordinator.ts's pure record builders to real disk and the trust-audit
// chain.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// src/coordinator.ts: directory creation, index.json + messages.jsonl +
// per-record writes, and every create call's audit-event recording +
// state-node append + policy checks.
//
// Evidence: SPEC/multi-agent.md section C, "Files on disk";
// plugins/cool-workflow/src/coordinator.ts (byte-exact source for the
// wiring sequence).

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { writeJson } from "./fs-atomic";
import { WorkflowRun } from "../core/state/types";
import { appendRunNode } from "./node-store";
import { createStateNode } from "../core/state/state-node";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "../core/pipeline/contract";
import { recordTrustAuditEvent } from "./trust-audit";
import * as cb from "../core/multi-agent/coordinator";
import { getAgentGroup, getAgentMembership, getAgentRole, getMultiAgentRun } from "../core/multi-agent/runtime";
import { assertMultiAgentActionAllowed, hashText, recordBlackboardWriteAudit, recordJudgeRationaleAudit, recordMessageProvenanceAudit } from "./trust-policy-io";

function blackboardRoot(run: WorkflowRun): string {
  return run.paths.blackboardDir || path.join(run.paths.runDir, "blackboard");
}
function messagesPath(run: WorkflowRun): string {
  return path.join(blackboardRoot(run), "messages.jsonl");
}
function recordPath(run: WorkflowRun, kind: string, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
  return path.join(blackboardRoot(run), kind, `${safe}.json`);
}
function boardPaths(run: WorkflowRun): cb.Blackboard["paths"] {
  const root = blackboardRoot(run);
  return { root, index: path.join(root, "index.json"), messages: messagesPath(run), topicsDir: path.join(root, "topics"), contextsDir: path.join(root, "contexts"), artifactsDir: path.join(root, "artifacts"), snapshotsDir: path.join(root, "snapshots"), decisionsDir: path.join(root, "decisions") };
}

function now(): string {
  return new Date().toISOString();
}

export function ensureBlackboardState(run: WorkflowRun): cb.BlackboardState {
  run.paths.blackboardDir = blackboardRoot(run);
  fs.mkdirSync(run.paths.blackboardDir, { recursive: true });
  for (const dir of ["topics", "contexts", "artifacts", "snapshots", "decisions"]) fs.mkdirSync(path.join(run.paths.blackboardDir, dir), { recursive: true });
  const existing = run.blackboard as unknown as cb.BlackboardState | undefined;
  const state: cb.BlackboardState = existing || cb.emptyBlackboardState();
  state.schemaVersion = cb.BLACKBOARD_SCHEMA_VERSION;
  state.boards = state.boards || [];
  state.topics = state.topics || [];
  state.messages = state.messages || [];
  state.contexts = state.contexts || [];
  state.artifacts = state.artifacts || [];
  state.snapshots = state.snapshots || [];
  state.decisions = state.decisions || [];
  run.blackboard = state as unknown as WorkflowRun["blackboard"];
  return state;
}

function requireBoard(run: WorkflowRun, id: string): cb.Blackboard {
  const board = ensureBlackboardState(run).boards.find((entry) => entry.id === id);
  if (!board) throw new Error(`Unknown Blackboard id: ${id}`);
  return board;
}
function requireTopic(run: WorkflowRun, id: string): cb.BlackboardTopic {
  const topic = ensureBlackboardState(run).topics.find((entry) => entry.id === id);
  if (!topic) throw new Error(`Unknown BlackboardTopic id: ${id}`);
  return topic;
}
function requireContext(run: WorkflowRun, id: string): cb.BlackboardContext {
  const context = ensureBlackboardState(run).contexts.find((entry) => entry.id === id);
  if (!context) throw new Error(`Unknown BlackboardContext id: ${id}`);
  return context;
}
function requireArtifactRefs(run: WorkflowRun, ids: string[]): string[] {
  const state = ensureBlackboardState(run);
  for (const id of ids) if (!state.artifacts.some((artifact) => artifact.id === id)) throw new Error(`Unknown BlackboardArtifactRef id: ${id}`);
  return cb.unique(ids);
}
function requireMessages(run: WorkflowRun, ids: string[]): string[] {
  const state = ensureBlackboardState(run);
  for (const id of ids) if (!state.messages.some((message) => message.id === id)) throw new Error(`Unknown BlackboardMessage id: ${id}`);
  return cb.unique(ids);
}

function checksumFile(file: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

// Dirty-id tracking for persistBlackboardState. Each of the 5 record kinds
// below gets its OWN file on disk (recordPath); without this, every persist
// call rewrote every record every time, so building up to N records via N
// create calls cost O(N^2) disk writes. Now a persist call only rewrites the
// ids added or touched since the LAST persist. Kept off the serialized
// BlackboardState itself (a WeakMap keyed by the state object, not a field
// on it) so it can never leak into state.json's bytes. Every push to
// state.topics/contexts/artifacts/snapshots/decisions, and every field
// mutation of an existing record of one of those 5 kinds, MUST call
// markBlackboardDirty right after — this file is the only writer of these
// records, so that invariant is enforced here, not by a generic hook.
type BlackboardRecordKind = "topics" | "contexts" | "artifacts" | "snapshots" | "decisions";
const blackboardDirtySets = new WeakMap<cb.BlackboardState, Record<BlackboardRecordKind, Set<string>>>();

function dirtySetsFor(state: cb.BlackboardState): Record<BlackboardRecordKind, Set<string>> {
  let sets = blackboardDirtySets.get(state);
  if (!sets) {
    sets = { topics: new Set(), contexts: new Set(), artifacts: new Set(), snapshots: new Set(), decisions: new Set() };
    blackboardDirtySets.set(state, sets);
  }
  return sets;
}

function markBlackboardDirty(state: cb.BlackboardState, kind: BlackboardRecordKind, id: string): void {
  dirtySetsFor(state)[kind].add(id);
}

function linkMultiAgent(run: WorkflowRun, blackboardId: string, topicIds: string[], input: { multiAgentRunId?: string; groupId?: string; roleId?: string; membershipId?: string; agentGroupId?: string; agentRoleId?: string; agentMembershipId?: string }): void {
  const groupId = input.agentGroupId ?? input.groupId;
  const roleId = input.agentRoleId ?? input.roleId;
  const membershipId = input.agentMembershipId ?? input.membershipId;
  if (input.multiAgentRunId) {
    const record = getMultiAgentRun(run, input.multiAgentRunId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = cb.unique([...(record.topicIds || []), ...topicIds]);
      record.links.blackboardId = blackboardId;
      record.links.blackboardTopicIds = cb.unique([...(record.links.blackboardTopicIds || []), ...topicIds]);
    }
  }
  if (groupId) {
    const record = getAgentGroup(run, groupId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = cb.unique([...(record.topicIds || []), ...topicIds]);
    }
  }
  if (roleId) {
    const record = getAgentRole(run, roleId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = cb.unique([...(record.topicIds || []), ...topicIds]);
    }
  }
  if (membershipId) {
    const record = getAgentMembership(run, membershipId);
    if (record) {
      record.blackboardId = blackboardId;
      record.topicIds = cb.unique([...(record.topicIds || []), ...topicIds]);
    }
  }
}

function appendBlackboardNode(run: WorkflowRun, kind: "blackboard" | "blackboard-topic" | "blackboard-message" | "blackboard-context" | "blackboard-artifact" | "blackboard-snapshot" | "coordinator-decision", id: string, status: "pending" | "running" | "completed" | "blocked" | "failed" | "rejected", label: string, artifactPath: string, parents: string[] = []): void {
  const nodeId = kind === "blackboard" ? `${run.id}:blackboard:${id}` : kind === "coordinator-decision" ? `${run.id}:coordinator:decision:${id}` : `${run.id}:blackboard:${kind.replace("blackboard-", "")}:${id}`;
  appendRunNode(run, createStateNode({ id: nodeId, kind, status, loopStage: run.loopStage, outputs: { id, label }, artifacts: [{ id: kind, kind: "json", path: artifactPath }], parents, contractId: DEFAULT_PIPELINE_CONTRACT_ID, metadata: { id, label } }));
}

export function persistBlackboardState(run: WorkflowRun): void {
  const state = ensureBlackboardState(run);
  const root = blackboardRoot(run);
  cb.assertNoRecordPathCollisions("BlackboardTopic", state.topics);
  cb.assertNoRecordPathCollisions("BlackboardContext", state.contexts);
  cb.assertNoRecordPathCollisions("BlackboardArtifactRef", state.artifacts);
  cb.assertNoRecordPathCollisions("BlackboardSnapshot", state.snapshots);
  cb.assertNoRecordPathCollisions("CoordinatorDecision", state.decisions);
  writeJson(path.join(root, "index.json"), {
    schemaVersion: cb.BLACKBOARD_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: now(),
    counts: { boards: state.boards.length, topics: state.topics.length, messages: state.messages.length, contexts: state.contexts.length, artifacts: state.artifacts.length, snapshots: state.snapshots.length, decisions: state.decisions.length },
    boards: state.boards.map(cb.indexRow),
    topics: state.topics.map(cb.indexRow),
    contexts: state.contexts.map(cb.indexRow),
    artifacts: state.artifacts.map(cb.indexRow),
    snapshots: state.snapshots.map(cb.indexRow),
    decisions: state.decisions.map(cb.indexRow),
    messages: state.messages.map((message) => ({ id: message.id, blackboardId: message.blackboardId, topicId: message.topicId, createdAt: message.createdAt, status: message.status, author: message.author, evidenceRefs: message.linkedEvidenceRefs, artifactRefIds: message.linkedArtifactRefIds })),
  });
  fs.writeFileSync(messagesPath(run), state.messages.sort(cb.compareRecords).map((message) => JSON.stringify(message)).join("\n") + (state.messages.length ? "\n" : ""), "utf8");
  const dirty = dirtySetsFor(state);
  for (const id of dirty.topics) { const record = state.topics.find((entry) => entry.id === id); if (record) writeJson(recordPath(run, "topics", id), record); }
  for (const id of dirty.contexts) { const record = state.contexts.find((entry) => entry.id === id); if (record) writeJson(recordPath(run, "contexts", id), record); }
  for (const id of dirty.artifacts) { const record = state.artifacts.find((entry) => entry.id === id); if (record) writeJson(recordPath(run, "artifacts", id), record); }
  for (const id of dirty.snapshots) { const record = state.snapshots.find((entry) => entry.id === id); if (record) writeJson(recordPath(run, "snapshots", id), record); }
  for (const id of dirty.decisions) { const record = state.decisions.find((entry) => entry.id === id); if (record) writeJson(recordPath(run, "decisions", id), record); }
  dirty.topics.clear();
  dirty.contexts.clear();
  dirty.artifacts.clear();
  dirty.snapshots.clear();
  dirty.decisions.clear();
}

export function resolveBlackboard(run: WorkflowRun, input: cb.ResolveBlackboardInput = {}): cb.Blackboard {
  const state = ensureBlackboardState(run);
  const existing = input.id ? state.boards.find((board) => board.id === input.id) : input.multiAgentRunId ? state.boards.find((board) => board.links.multiAgentRunId === input.multiAgentRunId) : state.boards[0];
  if (existing) {
    linkMultiAgent(run, existing.id, existing.topicIds, input);
    cb.touch(existing, now());
    persistBlackboardState(run);
    return existing;
  }
  const id = input.id || cb.createId("bb", state.boards.length + 1);
  cb.assertUnique(state.boards, id, "Blackboard");
  const board = cb.buildBlackboard(run.id, input, id, now(), boardPaths(run));
  linkMultiAgent(run, board.id, [], input);
  state.boards.push(board);
  appendBlackboardNode(run, "blackboard", board.id, "running", board.title, board.paths.index);
  const audit = recordTrustAuditEvent(run, { kind: "blackboard.create", decision: "recorded", source: "runtime-derived", actor: board.author.id, multiAgentRunId: input.multiAgentRunId, agentGroupId: input.groupId, agentRoleId: input.roleId, agentMembershipId: input.membershipId, blackboardId: board.id, metadata: { scope: board.scope, tags: board.tags } });
  board.links.auditEventIds = [audit.id];
  persistBlackboardState(run);
  return board;
}

export function createBlackboardTopic(run: WorkflowRun, input: cb.CreateTopicInput): cb.BlackboardTopic {
  const board = resolveBlackboard(run, { id: input.blackboardId });
  const state = ensureBlackboardState(run);
  const id = input.id || cb.createId("topic", state.topics.length + 1);
  cb.assertUnique(state.topics, id, "BlackboardTopic");
  const topic = cb.buildTopic(run.id, board, input, id, now());
  state.topics.push(topic);
  markBlackboardDirty(state, "topics", topic.id);
  board.topicIds = cb.unique([...board.topicIds, topic.id]);
  cb.touch(board, now());
  linkMultiAgent(run, board.id, [topic.id], board.links);
  appendBlackboardNode(run, "blackboard-topic", topic.id, "running", topic.title, recordPath(run, "topics", topic.id), [`${run.id}:blackboard:${board.id}`]);
  const audit = recordTrustAuditEvent(run, { kind: "blackboard.topic", decision: "recorded", source: "operator-recorded", actor: topic.author.id, blackboardId: board.id, blackboardTopicId: topic.id, multiAgentRunId: topic.links.multiAgentRunId, agentGroupId: topic.links.agentGroupId, agentRoleId: topic.links.agentRoleId, agentMembershipId: topic.links.agentMembershipId, metadata: { title: topic.title, tags: topic.tags } });
  topic.links.auditEventIds = cb.unique([...(topic.links.auditEventIds || []), audit.id]);
  recordBlackboardWriteAudit(run, { operation: "topic", status: topic.status, actor: topic.author, blackboardId: board.id, blackboardTopicId: topic.id, multiAgentRunId: topic.links.multiAgentRunId, agentGroupId: topic.links.agentGroupId, agentRoleId: topic.links.agentRoleId, agentMembershipId: topic.links.agentMembershipId, parentEventIds: [audit.id], metadata: { title: topic.title } });
  persistBlackboardState(run);
  return topic;
}

export function postBlackboardMessage(run: WorkflowRun, input: cb.PostMessageInput): cb.BlackboardMessage {
  const state = ensureBlackboardState(run);
  const topic = requireTopic(run, input.topicId);
  const board = requireBoard(run, input.blackboardId || topic.blackboardId);
  if (input.replyToId && !state.messages.some((message) => message.id === input.replyToId)) throw new Error(`Unknown parent BlackboardMessage id: ${input.replyToId}`);
  if (!input.body.trim()) throw new Error("Blackboard message body is required");
  const id = input.id || cb.createId("msg", state.messages.length + 1);
  cb.assertUnique(state.messages, id, "BlackboardMessage");
  const author = cb.normalizeAuthor(input.author, "operator");
  const links = cb.compactLinks(run.id, { ...topic.links, ...cb.roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
  const enforcePolicy = cb.shouldEnforcePolicy(author, links);
  const permission = enforcePolicy
    ? assertMultiAgentActionAllowed(run, { operation: "message", actor: author, multiAgentRunId: links.multiAgentRunId, agentRoleId: links.agentRoleId, agentGroupId: links.agentGroupId, agentMembershipId: links.agentMembershipId, agentFanoutId: links.agentFanoutId, agentFaninId: links.agentFaninId, blackboardId: board.id, blackboardTopicId: topic.id, blackboardMessageId: id, evidenceRefs: input.evidenceRefs || [] })
    : undefined;
  requireArtifactRefs(run, input.artifactRefIds || []);
  const message = cb.buildMessage(run.id, board, topic, input, id, now(), hashText, sourceForActorLocal);
  state.messages.push(message);
  topic.messageIds = cb.unique([...topic.messageIds, message.id]);
  board.messageCount = state.messages.filter((entry) => entry.blackboardId === board.id).length;
  cb.touch(topic, now());
  markBlackboardDirty(state, "topics", topic.id);
  cb.touch(board, now());
  appendBlackboardNode(run, "blackboard-message", message.id, "completed", cb.truncate(message.body), messagesPath(run), [`${run.id}:blackboard:topic:${topic.id}`]);
  const audit = recordTrustAuditEvent(run, {
    kind: "blackboard.message",
    decision: "recorded",
    source: cb.sourceForAuthor(message.author),
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
    metadata: { visibility: message.visibility },
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
    parentEventIds: cb.unique([...(permission ? [permission.event.id] : []), audit.id]),
    policyRef: permission?.policyRef,
    metadata: { visibility: message.visibility },
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
    policyRef: permission?.policyRef,
  });
  if ((message.metadata as Record<string, unknown> | undefined)?.judgeRationale || message.tags.includes("judge-rationale")) {
    const rationaleAudit = recordJudgeRationaleAudit(run, { kind: "judge.rationale", actor: message.author, multiAgentRunId: message.links.multiAgentRunId, agentRoleId: message.links.agentRoleId, agentGroupId: message.links.agentGroupId, agentMembershipId: message.links.agentMembershipId, blackboardId: board.id, blackboardTopicId: topic.id, blackboardMessageId: message.id, evidenceRefs: message.linkedEvidenceRefs, rationale: message.body, policyRef: permission?.policyRef, parentEventIds: [audit.id, writeAudit.id, provenanceAudit.id] });
    message.linkedAuditEventIds = cb.unique([...message.linkedAuditEventIds, rationaleAudit.id]);
  }
  message.linkedAuditEventIds = cb.unique([...message.linkedAuditEventIds, audit.id, writeAudit.id, provenanceAudit.id]);
  message.links.auditEventIds = cb.unique([...(message.links.auditEventIds || []), audit.id, writeAudit.id, provenanceAudit.id]);
  if (message.provenance) message.provenance.linkedAuditEventIds = cb.unique([...message.provenance.linkedAuditEventIds, audit.id, writeAudit.id, provenanceAudit.id]);
  persistBlackboardState(run);
  return message;
}

function sourceForActorLocal(author: cb.BlackboardAuthor): string {
  return cb.sourceForAuthor(author);
}

export function putBlackboardContext(run: WorkflowRun, input: cb.PutContextInput): cb.BlackboardContext {
  const state = ensureBlackboardState(run);
  const topic = requireTopic(run, input.topicId);
  const board = requireBoard(run, input.blackboardId || topic.blackboardId);
  const id = input.id || cb.createId("ctx", state.contexts.length + 1);
  cb.assertUnique(state.contexts, id, "BlackboardContext");
  const author = cb.normalizeAuthor(input.author, "operator");
  const links = cb.compactLinks(run.id, { ...topic.links, ...cb.roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs });
  const permission = cb.shouldEnforcePolicy(author, links) ? assertMultiAgentActionAllowed(run, { operation: "context", actor: author, multiAgentRunId: links.multiAgentRunId, agentRoleId: links.agentRoleId, agentGroupId: links.agentGroupId, agentMembershipId: links.agentMembershipId, blackboardId: board.id, blackboardTopicId: topic.id, blackboardContextId: id, evidenceRefs: input.evidenceRefs || [] }) : undefined;
  requireArtifactRefs(run, input.artifactRefIds || []);
  for (const supersededId of input.supersedesContextIds || []) {
    const superseded = requireContext(run, supersededId);
    superseded.status = "superseded";
    superseded.supersededByContextId = id;
    cb.touch(superseded, now());
    markBlackboardDirty(state, "contexts", superseded.id);
  }
  const { context, conflicts } = cb.buildContext(run.id, board, topic, input, id, now(), state.contexts);
  for (const conflict of conflicts) {
    conflict.status = "conflicting";
    conflict.conflictingContextIds = cb.unique([...conflict.conflictingContextIds, context.id]);
    cb.touch(conflict, now());
    markBlackboardDirty(state, "contexts", conflict.id);
  }
  state.contexts.push(context);
  markBlackboardDirty(state, "contexts", context.id);
  topic.contextIds = cb.unique([...topic.contextIds, context.id]);
  board.contextIds = cb.unique([...board.contextIds, context.id]);
  cb.touch(topic, now());
  markBlackboardDirty(state, "topics", topic.id);
  cb.touch(board, now());
  const decision = recordCoordinatorDecision(run, {
    blackboardId: board.id,
    topicId: topic.id,
    kind: conflicts.length ? "conflict-resolution" : "context-update",
    outcome: conflicts.length ? "conflicting" : "accepted",
    reason: conflicts.length ? `Context ${context.id} conflicts with ${conflicts.map((entry) => entry.id).join(", ")}` : `Accepted ${input.kind} context ${context.id}`,
    subjectIds: [context.id, ...conflicts.map((entry) => entry.id)],
    evidenceRefs: context.evidenceRefs,
    artifactRefIds: context.artifactRefIds,
    author: { kind: "coordinator", id: "cw" },
    scope: context.scope,
    parentIds: context.parentIds,
    tags: ["context", input.kind],
  });
  context.decisionId = decision.id;
  appendBlackboardNode(run, "blackboard-context", context.id, cb.coordinatorStatusToNodeStatus(context.status), `${context.kind}:${context.key}`, recordPath(run, "contexts", context.id), [`${run.id}:blackboard:topic:${topic.id}`]);
  const audit = recordTrustAuditEvent(run, { kind: "blackboard.context", decision: conflicts.length ? "failed" : "accepted", source: cb.sourceForAuthor(context.author), actor: context.author.id, blackboardId: board.id, blackboardTopicId: topic.id, blackboardContextId: context.id, coordinatorDecisionId: decision.id, evidenceRefs: context.evidenceRefs, multiAgentRunId: context.links.multiAgentRunId, agentGroupId: context.links.agentGroupId, agentRoleId: context.links.agentRoleId, agentMembershipId: context.links.agentMembershipId, metadata: { kind: context.kind, key: context.key, conflicts: context.conflictingContextIds } });
  const writeAudit = recordBlackboardWriteAudit(run, { operation: "context", status: context.status, actor: context.author, multiAgentRunId: context.links.multiAgentRunId, agentGroupId: context.links.agentGroupId, agentRoleId: context.links.agentRoleId, agentMembershipId: context.links.agentMembershipId, blackboardId: board.id, blackboardTopicId: topic.id, blackboardContextId: context.id, coordinatorDecisionId: decision.id, evidenceRefs: context.evidenceRefs, parentEventIds: cb.unique([...(permission ? [permission.event.id] : []), audit.id]), policyRef: permission?.policyRef, metadata: { kind: context.kind, key: context.key, conflicts: context.conflictingContextIds } });
  context.links.auditEventIds = cb.unique([...(context.links.auditEventIds || []), audit.id]);
  context.links.auditEventIds = cb.unique([...(context.links.auditEventIds || []), writeAudit.id]);
  // context.decisionId (above) and both auditEventIds assignments happen AFTER
  // recordCoordinatorDecision's own nested persistBlackboardState call already
  // flushed and cleared the dirty set, so context must be re-marked here or
  // this call's final persist would skip rewriting it.
  markBlackboardDirty(state, "contexts", context.id);
  persistBlackboardState(run);
  return context;
}

export function addBlackboardArtifact(run: WorkflowRun, input: cb.AddArtifactInput): cb.BlackboardArtifactRef {
  if (!input.path && !input.locator) throw new Error("Blackboard artifact requires --path or --locator");
  const state = ensureBlackboardState(run);
  const board = resolveBlackboard(run, { id: input.blackboardId });
  const topic = input.topicId ? requireTopic(run, input.topicId) : undefined;
  if (topic && topic.blackboardId !== board.id) throw new Error(`Topic ${topic.id} does not belong to blackboard ${board.id}`);
  const id = input.id || cb.createId("artifact", state.artifacts.length + 1);
  cb.assertUnique(state.artifacts, id, "BlackboardArtifactRef");
  const author = cb.normalizeAuthor(input.author, "operator");
  const links = cb.compactLinks(run.id, { ...board.links, ...(topic?.links || {}), ...cb.roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
  const permission = cb.shouldEnforcePolicy(author, links) ? assertMultiAgentActionAllowed(run, { operation: "artifact", actor: author, multiAgentRunId: links.multiAgentRunId, agentRoleId: links.agentRoleId, agentGroupId: links.agentGroupId, agentMembershipId: links.agentMembershipId, blackboardId: board.id, blackboardTopicId: topic?.id, blackboardArtifactRefId: id, evidenceRefs: input.evidenceRefs || [] }) : undefined;
  const absolutePath = input.path ? path.resolve(input.path) : undefined;
  const checksum = absolutePath && fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? checksumFile(absolutePath) : undefined;
  const artifact = cb.buildArtifact(run.id, board, topic, input, id, now(), absolutePath, checksum);
  state.artifacts.push(artifact);
  markBlackboardDirty(state, "artifacts", artifact.id);
  board.artifactRefIds = cb.unique([...board.artifactRefIds, artifact.id]);
  if (topic) topic.artifactRefIds = cb.unique([...topic.artifactRefIds, artifact.id]);
  cb.touch(board, now());
  if (topic) {
    cb.touch(topic, now());
    markBlackboardDirty(state, "topics", topic.id);
  }
  const decision = recordCoordinatorDecision(run, { blackboardId: board.id, topicId: topic?.id, kind: "artifact-index", outcome: "accepted", reason: `Indexed ${artifact.kind} artifact ${artifact.id}`, subjectIds: [artifact.id], evidenceRefs: artifact.evidenceRefs, artifactRefIds: [artifact.id], author: { kind: "coordinator", id: "cw" }, scope: artifact.scope, tags: ["artifact", artifact.kind] });
  appendBlackboardNode(run, "blackboard-artifact", artifact.id, "completed", artifact.kind, recordPath(run, "artifacts", artifact.id), [topic ? `${run.id}:blackboard:topic:${topic.id}` : `${run.id}:blackboard:${board.id}`]);
  const audit = recordTrustAuditEvent(run, { kind: "blackboard.artifact", decision: "accepted", source: cb.sourceForAuthor(artifact.author), actor: artifact.author.id, blackboardId: board.id, blackboardTopicId: topic?.id, blackboardArtifactRefId: artifact.id, coordinatorDecisionId: decision.id, workerId: artifact.provenance.workerId, taskId: artifact.provenance.taskId, candidateId: artifact.provenance.candidateId, commitId: artifact.provenance.commitId, normalizedPath: absolutePath, evidenceRefs: artifact.evidenceRefs, parentEventIds: artifact.trustAuditEventIds, metadata: { kind: artifact.kind, locator: artifact.locator, checksum: artifact.checksum } });
  const writeAudit = recordBlackboardWriteAudit(run, { operation: "artifact", status: artifact.status, actor: artifact.author, multiAgentRunId: artifact.provenance.multiAgentRunId, agentGroupId: artifact.provenance.agentGroupId, agentRoleId: artifact.provenance.agentRoleId, agentMembershipId: artifact.provenance.agentMembershipId, blackboardId: board.id, blackboardTopicId: topic?.id, blackboardArtifactRefId: artifact.id, coordinatorDecisionId: decision.id, evidenceRefs: artifact.evidenceRefs, parentEventIds: cb.unique([...(permission ? [permission.event.id] : []), audit.id]), policyRef: permission?.policyRef, metadata: { kind: artifact.kind, locator: artifact.locator, checksum: artifact.checksum } });
  artifact.trustAuditEventIds = cb.unique([...artifact.trustAuditEventIds, audit.id, writeAudit.id]);
  // Happens AFTER recordCoordinatorDecision's own nested persist already
  // flushed and cleared the dirty set — re-mark or this call's final persist
  // would skip rewriting the artifact.
  markBlackboardDirty(state, "artifacts", artifact.id);
  persistBlackboardState(run);
  return artifact;
}

export function createBlackboardSnapshot(run: WorkflowRun, blackboardId?: string): cb.BlackboardSnapshot {
  const state = ensureBlackboardState(run);
  const board = resolveBlackboard(run, { id: blackboardId });
  const id = cb.createId("snapshot", state.snapshots.length + 1);
  const snapshotPath = recordPath(run, "snapshots", id);
  const summary = summarizeBlackboard(run, board.id) as unknown as Record<string, unknown>;
  const messageIds = state.messages.filter((entry) => entry.blackboardId === board.id).map((entry) => entry.id);
  const snapshot = cb.buildSnapshot(run.id, board, id, now(), snapshotPath, board.paths.index, summary, messageIds);
  state.snapshots.push(snapshot);
  markBlackboardDirty(state, "snapshots", snapshot.id);
  board.snapshotIds = cb.unique([...board.snapshotIds, snapshot.id]);
  cb.touch(board, now());
  appendBlackboardNode(run, "blackboard-snapshot", snapshot.id, "completed", snapshot.id, snapshotPath, [`${run.id}:blackboard:${board.id}`]);
  const audit = recordTrustAuditEvent(run, { kind: "blackboard.snapshot", decision: "recorded", source: "runtime-derived", actor: "cw", blackboardId: board.id, blackboardSnapshotId: snapshot.id, metadata: { snapshotPath, counts: summary } });
  const writeAudit = recordBlackboardWriteAudit(run, { operation: "snapshot", status: snapshot.status, actor: snapshot.author, multiAgentRunId: snapshot.links.multiAgentRunId, agentGroupId: snapshot.links.agentGroupId, agentRoleId: snapshot.links.agentRoleId, agentMembershipId: snapshot.links.agentMembershipId, blackboardId: board.id, blackboardSnapshotId: snapshot.id, parentEventIds: [audit.id], metadata: { snapshotPath } });
  snapshot.links.auditEventIds = [audit.id];
  snapshot.links.auditEventIds = cb.unique([...snapshot.links.auditEventIds, writeAudit.id]);
  persistBlackboardState(run);
  return snapshot;
}

export function recordCoordinatorDecision(run: WorkflowRun, input: cb.RecordDecisionInput): cb.CoordinatorDecision {
  const state = ensureBlackboardState(run);
  const board = resolveBlackboard(run, { id: input.blackboardId });
  const id = input.id || cb.createId("decision", state.decisions.length + 1);
  cb.assertUnique(state.decisions, id, "CoordinatorDecision");
  requireArtifactRefs(run, input.artifactRefIds || []);
  requireMessages(run, input.messageIds || []);
  const decision = cb.buildDecision(run.id, board, input, id, now());
  state.decisions.push(decision);
  markBlackboardDirty(state, "decisions", decision.id);
  board.decisionIds = cb.unique([...board.decisionIds, decision.id]);
  cb.touch(board, now());
  appendBlackboardNode(run, "coordinator-decision", decision.id, cb.coordinatorStatusToNodeStatus(decision.status), `${decision.kind}:${decision.outcome}`, recordPath(run, "decisions", decision.id), [`${run.id}:blackboard:${board.id}`, ...(input.topicId ? [`${run.id}:blackboard:topic:${input.topicId}`] : [])]);
  const audit = recordTrustAuditEvent(run, { kind: "coordinator.decision", decision: cb.auditDecision(input.outcome), source: "cw-validated", actor: decision.author.id, blackboardId: board.id, blackboardTopicId: input.topicId, coordinatorDecisionId: decision.id, multiAgentRunId: decision.links.multiAgentRunId, agentGroupId: decision.links.agentGroupId, agentRoleId: decision.links.agentRoleId, agentMembershipId: decision.links.agentMembershipId, evidenceRefs: decision.evidenceRefs, metadata: { kind: decision.kind, outcome: decision.outcome, subjectIds: decision.subjectIds, reason: decision.reason } });
  const writeAudit = recordBlackboardWriteAudit(run, { operation: "coordinator-decision", status: decision.status, actor: decision.author, multiAgentRunId: decision.links.multiAgentRunId, agentGroupId: decision.links.agentGroupId, agentRoleId: decision.links.agentRoleId, agentMembershipId: decision.links.agentMembershipId, blackboardId: board.id, blackboardTopicId: input.topicId, coordinatorDecisionId: decision.id, evidenceRefs: decision.evidenceRefs, parentEventIds: [audit.id], metadata: { kind: decision.kind, outcome: decision.outcome } });
  if (decision.kind === "candidate-synthesis" || decision.tags.includes("panel-decision")) {
    const panelAudit = recordJudgeRationaleAudit(run, { kind: "judge.panel-decision", actor: decision.author, multiAgentRunId: decision.links.multiAgentRunId, agentGroupId: decision.links.agentGroupId, agentRoleId: decision.links.agentRoleId, agentMembershipId: decision.links.agentMembershipId, blackboardId: board.id, blackboardTopicId: input.topicId, coordinatorDecisionId: decision.id, evidenceRefs: decision.evidenceRefs, rationale: decision.reason, parentEventIds: [audit.id, writeAudit.id] });
    decision.links.auditEventIds = cb.unique([...(decision.links.auditEventIds || []), panelAudit.id]);
  }
  decision.links.auditEventIds = cb.unique([...(decision.links.auditEventIds || []), audit.id, writeAudit.id]);
  persistBlackboardState(run);
  return decision;
}

export function summarizeBlackboard(run: WorkflowRun, blackboardId?: string): cb.BlackboardSummary {
  const state = ensureBlackboardState(run);
  return cb.summarizeBlackboard(run.id, state, blackboardId, path.join(blackboardRoot(run), "index.json"));
}

export function listBlackboardMessages(run: WorkflowRun, options: { topicId?: string; blackboardId?: string } = {}): cb.BlackboardMessage[] {
  return cb.listBlackboardMessages(ensureBlackboardState(run), options);
}

export function listBlackboardArtifacts(run: WorkflowRun, options: { topicId?: string; blackboardId?: string } = {}): cb.BlackboardArtifactRef[] {
  return cb.listBlackboardArtifacts(ensureBlackboardState(run), options);
}

export function buildBlackboardGraph(run: WorkflowRun): cb.BlackboardGraph {
  const state = ensureBlackboardState(run);
  return cb.buildBlackboardGraph(run.id, state, (kind, id) => recordPath(run, kind, id), messagesPath(run));
}
