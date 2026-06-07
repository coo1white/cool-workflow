import fs from "node:fs";
import path from "node:path";
import {
  AgentFanin,
  AgentFanout,
  AgentGroup,
  AgentMembership,
  AgentMembershipStatus,
  AgentRole,
  AgentRoleStatus,
  AgentGroupStatus,
  AgentFanoutStatus,
  AgentFaninStatus,
  MultiAgentLifecycleEvent,
  MultiAgentLifecycleStatus,
  MultiAgentRun,
  MultiAgentState,
  RunTask,
  StateEvidence,
  StateNodeStatus,
  WorkflowRun,
  WorkerMultiAgentMetadata
} from "./types";
import { safeFileName, writeJson } from "./state";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { appendRunNode, createStateNode } from "./state-node";
import { recordTrustAuditEvent } from "./trust-audit";

export const MULTI_AGENT_SCHEMA_VERSION = 1;

export interface CreateMultiAgentRunInput {
  id?: string;
  title?: string;
  objective?: string;
  parentMultiAgentRunId?: string;
  status?: MultiAgentLifecycleStatus;
  phase?: string;
  phaseId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentRoleInput {
  id?: string;
  multiAgentRunId: string;
  title?: string;
  responsibilities?: string[];
  requiredEvidence?: string[];
  sandboxProfileHints?: string[];
  expectedArtifacts?: string[];
  faninObligations?: string[];
  parentRoleId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentGroupInput {
  id?: string;
  multiAgentRunId: string;
  title?: string;
  phase?: string;
  phaseId?: string;
  taskIds?: string[];
  parentGroupId?: string;
  metadata?: Record<string, unknown>;
}

export interface AssignAgentMembershipInput {
  id?: string;
  multiAgentRunId?: string;
  groupId: string;
  roleId: string;
  taskId: string;
  workerId?: string;
  dispatchId?: string;
  fanoutId?: string;
  status?: AgentMembershipStatus;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentFanoutInput {
  id?: string;
  multiAgentRunId?: string;
  groupId: string;
  reason: string;
  roleIds?: string[];
  taskIds?: string[];
  workerIds?: string[];
  membershipIds?: string[];
  dispatchIds?: string[];
  concurrencyLimit?: number;
  sandboxProfileChoices?: Record<string, string>;
  expectedReturnShape?: string;
  metadata?: Record<string, unknown>;
}

export interface CollectAgentFaninInput {
  id?: string;
  multiAgentRunId?: string;
  groupId?: string;
  fanoutId?: string;
  requiredRoleIds?: string[];
  strategy?: string;
  metadata?: Record<string, unknown>;
}

export interface AttachDispatchToMultiAgentInput {
  multiAgentRunId?: string;
  groupId?: string;
  roleId?: string;
  fanoutId?: string;
  dispatchId: string;
  tasks: RunTask[];
  sandboxProfileId?: string;
  concurrencyLimit?: number;
}

export interface MultiAgentSummary {
  totalRuns: number;
  runsByStatus: Record<string, number>;
  roles: number;
  groups: number;
  memberships: number;
  fanouts: number;
  fanins: number;
  groupsByStatus: Record<string, number>;
  membershipsByStatus: Record<string, number>;
  faninsByStatus: Record<string, number>;
  blockedReasons: string[];
  groupsDetail: Array<{
    id: string;
    multiAgentRunId: string;
    status: AgentGroupStatus;
    phase?: string;
    roles: Array<{ roleId: string; requiredEvidence: number; memberships: number; reported: number; missing: number }>;
    fanouts: string[];
    fanins: string[];
  }>;
  nextAction?: string;
}

export interface MultiAgentGraph {
  nodes: Array<{ id: string; kind: string; status: string; label: string; path?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export function ensureMultiAgentState(run: WorkflowRun): MultiAgentState {
  run.paths.multiAgentDir = multiAgentRoot(run);
  fs.mkdirSync(run.paths.multiAgentDir, { recursive: true });
  for (const dir of ["runs", "roles", "groups", "memberships", "fanouts", "fanins"]) {
    fs.mkdirSync(path.join(run.paths.multiAgentDir, dir), { recursive: true });
  }
  if (!run.multiAgent) {
    run.multiAgent = {
      schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
      runs: [],
      roles: [],
      groups: [],
      memberships: [],
      fanouts: [],
      fanins: []
    };
  }
  run.multiAgent.schemaVersion = MULTI_AGENT_SCHEMA_VERSION;
  run.multiAgent.runs = run.multiAgent.runs || [];
  run.multiAgent.roles = run.multiAgent.roles || [];
  run.multiAgent.groups = run.multiAgent.groups || [];
  run.multiAgent.memberships = run.multiAgent.memberships || [];
  run.multiAgent.fanouts = run.multiAgent.fanouts || [];
  run.multiAgent.fanins = run.multiAgent.fanins || [];
  return run.multiAgent;
}

export function persistMultiAgentState(run: WorkflowRun): void {
  const state = ensureMultiAgentState(run);
  const root = multiAgentRoot(run);
  writeJson(path.join(root, "index.json"), {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    runId: run.id,
    counts: {
      runs: state.runs.length,
      roles: state.roles.length,
      groups: state.groups.length,
      memberships: state.memberships.length,
      fanouts: state.fanouts.length,
      fanins: state.fanins.length
    },
    runs: state.runs.map(indexRow),
    roles: state.roles.map(indexRow),
    groups: state.groups.map(indexRow),
    memberships: state.memberships.map(indexRow),
    fanouts: state.fanouts.map(indexRow),
    fanins: state.fanins.map(indexRow)
  });
  for (const record of state.runs) writeRecord(run, "runs", record);
  for (const record of state.roles) writeRecord(run, "roles", record);
  for (const record of state.groups) writeRecord(run, "groups", record);
  for (const record of state.memberships) writeRecord(run, "memberships", record);
  for (const record of state.fanouts) writeRecord(run, "fanouts", record);
  for (const record of state.fanins) writeRecord(run, "fanins", record);
}

export function createMultiAgentRun(run: WorkflowRun, input: CreateMultiAgentRunInput = {}): MultiAgentRun {
  const state = ensureMultiAgentState(run);
  const id = input.id || createId("mar");
  if (state.runs.some((record) => record.id === id)) throw new Error(`Duplicate MultiAgentRun id: ${id}`);
  const now = new Date().toISOString();
  const status = input.status || "planned";
  const record: MultiAgentRun = {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    id,
    runId: run.id,
    createdAt: now,
    updatedAt: now,
    status,
    title: input.title || id,
    objective: input.objective,
    parentMultiAgentRunId: input.parentMultiAgentRunId,
    childMultiAgentRunIds: [],
    roleIds: [],
    groupIds: [],
    fanoutIds: [],
    faninIds: [],
    lifecycle: [lifecycleEvent(undefined, status, "created")],
    links: {
      workflowRunId: run.id,
      phase: input.phase,
      phaseId: input.phaseId
    },
    metadata: compact(input.metadata)
  };
  if (record.parentMultiAgentRunId) {
    const parent = requireMultiAgentRun(run, record.parentMultiAgentRunId);
    parent.childMultiAgentRunIds = unique([...parent.childMultiAgentRunIds, record.id]);
    touch(parent);
  }
  state.runs.push(record);
  appendMultiAgentNode(run, "multi-agent-run", record.id, statusToNodeStatus(status), {
    title: record.title,
    objective: record.objective,
    phase: record.links.phase
  });
  recordTrustAuditEvent(run, {
    kind: "multi-agent.run",
    decision: "recorded",
    source: "runtime-derived",
    multiAgentRunId: record.id,
    metadata: { status: record.status, objective: record.objective }
  });
  persistMultiAgentState(run);
  return record;
}

export function transitionMultiAgentRun(
  run: WorkflowRun,
  multiAgentRunId: string,
  status: MultiAgentLifecycleStatus,
  options: { reason?: string; actor?: string; metadata?: Record<string, unknown> } = {}
): MultiAgentRun {
  ensureMultiAgentState(run);
  const record = requireMultiAgentRun(run, multiAgentRunId);
  assertLifecycleTransition(record.status, status);
  if (status === "completed") assertMultiAgentRunCompletionReady(run, record);
  const before = record.status;
  record.status = status;
  record.updatedAt = new Date().toISOString();
  record.lifecycle.push(lifecycleEvent(before, status, options.reason, options.actor, options.metadata));
  if (status === "completed") completeOwnedMultiAgentRecords(run, record, options.reason);
  appendMultiAgentNode(run, "multi-agent-run", record.id, statusToNodeStatus(status), {
    status,
    reason: options.reason
  });
  recordTrustAuditEvent(run, {
    kind: "multi-agent.lifecycle",
    decision: status === "failed" ? "failed" : "validated",
    source: "cw-validated",
    multiAgentRunId: record.id,
    metadata: { from: before, to: status, reason: options.reason }
  });
  persistMultiAgentState(run);
  return record;
}

function assertMultiAgentRunCompletionReady(run: WorkflowRun, multiAgentRun: MultiAgentRun): void {
  const state = ensureMultiAgentState(run);
  const groups = state.groups.filter((record) => record.multiAgentRunId === multiAgentRun.id);
  const fanins = state.fanins.filter((record) => record.multiAgentRunId === multiAgentRun.id);
  const blocked = fanins.flatMap((fanin) => {
    const reasons = [...fanin.blockedReasons];
    if (fanin.status === "blocked" || fanin.status === "failed") reasons.push(`fanin ${fanin.id} status is ${fanin.status}`);
    if (!fanin.verifierReady) reasons.push(`fanin ${fanin.id} is not verifier-ready`);
    return reasons.map((reason) => `${fanin.id}: ${reason}`);
  });
  for (const group of groups) {
    if ((group.membershipIds.length || group.fanoutIds.length) && !group.faninIds.length) {
      blocked.push(`group ${group.id} has no fanin record`);
    }
  }
  if (blocked.length) {
    throw new Error(`Cannot complete MultiAgentRun ${multiAgentRun.id}: ${blocked.join("; ")}`);
  }
}

function completeOwnedMultiAgentRecords(run: WorkflowRun, multiAgentRun: MultiAgentRun, reason?: string): void {
  const state = ensureMultiAgentState(run);
  for (const role of state.roles.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (role.status === "completed" || role.status === "cancelled") continue;
    const before = role.status;
    role.status = "completed";
    role.updatedAt = multiAgentRun.updatedAt;
    role.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
  }
  for (const group of state.groups.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (group.status === "completed" || group.status === "failed" || group.status === "cancelled") continue;
    const before = group.status;
    group.status = "completed";
    group.updatedAt = multiAgentRun.updatedAt;
    group.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
  }
  for (const fanout of state.fanouts.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (fanout.status === "completed" || fanout.status === "failed" || fanout.status === "cancelled") continue;
    const before = fanout.status;
    fanout.status = "completed";
    fanout.updatedAt = multiAgentRun.updatedAt;
    fanout.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
  }
  for (const fanin of state.fanins.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (fanin.status === "completed" || fanin.status === "failed") continue;
    const before = fanin.status;
    fanin.status = "completed";
    fanin.updatedAt = multiAgentRun.updatedAt;
    fanin.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
  }
}

export function createAgentRole(run: WorkflowRun, input: CreateAgentRoleInput): AgentRole {
  const state = ensureMultiAgentState(run);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
  const id = input.id || createId("role");
  if (state.roles.some((record) => record.id === id)) throw new Error(`Duplicate AgentRole id: ${id}`);
  if (input.parentRoleId) requireAgentRole(run, input.parentRoleId);
  const now = new Date().toISOString();
  const role: AgentRole = {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    id,
    runId: run.id,
    multiAgentRunId: multiAgentRun.id,
    createdAt: now,
    updatedAt: now,
    status: "planned",
    title: input.title || id,
    responsibilities: input.responsibilities || [],
    requiredEvidence: input.requiredEvidence || [],
    sandboxProfileHints: input.sandboxProfileHints || [],
    expectedArtifacts: input.expectedArtifacts || [],
    faninObligations: input.faninObligations || [],
    lifecycle: [lifecycleEvent(undefined, "planned", "created")],
    parentRoleId: input.parentRoleId,
    childRoleIds: [],
    metadata: compact(input.metadata)
  };
  if (role.parentRoleId) {
    const parent = requireAgentRole(run, role.parentRoleId);
    parent.childRoleIds = unique([...parent.childRoleIds, role.id]);
    touch(parent);
  }
  state.roles.push(role);
  multiAgentRun.roleIds = unique([...multiAgentRun.roleIds, role.id]);
  touch(multiAgentRun);
  appendMultiAgentNode(run, "agent-role", role.id, "pending", {
    multiAgentRunId: role.multiAgentRunId,
    title: role.title,
    responsibilities: role.responsibilities,
    requiredEvidence: role.requiredEvidence
  }, [`${run.id}:multi-agent:${role.multiAgentRunId}`]);
  recordTrustAuditEvent(run, {
    kind: "multi-agent.role",
    decision: "recorded",
    source: "runtime-derived",
    multiAgentRunId: role.multiAgentRunId,
    agentRoleId: role.id,
    metadata: {
      responsibilities: role.responsibilities,
      requiredEvidence: role.requiredEvidence,
      sandboxProfileHints: role.sandboxProfileHints,
      faninObligations: role.faninObligations
    }
  });
  persistMultiAgentState(run);
  return role;
}

export function createAgentGroup(run: WorkflowRun, input: CreateAgentGroupInput): AgentGroup {
  const state = ensureMultiAgentState(run);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
  const id = input.id || createId("group");
  if (state.groups.some((record) => record.id === id)) throw new Error(`Duplicate AgentGroup id: ${id}`);
  if (input.parentGroupId) requireAgentGroup(run, input.parentGroupId);
  for (const taskId of input.taskIds || []) requireRunTask(run, taskId);
  const now = new Date().toISOString();
  const group: AgentGroup = {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    id,
    runId: run.id,
    multiAgentRunId: multiAgentRun.id,
    createdAt: now,
    updatedAt: now,
    status: "forming",
    title: input.title || id,
    phase: input.phase,
    phaseId: input.phaseId,
    taskIds: unique(input.taskIds || []),
    roleIds: [],
    membershipIds: [],
    workerIds: [],
    fanoutIds: [],
    faninIds: [],
    lifecycle: [lifecycleEvent(undefined, "forming", "created")],
    parentGroupId: input.parentGroupId,
    childGroupIds: [],
    metadata: compact(input.metadata)
  };
  if (group.parentGroupId) {
    const parent = requireAgentGroup(run, group.parentGroupId);
    parent.childGroupIds = unique([...parent.childGroupIds, group.id]);
    touch(parent);
  }
  state.groups.push(group);
  multiAgentRun.groupIds = unique([...multiAgentRun.groupIds, group.id]);
  touch(multiAgentRun);
  appendMultiAgentNode(run, "agent-group", group.id, "running", {
    multiAgentRunId: group.multiAgentRunId,
    phase: group.phase,
    taskIds: group.taskIds
  }, [`${run.id}:multi-agent:${group.multiAgentRunId}`]);
  recordTrustAuditEvent(run, {
    kind: "multi-agent.group",
    decision: "recorded",
    source: "runtime-derived",
    multiAgentRunId: group.multiAgentRunId,
    agentGroupId: group.id,
    metadata: { phase: group.phase, taskIds: group.taskIds }
  });
  persistMultiAgentState(run);
  return group;
}

export function assignAgentMembership(run: WorkflowRun, input: AssignAgentMembershipInput): AgentMembership {
  const state = ensureMultiAgentState(run);
  const group = requireAgentGroup(run, input.groupId);
  const role = requireAgentRole(run, input.roleId);
  if (role.multiAgentRunId !== group.multiAgentRunId) {
    throw new Error(`AgentRole ${role.id} belongs to ${role.multiAgentRunId}, not group run ${group.multiAgentRunId}`);
  }
  if (input.multiAgentRunId && input.multiAgentRunId !== group.multiAgentRunId) {
    throw new Error(`Membership multiAgentRunId ${input.multiAgentRunId} does not match group ${group.id}`);
  }
  const task = requireRunTask(run, input.taskId);
  if (input.workerId && !(run.workers || []).some((worker) => worker.id === input.workerId)) {
    throw new Error(`Unknown worker id for membership: ${input.workerId}`);
  }
  const duplicate = state.memberships.find((membership) =>
    membership.groupId === group.id &&
    membership.roleId === role.id &&
    membership.taskId === task.id &&
    (input.workerId ? membership.workerId === input.workerId : !membership.workerId)
  );
  if (duplicate) {
    throw new Error(`Duplicate AgentMembership for group=${group.id}, role=${role.id}, task=${task.id}, worker=${input.workerId || "none"}`);
  }
  const id = input.id || createId("membership");
  if (state.memberships.some((record) => record.id === id)) throw new Error(`Duplicate AgentMembership id: ${id}`);
  const now = new Date().toISOString();
  const status = input.status || (input.workerId ? "running" : "assigned");
  const membership: AgentMembership = {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    id,
    runId: run.id,
    multiAgentRunId: group.multiAgentRunId,
    groupId: group.id,
    roleId: role.id,
    taskId: task.id,
    workerId: input.workerId,
    dispatchId: input.dispatchId,
    fanoutId: input.fanoutId,
    createdAt: now,
    updatedAt: now,
    status,
    lifecycle: [lifecycleEvent(undefined, status, "assigned")],
    evidenceRefs: [],
    artifactPaths: [],
    metadata: compact(input.metadata)
  };
  state.memberships.push(membership);
  group.membershipIds = unique([...group.membershipIds, membership.id]);
  group.roleIds = unique([...group.roleIds, role.id]);
  group.taskIds = unique([...group.taskIds, task.id]);
  if (membership.workerId) group.workerIds = unique([...group.workerIds, membership.workerId]);
  touch(group);
  const roleStatusBefore = role.status;
  role.status = "active";
  role.updatedAt = now;
  role.lifecycle.push(lifecycleEvent(roleStatusBefore, "active", "membership assigned"));
  if (membership.workerId) attachWorkerMetadata(run, membership);
  appendMultiAgentNode(run, "agent-membership", membership.id, statusToNodeStatus(membership.status), {
    multiAgentRunId: membership.multiAgentRunId,
    groupId: membership.groupId,
    roleId: membership.roleId,
    taskId: membership.taskId,
    workerId: membership.workerId,
    dispatchId: membership.dispatchId,
    fanoutId: membership.fanoutId
  }, [`${run.id}:multi-agent:group:${membership.groupId}`, `${run.id}:multi-agent:role:${membership.roleId}`]);
  recordTrustAuditEvent(run, {
    kind: "multi-agent.membership",
    decision: "recorded",
    source: "runtime-derived",
    workerId: membership.workerId,
    taskId: membership.taskId,
    multiAgentRunId: membership.multiAgentRunId,
    agentRoleId: membership.roleId,
    agentGroupId: membership.groupId,
    agentMembershipId: membership.id,
    agentFanoutId: membership.fanoutId,
    metadata: { status: membership.status, dispatchId: membership.dispatchId }
  });
  persistMultiAgentState(run);
  return membership;
}

export function createAgentFanout(run: WorkflowRun, input: CreateAgentFanoutInput): AgentFanout {
  const state = ensureMultiAgentState(run);
  const group = requireAgentGroup(run, input.groupId);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group.multiAgentRunId);
  if (group.multiAgentRunId !== multiAgentRun.id) throw new Error(`AgentGroup ${group.id} does not belong to ${multiAgentRun.id}`);
  const id = input.id || createId("fanout");
  if (state.fanouts.some((record) => record.id === id)) throw new Error(`Duplicate AgentFanout id: ${id}`);
  for (const roleId of input.roleIds || []) requireAgentRole(run, roleId);
  for (const taskId of input.taskIds || []) requireRunTask(run, taskId);
  const now = new Date().toISOString();
  const fanout: AgentFanout = {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    id,
    runId: run.id,
    multiAgentRunId: multiAgentRun.id,
    groupId: group.id,
    createdAt: now,
    updatedAt: now,
    status: "planned",
    reason: input.reason,
    roleIds: unique(input.roleIds || group.roleIds),
    taskIds: unique(input.taskIds || group.taskIds),
    workerIds: unique(input.workerIds || []),
    membershipIds: unique(input.membershipIds || []),
    dispatchIds: unique(input.dispatchIds || []),
    concurrencyLimit: input.concurrencyLimit,
    sandboxProfileChoices: input.sandboxProfileChoices || {},
    expectedReturnShape: input.expectedReturnShape || "Each member writes a Markdown result with a cw:result JSON fence containing summary, findings, and evidence.",
    lifecycle: [lifecycleEvent(undefined, "planned", "created")],
    metadata: compact(input.metadata)
  };
  state.fanouts.push(fanout);
  group.fanoutIds = unique([...group.fanoutIds, fanout.id]);
  group.roleIds = unique([...group.roleIds, ...fanout.roleIds]);
  group.taskIds = unique([...group.taskIds, ...fanout.taskIds]);
  touch(group);
  multiAgentRun.fanoutIds = unique([...multiAgentRun.fanoutIds, fanout.id]);
  touch(multiAgentRun);
  appendMultiAgentNode(run, "agent-fanout", fanout.id, "pending", {
    multiAgentRunId: fanout.multiAgentRunId,
    groupId: fanout.groupId,
    reason: fanout.reason,
    roleIds: fanout.roleIds,
    taskIds: fanout.taskIds,
    concurrencyLimit: fanout.concurrencyLimit,
    sandboxProfileChoices: fanout.sandboxProfileChoices
  }, [`${run.id}:multi-agent:group:${fanout.groupId}`]);
  recordTrustAuditEvent(run, {
    kind: "multi-agent.fanout",
    decision: "recorded",
    source: "runtime-derived",
    multiAgentRunId: fanout.multiAgentRunId,
    agentGroupId: fanout.groupId,
    agentFanoutId: fanout.id,
    metadata: {
      reason: fanout.reason,
      roleIds: fanout.roleIds,
      taskIds: fanout.taskIds,
      concurrencyLimit: fanout.concurrencyLimit,
      sandboxProfileChoices: fanout.sandboxProfileChoices
    }
  });
  persistMultiAgentState(run);
  return fanout;
}

export function attachDispatchToMultiAgent(run: WorkflowRun, input: AttachDispatchToMultiAgentInput): {
  multiAgent?: NonNullable<WorkerMultiAgentMetadata>;
  membershipIds: string[];
} {
  if (!input.multiAgentRunId && !input.groupId && !input.roleId && !input.fanoutId) return { membershipIds: [] };
  const state = ensureMultiAgentState(run);
  let fanout = input.fanoutId ? requireAgentFanout(run, input.fanoutId) : undefined;
  let group = input.groupId ? requireAgentGroup(run, input.groupId) : undefined;
  if (!group && fanout) group = requireAgentGroup(run, fanout.groupId);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group?.multiAgentRunId || fanout?.multiAgentRunId || "");
  if (!group) throw new Error("Dispatch multi-agent attach requires --multi-agent-group or --multiAgentGroup");
  if (group.multiAgentRunId !== multiAgentRun.id) throw new Error(`Group ${group.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
  const roleIds = unique([...(input.roleId ? [input.roleId] : []), ...(fanout ? fanout.roleIds : [])]);
  if (roleIds.length !== 1) {
    throw new Error(`Dispatch multi-agent attach requires exactly one role for deterministic membership; found ${roleIds.length || 0}`);
  }
  const role = requireAgentRole(run, roleIds[0]);
  if (role.multiAgentRunId !== multiAgentRun.id) throw new Error(`Role ${role.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
  if (!fanout) {
    fanout = createAgentFanout(run, {
      multiAgentRunId: multiAgentRun.id,
      groupId: group.id,
      reason: "dispatch attachment",
      roleIds: [role.id],
      taskIds: input.tasks.map((task) => task.id),
      dispatchIds: [input.dispatchId],
      concurrencyLimit: input.concurrencyLimit,
      sandboxProfileChoices: input.sandboxProfileId ? { dispatch: input.sandboxProfileId } : {}
    });
  }
  if (fanout.multiAgentRunId !== multiAgentRun.id || fanout.groupId !== group.id) {
    throw new Error(`Fanout ${fanout.id} does not match MultiAgentRun ${multiAgentRun.id} and group ${group.id}`);
  }
  const membershipIds: string[] = [];
  for (const task of input.tasks) {
    if (!task.workerId) throw new Error(`Task ${task.id} has no worker id for multi-agent membership`);
    const membership = assignAgentMembership(run, {
      multiAgentRunId: multiAgentRun.id,
      groupId: group.id,
      roleId: role.id,
      taskId: task.id,
      workerId: task.workerId,
      dispatchId: input.dispatchId,
      fanoutId: fanout.id,
      status: "running"
    });
    task.multiAgent = {
      runId: multiAgentRun.id,
      groupId: group.id,
      roleId: role.id,
      membershipId: membership.id,
      fanoutId: fanout.id
    };
    membershipIds.push(membership.id);
  }
  fanout.status = "dispatched";
  fanout.updatedAt = new Date().toISOString();
  fanout.lifecycle.push(lifecycleEvent("planned", "dispatched", "dispatch created"));
  fanout.dispatchIds = unique([...fanout.dispatchIds, input.dispatchId]);
  fanout.taskIds = unique([...fanout.taskIds, ...input.tasks.map((task) => task.id)]);
  fanout.workerIds = unique([...fanout.workerIds, ...input.tasks.map((task) => task.workerId || "").filter(Boolean)]);
  fanout.membershipIds = unique([...fanout.membershipIds, ...membershipIds]);
  if (input.sandboxProfileId) fanout.sandboxProfileChoices.dispatch = input.sandboxProfileId;
  const groupStatusBefore = group.status;
  group.status = "running";
  group.updatedAt = fanout.updatedAt;
  group.lifecycle.push(lifecycleEvent(groupStatusBefore, "running", "dispatch created"));
  multiAgentRun.status = multiAgentRun.status === "planned" || multiAgentRun.status === "forming" ? "running" : multiAgentRun.status;
  touch(multiAgentRun);
  appendMultiAgentNode(run, "agent-fanout", fanout.id, "running", {
    status: fanout.status,
    dispatchIds: fanout.dispatchIds,
    workerIds: fanout.workerIds,
    membershipIds: fanout.membershipIds
  }, [`${run.id}:dispatch:${input.dispatchId}`]);
  recordTrustAuditEvent(run, {
    kind: "multi-agent.fanout.dispatch",
    decision: "validated",
    source: "cw-validated",
    multiAgentRunId: multiAgentRun.id,
    agentRoleId: role.id,
    agentGroupId: group.id,
    agentFanoutId: fanout.id,
    metadata: { dispatchId: input.dispatchId, membershipIds, workerIds: fanout.workerIds }
  });
  persistMultiAgentState(run);
  return {
    multiAgent: {
      runId: multiAgentRun.id,
      groupId: group.id,
      roleId: role.id,
      fanoutId: fanout.id
    },
    membershipIds
  };
}

export function collectAgentFanin(run: WorkflowRun, input: CollectAgentFaninInput): AgentFanin {
  const state = ensureMultiAgentState(run);
  const fanout = input.fanoutId ? requireAgentFanout(run, input.fanoutId) : undefined;
  const group = requireAgentGroup(run, input.groupId || fanout?.groupId || "");
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group.multiAgentRunId);
  if (group.multiAgentRunId !== multiAgentRun.id) throw new Error(`Group ${group.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
  if (fanout && fanout.groupId !== group.id) throw new Error(`Fanout ${fanout.id} does not belong to group ${group.id}`);
  const id = input.id || createId("fanin");
  if (state.fanins.some((record) => record.id === id)) throw new Error(`Duplicate AgentFanin id: ${id}`);
  const requiredRoleIds = unique(input.requiredRoleIds?.length ? input.requiredRoleIds : group.roleIds);
  for (const roleId of requiredRoleIds) requireAgentRole(run, roleId);
  const scopedMemberships = state.memberships.filter((membership) =>
    membership.groupId === group.id && (!fanout || membership.fanoutId === fanout.id)
  );
  const coverage = scopedMemberships.map((membership) => ({
    membershipId: membership.id,
    roleId: membership.roleId,
    taskId: membership.taskId,
    workerId: membership.workerId,
    evidenceRefs: membership.evidenceRefs,
    resultNodeId: membership.resultNodeId,
    verifierNodeId: membership.verifierNodeId,
    complete: isMembershipReported(membership)
  }));
  const missingRoleIds = requiredRoleIds.filter((roleId) => !scopedMemberships.some((membership) => membership.roleId === roleId));
  const missingMembershipIds = scopedMemberships
    .filter((membership) => requiredRoleIds.includes(membership.roleId) && !isMembershipReported(membership))
    .map((membership) => membership.id);
  const blockedReasons = [
    ...missingRoleIds.map((roleId) => `required role ${roleId} has no membership`),
    ...missingMembershipIds.map((membershipId) => `membership ${membershipId} has not reported required evidence`)
  ];
  const verifierReady = blockedReasons.length === 0;
  const status: AgentFaninStatus = verifierReady ? "ready" : "blocked";
  const now = new Date().toISOString();
  const fanin: AgentFanin = {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    id,
    runId: run.id,
    multiAgentRunId: multiAgentRun.id,
    groupId: group.id,
    fanoutId: fanout?.id,
    createdAt: now,
    updatedAt: now,
    status,
    strategy: input.strategy || "required-role-evidence",
    requiredRoleIds,
    reportedMembershipIds: coverage.filter((entry) => entry.complete).map((entry) => entry.membershipId),
    missingMembershipIds,
    missingRoleIds,
    evidenceCoverage: coverage,
    verifierReady,
    blockedReasons,
    lifecycle: [lifecycleEvent(undefined, status, "collected")],
    metadata: compact(input.metadata)
  };
  state.fanins.push(fanin);
  group.faninIds = unique([...group.faninIds, fanin.id]);
  group.status = verifierReady ? "verifying" : "collecting";
  touch(group);
  multiAgentRun.faninIds = unique([...multiAgentRun.faninIds, fanin.id]);
  multiAgentRun.status = verifierReady ? "verifying" : "collecting";
  touch(multiAgentRun);
  appendMultiAgentNode(run, "agent-fanin", fanin.id, verifierReady ? "verified" : "blocked", {
    multiAgentRunId: fanin.multiAgentRunId,
    groupId: fanin.groupId,
    fanoutId: fanin.fanoutId,
    requiredRoleIds,
    missingRoleIds,
    missingMembershipIds,
    verifierReady
  }, [
    `${run.id}:multi-agent:group:${fanin.groupId}`,
    ...(fanin.fanoutId ? [`${run.id}:multi-agent:fanout:${fanin.fanoutId}`] : []),
    ...fanin.evidenceCoverage.map((entry) => `${run.id}:multi-agent:membership:${entry.membershipId}`)
  ]);
  recordTrustAuditEvent(run, {
    kind: "multi-agent.fanin",
    decision: verifierReady ? "validated" : "failed",
    source: "cw-validated",
    multiAgentRunId: fanin.multiAgentRunId,
    agentGroupId: fanin.groupId,
    agentFanoutId: fanin.fanoutId,
    agentFaninId: fanin.id,
    evidenceRefs: fanin.evidenceCoverage.flatMap((entry) => entry.evidenceRefs),
    metadata: {
      verifierReady,
      requiredRoleIds,
      missingRoleIds,
      missingMembershipIds,
      blockedReasons
    }
  });
  persistMultiAgentState(run);
  return fanin;
}

export function recordMultiAgentWorkerOutput(
  run: WorkflowRun,
  input: {
    workerId: string;
    taskId: string;
    resultNodeId?: string;
    verifierNodeId?: string;
    evidence: StateEvidence[];
    artifactPaths?: string[];
  }
): AgentMembership[] {
  const state = ensureMultiAgentState(run);
  const memberships = state.memberships.filter(
    (membership) => membership.workerId === input.workerId && membership.taskId === input.taskId
  );
  if (!memberships.length) return [];
  const evidenceRefs = input.evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean);
  for (const membership of memberships) {
    const before = membership.status;
    membership.status = "reported";
    membership.updatedAt = new Date().toISOString();
    membership.resultNodeId = input.resultNodeId || membership.resultNodeId;
    membership.verifierNodeId = input.verifierNodeId || membership.verifierNodeId;
    membership.evidenceRefs = unique([...membership.evidenceRefs, ...evidenceRefs]);
    membership.artifactPaths = unique([...(membership.artifactPaths || []), ...(input.artifactPaths || [])]);
    membership.lifecycle.push(lifecycleEvent(before, "reported", "worker output accepted"));
    appendMultiAgentNode(run, "agent-membership", membership.id, "completed", {
      resultNodeId: membership.resultNodeId,
      verifierNodeId: membership.verifierNodeId,
      evidenceRefs: membership.evidenceRefs
    }, [membership.resultNodeId, membership.verifierNodeId].filter(Boolean) as string[]);
    recordTrustAuditEvent(run, {
      kind: "multi-agent.membership.output",
      decision: "accepted",
      source: "cw-validated",
      workerId: input.workerId,
      taskId: input.taskId,
      nodeId: input.resultNodeId,
      multiAgentRunId: membership.multiAgentRunId,
      agentRoleId: membership.roleId,
      agentGroupId: membership.groupId,
      agentMembershipId: membership.id,
      agentFanoutId: membership.fanoutId,
      evidence: input.evidence,
      metadata: { verifierNodeId: input.verifierNodeId }
    });
  }
  persistMultiAgentState(run);
  return memberships;
}

export function summarizeMultiAgent(run: WorkflowRun): MultiAgentSummary {
  const state = ensureMultiAgentState(run);
  const blockedReasons: string[] = [];
  for (const fanin of state.fanins) blockedReasons.push(...fanin.blockedReasons.map((reason) => `${fanin.id}: ${reason}`));
  for (const membership of state.memberships) {
    if (membership.status === "failed") blockedReasons.push(`${membership.id}: failed membership`);
  }
  const groupsDetail = state.groups.map((group) => {
    const roleIds = unique([...group.roleIds, ...state.memberships.filter((membership) => membership.groupId === group.id).map((membership) => membership.roleId)]);
    return {
      id: group.id,
      multiAgentRunId: group.multiAgentRunId,
      status: group.status,
      phase: group.phase,
      roles: roleIds.map((roleId) => {
        const role = state.roles.find((entry) => entry.id === roleId);
        const memberships = state.memberships.filter((membership) => membership.groupId === group.id && membership.roleId === roleId);
        const reported = memberships.filter(isMembershipReported).length;
        return {
          roleId,
          requiredEvidence: role?.requiredEvidence.length || 0,
          memberships: memberships.length,
          reported,
          missing: Math.max(0, memberships.length - reported)
        };
      }),
      fanouts: group.fanoutIds,
      fanins: group.faninIds
    };
  });
  return {
    totalRuns: state.runs.length,
    runsByStatus: countBy(state.runs, (record) => record.status),
    roles: state.roles.length,
    groups: state.groups.length,
    memberships: state.memberships.length,
    fanouts: state.fanouts.length,
    fanins: state.fanins.length,
    groupsByStatus: countBy(state.groups, (record) => record.status),
    membershipsByStatus: countBy(state.memberships, (record) => record.status),
    faninsByStatus: countBy(state.fanins, (record) => record.status),
    blockedReasons,
    groupsDetail,
    nextAction: nextMultiAgentAction(run, blockedReasons)
  };
}

export function buildMultiAgentGraph(run: WorkflowRun): MultiAgentGraph {
  const state = ensureMultiAgentState(run);
  const root = multiAgentRoot(run);
  const nodes: MultiAgentGraph["nodes"] = [];
  const edges: MultiAgentGraph["edges"] = [];
  for (const record of state.runs) {
    nodes.push({ id: `${run.id}:multi-agent:${record.id}`, kind: "multi-agent-run", status: record.status, label: record.title || record.id, path: recordPath(run, "runs", record.id) });
    edges.push({ from: `${run.id}:run`, to: `${run.id}:multi-agent:${record.id}` });
    if (record.parentMultiAgentRunId) edges.push({ from: `${run.id}:multi-agent:${record.parentMultiAgentRunId}`, to: `${run.id}:multi-agent:${record.id}`, label: "child" });
  }
  for (const record of state.roles) {
    nodes.push({ id: `${run.id}:multi-agent:role:${record.id}`, kind: "agent-role", status: record.status, label: record.title, path: recordPath(run, "roles", record.id) });
    edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:role:${record.id}` });
  }
  for (const record of state.groups) {
    nodes.push({ id: `${run.id}:multi-agent:group:${record.id}`, kind: "agent-group", status: record.status, label: record.title || record.id, path: recordPath(run, "groups", record.id) });
    edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:group:${record.id}` });
    for (const taskId of record.taskIds) edges.push({ from: `${run.id}:multi-agent:group:${record.id}`, to: `${run.id}:task:${taskId}`, label: "task" });
  }
  for (const record of state.fanouts) {
    nodes.push({ id: `${run.id}:multi-agent:fanout:${record.id}`, kind: "agent-fanout", status: record.status, label: record.reason, path: recordPath(run, "fanouts", record.id) });
    edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:fanout:${record.id}` });
    for (const dispatchId of record.dispatchIds) edges.push({ from: `${run.id}:multi-agent:fanout:${record.id}`, to: `${run.id}:dispatch:${dispatchId}`, label: "dispatch" });
  }
  for (const record of state.memberships) {
    nodes.push({ id: `${run.id}:multi-agent:membership:${record.id}`, kind: "agent-membership", status: record.status, label: `${record.roleId}/${record.taskId}`, path: recordPath(run, "memberships", record.id) });
    edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:membership:${record.id}` });
    edges.push({ from: `${run.id}:multi-agent:role:${record.roleId}`, to: `${run.id}:multi-agent:membership:${record.id}` });
    edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:task:${record.taskId}`, label: "task" });
    if (record.workerId) edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:worker:${record.workerId}`, label: "worker" });
    if (record.resultNodeId) edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: record.resultNodeId, label: "result" });
    if (record.verifierNodeId) edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: record.verifierNodeId, label: "verifier" });
  }
  for (const record of state.fanins) {
    nodes.push({ id: `${run.id}:multi-agent:fanin:${record.id}`, kind: "agent-fanin", status: record.status, label: record.strategy, path: recordPath(run, "fanins", record.id) });
    edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
    if (record.fanoutId) edges.push({ from: `${run.id}:multi-agent:fanout:${record.fanoutId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
    for (const membershipId of record.reportedMembershipIds) edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "reported" });
    for (const membershipId of record.missingMembershipIds) edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "missing" });
  }
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return { nodes, edges: uniqueEdges(edges) };
}

export function getMultiAgentRun(run: WorkflowRun, id: string): MultiAgentRun | undefined {
  return ensureMultiAgentState(run).runs.find((record) => record.id === id);
}

export function getAgentRole(run: WorkflowRun, id: string): AgentRole | undefined {
  return ensureMultiAgentState(run).roles.find((record) => record.id === id);
}

export function getAgentGroup(run: WorkflowRun, id: string): AgentGroup | undefined {
  return ensureMultiAgentState(run).groups.find((record) => record.id === id);
}

export function getAgentMembership(run: WorkflowRun, id: string): AgentMembership | undefined {
  return ensureMultiAgentState(run).memberships.find((record) => record.id === id);
}

export function getAgentFanout(run: WorkflowRun, id: string): AgentFanout | undefined {
  return ensureMultiAgentState(run).fanouts.find((record) => record.id === id);
}

export function getAgentFanin(run: WorkflowRun, id: string): AgentFanin | undefined {
  return ensureMultiAgentState(run).fanins.find((record) => record.id === id);
}

function requireMultiAgentRun(run: WorkflowRun, id: string): MultiAgentRun {
  const record = getMultiAgentRun(run, id);
  if (!record) throw new Error(`Unknown MultiAgentRun id: ${id}`);
  return record;
}

function requireAgentRole(run: WorkflowRun, id: string): AgentRole {
  const record = getAgentRole(run, id);
  if (!record) throw new Error(`Unknown AgentRole id: ${id}`);
  return record;
}

function requireAgentGroup(run: WorkflowRun, id: string): AgentGroup {
  const record = getAgentGroup(run, id);
  if (!record) throw new Error(`Unknown AgentGroup id: ${id}`);
  return record;
}

function requireAgentFanout(run: WorkflowRun, id: string): AgentFanout {
  const record = getAgentFanout(run, id);
  if (!record) throw new Error(`Unknown AgentFanout id: ${id}`);
  return record;
}

function requireRunTask(run: WorkflowRun, id: string): RunTask {
  const task = run.tasks.find((record) => record.id === id);
  if (!task) throw new Error(`Unknown task id for multi-agent record: ${id}`);
  return task;
}

function multiAgentRoot(run: WorkflowRun): string {
  return run.paths.multiAgentDir || path.join(run.paths.runDir, "multi-agent");
}

function recordPath(run: WorkflowRun, kind: string, id: string): string {
  return path.join(multiAgentRoot(run), kind, `${safeFileName(id)}.json`);
}

function writeRecord(run: WorkflowRun, kind: string, record: { id: string }): void {
  writeJson(recordPath(run, kind, record.id), record);
}

function indexRow(record: { id: string; status?: string; updatedAt?: string }): Record<string, unknown> {
  return { id: record.id, status: record.status, updatedAt: record.updatedAt };
}

function appendMultiAgentNode(
  run: WorkflowRun,
  kind: "multi-agent-run" | "agent-role" | "agent-group" | "agent-membership" | "agent-fanout" | "agent-fanin",
  id: string,
  status: StateNodeStatus,
  metadata: Record<string, unknown>,
  parents: string[] = []
): void {
  const nodeId = kind === "multi-agent-run" ? `${run.id}:multi-agent:${id}` : `${run.id}:multi-agent:${kind.replace("agent-", "")}:${id}`;
  appendRunNode(
    run,
    createStateNode({
      id: nodeId,
      kind,
      status,
      loopStage: run.loopStage,
      outputs: metadata,
      artifacts: [{ id: kind, kind: "json", path: recordPath(run, pluralKind(kind), id) }],
      parents,
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata
    })
  );
}

function pluralKind(kind: string): string {
  switch (kind) {
    case "multi-agent-run":
      return "runs";
    case "agent-role":
      return "roles";
    case "agent-group":
      return "groups";
    case "agent-membership":
      return "memberships";
    case "agent-fanout":
      return "fanouts";
    case "agent-fanin":
      return "fanins";
    default:
      return `${kind}s`;
  }
}

function statusToNodeStatus(status: string): StateNodeStatus {
  switch (status) {
    case "completed":
    case "reported":
    case "ready":
      return "completed";
    case "running":
    case "forming":
    case "collecting":
    case "verifying":
    case "assigned":
    case "active":
    case "dispatched":
      return "running";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "cancelled":
    case "rejected":
      return "rejected";
    default:
      return "pending";
  }
}

function assertLifecycleTransition(from: MultiAgentLifecycleStatus, to: MultiAgentLifecycleStatus): void {
  const allowed: Record<MultiAgentLifecycleStatus, MultiAgentLifecycleStatus[]> = {
    planned: ["forming", "running", "failed", "cancelled"],
    forming: ["running", "failed", "cancelled"],
    running: ["collecting", "completed", "failed", "cancelled"],
    collecting: ["verifying", "completed", "failed", "cancelled"],
    verifying: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: []
  };
  if (from === to) return;
  if (!allowed[from].includes(to)) throw new Error(`Invalid MultiAgentRun lifecycle transition: ${from} -> ${to}`);
}

function lifecycleEvent(
  from: string | undefined,
  to: string,
  reason?: string,
  actor = "cw",
  metadata?: Record<string, unknown>
): MultiAgentLifecycleEvent {
  return {
    at: new Date().toISOString(),
    from,
    to,
    actor,
    reason,
    metadata: compact(metadata)
  };
}

function attachWorkerMetadata(run: WorkflowRun, membership: AgentMembership): void {
  const workers = run.workers || [];
  const index = workers.findIndex((worker) => worker.id === membership.workerId);
  if (index < 0) return;
  const worker = workers[index];
  const multiAgent: WorkerMultiAgentMetadata = {
    runId: membership.multiAgentRunId,
    groupId: membership.groupId,
    roleId: membership.roleId,
    membershipId: membership.id,
    fanoutId: membership.fanoutId
  };
  const updated = {
    ...worker,
    updatedAt: new Date().toISOString(),
    multiAgent,
    metadata: {
      ...(worker.metadata || {}),
      multiAgent
    }
  };
  run.workers = workers.map((candidate) => (candidate.id === worker.id ? updated : candidate));
}

function isMembershipReported(membership: AgentMembership): boolean {
  return (membership.status === "reported" || membership.status === "verified") && membership.evidenceRefs.length > 0;
}

function nextMultiAgentAction(run: WorkflowRun, blockedReasons: string[]): string | undefined {
  const state = ensureMultiAgentState(run);
  if (!state.runs.length) return `node scripts/cw.js multi-agent run ${run.id} --id <multi-agent-run-id>`;
  if (blockedReasons.length) return `node scripts/cw.js multi-agent fanin ${run.id} --group <group-id> --fanout <fanout-id>`;
  const running = state.memberships.find((membership) => membership.status === "running");
  if (running?.workerId) return `node scripts/cw.js worker manifest ${run.id} ${running.workerId}`;
  const groupWithoutFanin = state.groups.find((group) => group.membershipIds.length && !group.faninIds.length);
  if (groupWithoutFanin) return `node scripts/cw.js multi-agent fanin ${run.id} --group ${groupWithoutFanin.id}`;
  return undefined;
}

function touch<T extends { updatedAt: string }>(record: T): T {
  record.updatedAt = new Date().toISOString();
  return record;
}

function createId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function compact(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function uniqueEdges(edges: MultiAgentGraph["edges"]): MultiAgentGraph["edges"] {
  const seen = new Set<string>();
  const result: MultiAgentGraph["edges"] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}
