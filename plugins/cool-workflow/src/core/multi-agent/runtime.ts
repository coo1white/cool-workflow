// core/multi-agent/runtime.ts — multi-agent record kernel: run/role/group/
// membership/fanout/fanin create+transition.
//
// MILESTONE 9. Byte-exact port of the DECISION half of the old build's
// src/multi-agent.ts + src/multi-agent/helpers.ts + src/multi-agent/
// ids.ts + src/multi-agent/graph.ts: record shape construction, the
// lifecycle transition table, the fanin coverage/blocked-reason math, id
// minting, and the provenance graph. Every function here is pure — it
// takes a WorkflowRun (mutated in place, matching the old build's own
// in-memory mutation style) plus a `now` clock value and returns the new
// or updated record. Persistence (writeJson, appendRunNode's disk half,
// recordTrustAuditEvent) is the caller's job — see
// shell/multi-agent-io.ts, which wires this pure kernel to real IO,
// exactly the way shell/dispatch.ts wires core/pipeline/dispatch.ts.
//
// BYTE-COMPAT ITEM 3 [load-bearing, HIGH priority]: `unique` in this file
// DROPS falsy values AND SORTS — this is the kernel-side sorting variant
// (byte-identical to core/state/state-explosion/helpers.ts's `unique`,
// but kept as its own local copy here because the old build's
// multi-agent/helpers.ts kept its own copy too — see that file's header).
// core/multi-agent/topology.ts, candidate-scoring.ts, and the host/step
// layer have their OWN separate `unique` that does NOT sort (insertion-
// order only) — never merge the two. See uniquedual-role-vs-candidate-
// order.case.js and v2/PLAN.md byte-compat item 3.
//
// Evidence: SPEC/multi-agent.md sections A ("Multi-agent kernel"), the
// "Kernel error strings" and "Fanin blocked-reason strings" Exact-outputs
// blocks, invariants 1-4/11; plugins/cool-workflow/src/multi-agent.ts,
// src/multi-agent/{helpers,ids,paths,graph}.ts (byte-exact source).

import {
  RunTask,
  StateEvidence,
  StateNodeStatus,
  WorkflowRun,
} from "../state/types";

export const MULTI_AGENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared primitives (byte-exact to multi-agent/helpers.ts + ids.ts)
// ---------------------------------------------------------------------------

/** Deterministic record id: `${prefix}-${4-digit zero-padded seq}`. Pure
 *  function of its arguments — no Date, no random. */
export function createId(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** DROPS falsy values, then SORTS (default string sort). Kernel-side
 *  sorting `unique` — see file header byte-compat note. Never merge with
 *  topology.ts/candidate-scoring.ts's insertion-order sibling. */
export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function compact(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function touch<T extends { updatedAt: string }>(record: T, now: string): T {
  record.updatedAt = now;
  return record;
}

export function pluralKind(kind: string): string {
  switch (kind) {
    case "multi-agent-run": return "runs";
    case "agent-role": return "roles";
    case "agent-group": return "groups";
    case "agent-membership": return "memberships";
    case "agent-fanout": return "fanouts";
    case "agent-fanin": return "fanins";
    default: return `${kind}s`;
  }
}

/** Status -> StateNodeStatus, kernel side (default `pending`). Kept
 *  distinct from coordinator/classify.ts's own table (default
 *  `completed`) per v2/PLAN.md byte-compat / rebuild risk 7 — collapsing
 *  the two tables changes graph output and eval dependency_parity. */
export function statusToNodeStatus(status: string): StateNodeStatus {
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

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

type GraphEdge = { from: string; to: string; label?: string };

export function uniqueEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

export function indexRow(record: { id: string; status?: string; updatedAt?: string }): Record<string, unknown> {
  return { id: record.id, status: record.status, updatedAt: record.updatedAt };
}

/** Byte-exact "safe file name" charset used elsewhere in core/shell:
 *  chars outside `[a-zA-Z0-9_.:-]` become `_`. Kept as a local copy since
 *  this pure module cannot import shell/fs-atomic.ts's `safeFileName`. */
function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}

export function assertNoRecordPathCollisions(label: string, records: Array<{ id: string }>): void {
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

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

export type MultiAgentLifecycleStatus = "planned" | "forming" | "running" | "collecting" | "verifying" | "completed" | "failed" | "cancelled";
export type AgentGroupStatus = "forming" | "running" | "collecting" | "verifying" | "completed" | "failed" | "cancelled";
export type AgentMembershipStatus = "assigned" | "running" | "reported" | "verified" | "failed" | "rejected";
export type AgentFanoutStatus = "planned" | "dispatched" | "completed" | "failed" | "cancelled";
export type AgentFaninStatus = "ready" | "blocked" | "completed" | "failed";

export interface MultiAgentLifecycleEvent {
  at: string;
  from?: string;
  to: string;
  actor: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type MultiAgentPolicyWriteOperation = "message" | "context" | "artifact" | "snapshot" | "topic" | "coordinator-decision";
export type MultiAgentPolicyCandidateOperation = "register" | "score" | "select";
export type MultiAgentPolicyJudgeOperation = "verdict" | "rationale" | "panel-decision";
export type MultiAgentPolicyOperation = MultiAgentPolicyWriteOperation | `candidate.${MultiAgentPolicyCandidateOperation}` | `judge.${MultiAgentPolicyJudgeOperation}`;

export interface MultiAgentPolicy {
  schemaVersion: 1;
  id: string;
  policyRef: string;
  subjectKind: "multi-agent-run" | "role" | "group" | "membership" | "fanout" | "fanin";
  subjectId: string;
  allowedBlackboardTopicIds: string[];
  allowedWriteOperations: MultiAgentPolicyWriteOperation[];
  allowedCandidateOperations: MultiAgentPolicyCandidateOperation[];
  allowedJudgeOperations: MultiAgentPolicyJudgeOperation[];
  sandboxProfileHints: string[];
  requiredEvidenceRefs: string[];
  requiredEvidenceFor?: Record<string, string[]>;
  deniedOperations: Array<{ operation: string; reason: string }>;
  metadata?: Record<string, unknown>;
}

export interface MultiAgentRun {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: MultiAgentLifecycleStatus;
  title: string;
  objective?: string;
  parentMultiAgentRunId?: string;
  childMultiAgentRunIds: string[];
  roleIds: string[];
  groupIds: string[];
  fanoutIds: string[];
  faninIds: string[];
  blackboardId?: string;
  topicIds: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  links: { workflowRunId: string; phase?: string; phaseId?: string; blackboardId?: string; blackboardTopicIds: string[] };
  policy: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentRole {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "active" | "completed" | "cancelled";
  title: string;
  responsibilities: string[];
  requiredEvidence: string[];
  sandboxProfileHints: string[];
  expectedArtifacts: string[];
  faninObligations: string[];
  blackboardId?: string;
  topicIds: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  parentRoleId?: string;
  childRoleIds: string[];
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentGroup {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  createdAt: string;
  updatedAt: string;
  status: AgentGroupStatus;
  title: string;
  phase?: string;
  phaseId?: string;
  taskIds: string[];
  roleIds: string[];
  membershipIds: string[];
  workerIds: string[];
  fanoutIds: string[];
  faninIds: string[];
  blackboardId?: string;
  topicIds: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  parentGroupId?: string;
  childGroupIds: string[];
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentMembership {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  groupId: string;
  roleId: string;
  taskId: string;
  workerId?: string;
  dispatchId?: string;
  fanoutId?: string;
  createdAt: string;
  updatedAt: string;
  status: AgentMembershipStatus;
  lifecycle: MultiAgentLifecycleEvent[];
  evidenceRefs: string[];
  artifactPaths: string[];
  blackboardId?: string;
  topicIds: string[];
  blackboardMessageIds: string[];
  blackboardArtifactRefIds: string[];
  resultNodeId?: string;
  verifierNodeId?: string;
  policy?: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentFanout {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  status: AgentFanoutStatus;
  reason: string;
  roleIds: string[];
  taskIds: string[];
  workerIds: string[];
  membershipIds: string[];
  dispatchIds: string[];
  concurrencyLimit?: number;
  sandboxProfileChoices: Record<string, string>;
  expectedReturnShape: string;
  blackboardId?: string;
  topicIds: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  policy: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface AgentFaninEvidenceCoverage {
  membershipId: string;
  roleId: string;
  taskId: string;
  workerId?: string;
  evidenceRefs: string[];
  blackboardMessageIds: string[];
  blackboardArtifactRefIds: string[];
  resultNodeId?: string;
  verifierNodeId?: string;
  complete: boolean;
}

export interface AgentFanin {
  schemaVersion: 1;
  id: string;
  runId: string;
  multiAgentRunId: string;
  groupId: string;
  fanoutId?: string;
  createdAt: string;
  updatedAt: string;
  status: AgentFaninStatus;
  strategy: string;
  requiredRoleIds: string[];
  reportedMembershipIds: string[];
  missingMembershipIds: string[];
  missingRoleIds: string[];
  evidenceCoverage: AgentFaninEvidenceCoverage[];
  verifierReady: boolean;
  blockedReasons: string[];
  blackboardId?: string;
  topicIds: string[];
  blackboardArtifactRefIds: string[];
  blackboardMessageIds: string[];
  lifecycle: MultiAgentLifecycleEvent[];
  policy: MultiAgentPolicy;
  metadata?: Record<string, unknown>;
}

export interface MultiAgentState {
  schemaVersion: 1;
  runs: MultiAgentRun[];
  roles: AgentRole[];
  groups: AgentGroup[];
  memberships: AgentMembership[];
  fanouts: AgentFanout[];
  fanins: AgentFanin[];
}

export interface MultiAgentGraph {
  nodes: Array<{ id: string; kind: string; status: string; label: string; path?: string }>;
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// State access
// ---------------------------------------------------------------------------

/** Fills `run.multiAgent` with empty arrays if absent (pure — no fs; the
 *  directory-creation half lives in shell/multi-agent-io.ts's
 *  ensureMultiAgentState). */
export function ensureMultiAgentState(run: WorkflowRun): MultiAgentState {
  const existing = run.multiAgent as unknown as Partial<MultiAgentState> | undefined;
  const state: MultiAgentState = {
    schemaVersion: MULTI_AGENT_SCHEMA_VERSION,
    runs: (existing?.runs as MultiAgentRun[]) || [],
    roles: (existing?.roles as AgentRole[]) || [],
    groups: (existing?.groups as AgentGroup[]) || [],
    memberships: (existing?.memberships as AgentMembership[]) || [],
    fanouts: (existing?.fanouts as AgentFanout[]) || [],
    fanins: (existing?.fanins as AgentFanin[]) || [],
  };
  run.multiAgent = state as unknown as WorkflowRun["multiAgent"];
  return state;
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

export function requireMultiAgentRun(run: WorkflowRun, id: string): MultiAgentRun {
  const record = getMultiAgentRun(run, id);
  if (!record) throw new Error(`Unknown MultiAgentRun id: ${id}`);
  return record;
}
export function requireAgentRole(run: WorkflowRun, id: string): AgentRole {
  const record = getAgentRole(run, id);
  if (!record) throw new Error(`Unknown AgentRole id: ${id}`);
  return record;
}
export function requireAgentGroup(run: WorkflowRun, id: string): AgentGroup {
  const record = getAgentGroup(run, id);
  if (!record) throw new Error(`Unknown AgentGroup id: ${id}`);
  return record;
}
export function requireAgentFanout(run: WorkflowRun, id: string): AgentFanout {
  const record = getAgentFanout(run, id);
  if (!record) throw new Error(`Unknown AgentFanout id: ${id}`);
  return record;
}
export function requireRunTask(run: WorkflowRun, id: string): RunTask {
  const task = run.tasks.find((record) => record.id === id);
  if (!task) throw new Error(`Unknown task id for multi-agent record: ${id}`);
  return task;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** `planned -> forming|running|failed|cancelled`; `forming ->
 *  running|failed|cancelled`; `running -> collecting|completed|failed|
 *  cancelled`; `collecting -> verifying|completed|failed|cancelled`;
 *  `verifying -> completed|failed|cancelled`; terminal states have no
 *  onward transitions. A same-status transition is always legal
 *  (no-op check). */
export function assertLifecycleTransition(from: MultiAgentLifecycleStatus, to: MultiAgentLifecycleStatus): void {
  const allowed: Record<MultiAgentLifecycleStatus, MultiAgentLifecycleStatus[]> = {
    planned: ["forming", "running", "failed", "cancelled"],
    forming: ["running", "failed", "cancelled"],
    running: ["collecting", "completed", "failed", "cancelled"],
    collecting: ["verifying", "completed", "failed", "cancelled"],
    verifying: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };
  if (from === to) return;
  if (!allowed[from].includes(to)) throw new Error(`Invalid MultiAgentRun lifecycle transition: ${from} -> ${to}`);
}

export function lifecycleEvent(from: string | undefined, to: string, reason: string | undefined, actor: string | undefined, metadata: Record<string, unknown> | undefined, now: string): MultiAgentLifecycleEvent {
  return { at: now, from, to, actor: actor || "cw", reason, metadata: compact(metadata) };
}

/** A membership counts as reported only when status is reported/verified
 *  AND it carries at least one evidence ref. */
export function isMembershipReported(membership: AgentMembership): boolean {
  return (membership.status === "reported" || membership.status === "verified") && membership.evidenceRefs.length > 0;
}

// ---------------------------------------------------------------------------
// Record construction (pure — caller supplies `now`; node/audit/persist
// side effects happen in shell/multi-agent-io.ts)
// ---------------------------------------------------------------------------

export interface CreateMultiAgentRunInput {
  id?: string;
  title?: string;
  objective?: string;
  parentMultiAgentRunId?: string;
  status?: MultiAgentLifecycleStatus;
  phase?: string;
  phaseId?: string;
  blackboardId?: string;
  topicIds?: string[];
  metadata?: Record<string, unknown>;
}

export function createMultiAgentRun(run: WorkflowRun, input: CreateMultiAgentRunInput, now: string): MultiAgentRun {
  const state = ensureMultiAgentState(run);
  const id = input.id || createId("mar", state.runs.length + 1);
  if (state.runs.some((record) => record.id === id)) throw new Error(`Duplicate MultiAgentRun id: ${id}`);
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
    blackboardId: input.blackboardId,
    topicIds: unique(input.topicIds || []),
    lifecycle: [lifecycleEvent(undefined, status, "created", undefined, undefined, now)],
    links: {
      workflowRunId: run.id,
      phase: input.phase,
      phaseId: input.phaseId,
      blackboardId: input.blackboardId,
      blackboardTopicIds: unique(input.topicIds || []),
    },
    policy: {
      schemaVersion: 1,
      id: `${id}-policy`,
      policyRef: `multiAgent.runs.${id}.policy`,
      subjectKind: "multi-agent-run",
      subjectId: id,
      allowedBlackboardTopicIds: unique(input.topicIds || ["*"]),
      allowedWriteOperations: ["message", "context", "artifact", "snapshot", "topic", "coordinator-decision"],
      allowedCandidateOperations: ["register", "score", "select"],
      allowedJudgeOperations: ["verdict", "rationale", "panel-decision"],
      sandboxProfileHints: [],
      requiredEvidenceRefs: [],
      deniedOperations: [],
      metadata: { title: input.title },
    },
    metadata: compact(input.metadata),
  };
  if (record.parentMultiAgentRunId) {
    const parent = requireMultiAgentRun(run, record.parentMultiAgentRunId);
    parent.childMultiAgentRunIds = unique([...parent.childMultiAgentRunIds, record.id]);
    touch(parent, now);
  }
  state.runs.push(record);
  return record;
}

export function transitionMultiAgentRun(
  run: WorkflowRun,
  multiAgentRunId: string,
  status: MultiAgentLifecycleStatus,
  options: { reason?: string; actor?: string; metadata?: Record<string, unknown> },
  now: string
): MultiAgentRun {
  ensureMultiAgentState(run);
  const record = requireMultiAgentRun(run, multiAgentRunId);
  assertLifecycleTransition(record.status, status);
  if (status === "completed") assertMultiAgentRunCompletionReady(run, record);
  const before = record.status;
  record.status = status;
  record.updatedAt = now;
  record.lifecycle.push(lifecycleEvent(before, status, options.reason, options.actor, options.metadata, now));
  if (status === "completed") completeOwnedMultiAgentRecords(run, record, options.reason, now);
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
  if (blocked.length) throw new Error(`Cannot complete MultiAgentRun ${multiAgentRun.id}: ${blocked.join("; ")}`);
}

function completeOwnedMultiAgentRecords(run: WorkflowRun, multiAgentRun: MultiAgentRun, reason: string | undefined, now: string): void {
  const state = ensureMultiAgentState(run);
  for (const role of state.roles.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (role.status === "completed" || role.status === "cancelled") continue;
    const before = role.status;
    role.status = "completed";
    role.updatedAt = now;
    role.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
  }
  for (const group of state.groups.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (group.status === "completed" || group.status === "failed" || group.status === "cancelled") continue;
    const before = group.status;
    group.status = "completed";
    group.updatedAt = now;
    group.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
  }
  for (const fanout of state.fanouts.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (fanout.status === "completed" || fanout.status === "failed" || fanout.status === "cancelled") continue;
    const before = fanout.status;
    fanout.status = "completed";
    fanout.updatedAt = now;
    fanout.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
  }
  for (const fanin of state.fanins.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
    if (fanin.status === "completed" || fanin.status === "failed") continue;
    const before = fanin.status;
    fanin.status = "completed";
    fanin.updatedAt = now;
    fanin.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
  }
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
  blackboardId?: string;
  topicIds?: string[];
  metadata?: Record<string, unknown>;
}

/** `policyFor` is injected (core/multi-agent/trust-policy.ts's
 *  `policyForRole`) so this file never has to import that module's
 *  cross-cutting policy shape directly at the top level — kept as a
 *  parameter purely to avoid an import cycle risk, not for genericity. */
export function createAgentRole(run: WorkflowRun, input: CreateAgentRoleInput, now: string, policyFor: (role: AgentRole) => MultiAgentPolicy): AgentRole {
  const state = ensureMultiAgentState(run);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
  const id = input.id || createId("role", state.roles.length + 1);
  if (state.roles.some((record) => record.id === id)) throw new Error(`Duplicate AgentRole id: ${id}`);
  if (input.parentRoleId) requireAgentRole(run, input.parentRoleId);
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
    blackboardId: input.blackboardId || multiAgentRun.blackboardId,
    topicIds: unique([...(multiAgentRun.topicIds || []), ...(input.topicIds || [])]),
    lifecycle: [lifecycleEvent(undefined, "planned", "created", undefined, undefined, now)],
    parentRoleId: input.parentRoleId,
    childRoleIds: [],
    policy: undefined,
    metadata: compact(input.metadata),
  };
  role.policy = policyFor(role);
  if (role.parentRoleId) {
    const parent = requireAgentRole(run, role.parentRoleId);
    parent.childRoleIds = unique([...parent.childRoleIds, role.id]);
    touch(parent, now);
  }
  state.roles.push(role);
  multiAgentRun.roleIds = unique([...multiAgentRun.roleIds, role.id]);
  touch(multiAgentRun, now);
  return role;
}

export interface CreateAgentGroupInput {
  id?: string;
  multiAgentRunId: string;
  title?: string;
  phase?: string;
  phaseId?: string;
  taskIds?: string[];
  parentGroupId?: string;
  blackboardId?: string;
  topicIds?: string[];
  metadata?: Record<string, unknown>;
}

export function createAgentGroup(run: WorkflowRun, input: CreateAgentGroupInput, now: string, policyFor: (group: AgentGroup) => MultiAgentPolicy): AgentGroup {
  const state = ensureMultiAgentState(run);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
  const id = input.id || createId("group", state.groups.length + 1);
  if (state.groups.some((record) => record.id === id)) throw new Error(`Duplicate AgentGroup id: ${id}`);
  if (input.parentGroupId) requireAgentGroup(run, input.parentGroupId);
  for (const taskId of input.taskIds || []) requireRunTask(run, taskId);
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
    blackboardId: input.blackboardId || multiAgentRun.blackboardId,
    topicIds: unique([...(multiAgentRun.topicIds || []), ...(input.topicIds || [])]),
    lifecycle: [lifecycleEvent(undefined, "forming", "created", undefined, undefined, now)],
    parentGroupId: input.parentGroupId,
    childGroupIds: [],
    policy: undefined,
    metadata: compact(input.metadata),
  };
  group.policy = policyFor(group);
  if (group.parentGroupId) {
    const parent = requireAgentGroup(run, group.parentGroupId);
    parent.childGroupIds = unique([...parent.childGroupIds, group.id]);
    touch(parent, now);
  }
  state.groups.push(group);
  multiAgentRun.groupIds = unique([...multiAgentRun.groupIds, group.id]);
  touch(multiAgentRun, now);
  return group;
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
  blackboardId?: string;
  topicIds?: string[];
  metadata?: Record<string, unknown>;
}

export function assignAgentMembership(
  run: WorkflowRun,
  input: AssignAgentMembershipInput,
  now: string,
  policyForMembership: (membership: AgentMembership, role?: AgentRole) => MultiAgentPolicy,
  workerExists: (workerId: string) => boolean
): AgentMembership {
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
  if (input.workerId && !workerExists(input.workerId)) {
    throw new Error(`Unknown worker id for membership: ${input.workerId}`);
  }
  const duplicate = state.memberships.find(
    (membership) =>
      membership.groupId === group.id &&
      membership.roleId === role.id &&
      membership.taskId === task.id &&
      (input.workerId ? membership.workerId === input.workerId : !membership.workerId)
  );
  if (duplicate) {
    throw new Error(`Duplicate AgentMembership for group=${group.id}, role=${role.id}, task=${task.id}, worker=${input.workerId || "none"}`);
  }
  const id = input.id || createId("membership", state.memberships.length + 1);
  if (state.memberships.some((record) => record.id === id)) throw new Error(`Duplicate AgentMembership id: ${id}`);
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
    lifecycle: [lifecycleEvent(undefined, status, "assigned", undefined, undefined, now)],
    evidenceRefs: [],
    artifactPaths: [],
    blackboardId: input.blackboardId || group.blackboardId || role.blackboardId,
    topicIds: unique([...(group.topicIds || []), ...(role.topicIds || []), ...(input.topicIds || [])]),
    blackboardMessageIds: [],
    blackboardArtifactRefIds: [],
    policy: undefined,
    metadata: compact(input.metadata),
  };
  membership.policy = policyForMembership(membership, role);
  state.memberships.push(membership);
  group.membershipIds = unique([...group.membershipIds, membership.id]);
  group.roleIds = unique([...group.roleIds, role.id]);
  group.taskIds = unique([...group.taskIds, task.id]);
  if (membership.workerId) group.workerIds = unique([...group.workerIds, membership.workerId]);
  touch(group, now);
  const roleStatusBefore = role.status;
  role.status = "active";
  role.updatedAt = now;
  role.lifecycle.push(lifecycleEvent(roleStatusBefore, "active", "membership assigned", undefined, undefined, now));
  return membership;
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
  blackboardId?: string;
  topicIds?: string[];
  metadata?: Record<string, unknown>;
}

export function createAgentFanout(run: WorkflowRun, input: CreateAgentFanoutInput, now: string): AgentFanout {
  const state = ensureMultiAgentState(run);
  const group = requireAgentGroup(run, input.groupId);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group.multiAgentRunId);
  if (group.multiAgentRunId !== multiAgentRun.id) throw new Error(`AgentGroup ${group.id} does not belong to ${multiAgentRun.id}`);
  const id = input.id || createId("fanout", state.fanouts.length + 1);
  if (state.fanouts.some((record) => record.id === id)) throw new Error(`Duplicate AgentFanout id: ${id}`);
  for (const roleId of input.roleIds || []) requireAgentRole(run, roleId);
  for (const taskId of input.taskIds || []) requireRunTask(run, taskId);
  const roleIds = unique(input.roleIds || group.roleIds);
  const taskIds = unique(input.taskIds || group.taskIds);
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
    roleIds,
    taskIds,
    workerIds: unique(input.workerIds || []),
    membershipIds: unique(input.membershipIds || []),
    dispatchIds: unique(input.dispatchIds || []),
    concurrencyLimit: input.concurrencyLimit,
    sandboxProfileChoices: input.sandboxProfileChoices || {},
    expectedReturnShape: input.expectedReturnShape || "Each member writes a Markdown result with a cw:result JSON fence containing summary, findings, and evidence.",
    blackboardId: input.blackboardId || group.blackboardId || multiAgentRun.blackboardId,
    topicIds: unique([...(group.topicIds || []), ...(multiAgentRun.topicIds || []), ...(input.topicIds || [])]),
    lifecycle: [lifecycleEvent(undefined, "planned", "created", undefined, undefined, now)],
    policy: {
      schemaVersion: 1,
      id: `${id}-policy`,
      policyRef: `multiAgent.fanouts.${id}.policy`,
      subjectKind: "fanout",
      subjectId: id,
      allowedBlackboardTopicIds: unique([...(group.topicIds || []), ...(multiAgentRun.topicIds || []), ...(input.topicIds || [])]),
      allowedWriteOperations: ["message", "context", "artifact"],
      allowedCandidateOperations: ["register"],
      allowedJudgeOperations: [],
      sandboxProfileHints: unique(Object.values(input.sandboxProfileChoices || {}).map(String)),
      requiredEvidenceRefs: [],
      deniedOperations: [],
      metadata: { reason: input.reason },
    },
    metadata: compact(input.metadata),
  };
  state.fanouts.push(fanout);
  group.fanoutIds = unique([...group.fanoutIds, fanout.id]);
  group.roleIds = unique([...group.roleIds, ...fanout.roleIds]);
  group.taskIds = unique([...group.taskIds, ...fanout.taskIds]);
  touch(group, now);
  multiAgentRun.fanoutIds = unique([...multiAgentRun.fanoutIds, fanout.id]);
  touch(multiAgentRun, now);
  return fanout;
}

export interface CollectAgentFaninInput {
  id?: string;
  multiAgentRunId?: string;
  groupId?: string;
  fanoutId?: string;
  requiredRoleIds?: string[];
  strategy?: string;
  blackboardId?: string;
  topicIds?: string[];
  metadata?: Record<string, unknown>;
}

export function collectAgentFanin(run: WorkflowRun, input: CollectAgentFaninInput, now: string): AgentFanin {
  const state = ensureMultiAgentState(run);
  const fanout = input.fanoutId ? requireAgentFanout(run, input.fanoutId) : undefined;
  const group = requireAgentGroup(run, input.groupId || fanout?.groupId || "");
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group.multiAgentRunId);
  if (group.multiAgentRunId !== multiAgentRun.id) throw new Error(`Group ${group.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
  if (fanout && fanout.groupId !== group.id) throw new Error(`Fanout ${fanout.id} does not belong to group ${group.id}`);
  const id = input.id || createId("fanin", state.fanins.length + 1);
  if (state.fanins.some((record) => record.id === id)) throw new Error(`Duplicate AgentFanin id: ${id}`);
  const requiredRoleIds = unique(input.requiredRoleIds?.length ? input.requiredRoleIds : group.roleIds);
  for (const roleId of requiredRoleIds) requireAgentRole(run, roleId);
  const scopedMemberships = state.memberships.filter((membership) => membership.groupId === group.id && (!fanout || membership.fanoutId === fanout.id));
  const coverage: AgentFaninEvidenceCoverage[] = scopedMemberships.map((membership) => ({
    membershipId: membership.id,
    roleId: membership.roleId,
    taskId: membership.taskId,
    workerId: membership.workerId,
    evidenceRefs: membership.evidenceRefs,
    blackboardMessageIds: membership.blackboardMessageIds || [],
    blackboardArtifactRefIds: membership.blackboardArtifactRefIds || [],
    resultNodeId: membership.resultNodeId,
    verifierNodeId: membership.verifierNodeId,
    complete: isMembershipReported(membership),
  }));
  const missingRoleIds = requiredRoleIds.filter((roleId) => !scopedMemberships.some((membership) => membership.roleId === roleId));
  const missingMembershipIds = scopedMemberships
    .filter((membership) => requiredRoleIds.includes(membership.roleId) && !isMembershipReported(membership))
    .map((membership) => membership.id);
  const blockedReasons = [
    ...missingRoleIds.map((roleId) => `required role ${roleId} has no membership`),
    ...missingMembershipIds.map((membershipId) => `membership ${membershipId} has not reported required evidence`),
  ];
  const requiredMemberships = scopedMemberships.filter((membership) => requiredRoleIds.includes(membership.roleId));
  const blackboardId = input.blackboardId || group.blackboardId || multiAgentRun.blackboardId;
  const requiresBlackboardEvidence = Boolean(blackboardId || requiredMemberships.some((membership) => membership.blackboardId));
  if (requiresBlackboardEvidence) {
    for (const membership of requiredMemberships) {
      const indexedEvidence = [...(membership.blackboardArtifactRefIds || []), ...(membership.blackboardMessageIds || [])];
      if (!indexedEvidence.length) blockedReasons.push(`membership ${membership.id} has no indexed blackboard evidence`);
    }
  }
  const verifierReady = blockedReasons.length === 0;
  const status: AgentFaninStatus = verifierReady ? "ready" : "blocked";
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
    blackboardId,
    topicIds: unique([...(group.topicIds || []), ...(multiAgentRun.topicIds || []), ...(input.topicIds || [])]),
    blackboardArtifactRefIds: unique(coverage.flatMap((entry) => entry.blackboardArtifactRefIds || [])),
    blackboardMessageIds: unique(coverage.flatMap((entry) => entry.blackboardMessageIds || [])),
    lifecycle: [lifecycleEvent(undefined, status, "collected", undefined, undefined, now)],
    policy: {
      schemaVersion: 1,
      id: `${id}-policy`,
      policyRef: `multiAgent.fanins.${id}.policy`,
      subjectKind: "fanin",
      subjectId: id,
      allowedBlackboardTopicIds: unique([...(group.topicIds || []), ...(multiAgentRun.topicIds || []), ...(input.topicIds || [])]),
      allowedWriteOperations: ["message", "context", "artifact", "snapshot", "coordinator-decision"],
      allowedCandidateOperations: verifierReady ? ["register", "score", "select"] : [],
      allowedJudgeOperations: verifierReady ? ["panel-decision", "rationale"] : [],
      sandboxProfileHints: [],
      requiredEvidenceRefs: unique(coverage.flatMap((entry) => entry.evidenceRefs)),
      deniedOperations: verifierReady ? [] : blockedReasons.map((reason) => ({ operation: "candidate.select", reason })),
      metadata: { verifierReady, strategy: input.strategy || "required-role-evidence" },
    },
    metadata: compact(input.metadata),
  };
  state.fanins.push(fanin);
  group.faninIds = unique([...group.faninIds, fanin.id]);
  group.status = verifierReady ? "verifying" : "collecting";
  touch(group, now);
  multiAgentRun.faninIds = unique([...multiAgentRun.faninIds, fanin.id]);
  multiAgentRun.status = verifierReady ? "verifying" : "collecting";
  touch(multiAgentRun, now);
  return fanin;
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

export interface AttachDispatchToMultiAgentResult {
  multiAgent?: { runId: string; groupId: string; roleId: string; fanoutId: string };
  membershipIds: string[];
}

/** `attachDispatchToMultiAgent` — ties a dispatch to multi-agent state.
 *  Silent no-op (`{membershipIds: []}`) when NONE of the four ids are
 *  given. `policyForMembership` and `workerExists` are injected the same
 *  way `assignAgentMembership` needs them. */
export function attachDispatchToMultiAgent(
  run: WorkflowRun,
  input: AttachDispatchToMultiAgentInput,
  now: string,
  policyForMembership: (membership: AgentMembership, role?: AgentRole) => MultiAgentPolicy,
  workerExists: (workerId: string) => boolean
): AttachDispatchToMultiAgentResult {
  if (!input.multiAgentRunId && !input.groupId && !input.roleId && !input.fanoutId) return { membershipIds: [] };
  ensureMultiAgentState(run);
  let fanout = input.fanoutId ? requireAgentFanout(run, input.fanoutId) : undefined;
  let group = input.groupId ? requireAgentGroup(run, input.groupId) : undefined;
  if (!group && fanout) group = requireAgentGroup(run, fanout.groupId);
  const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group?.multiAgentRunId || fanout?.multiAgentRunId || "");
  if (!group) throw new Error("Dispatch multi-agent attach requires --multi-agent-group or --multiAgentGroup");
  if (group.multiAgentRunId !== multiAgentRun.id) throw new Error(`Group ${group.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
  const roleIds = input.roleId ? [input.roleId] : unique([...(fanout ? fanout.roleIds : [])]);
  if (roleIds.length !== 1) {
    throw new Error(`Dispatch multi-agent attach requires exactly one role for deterministic membership; found ${roleIds.length || 0}`);
  }
  const role = requireAgentRole(run, roleIds[0]);
  if (role.multiAgentRunId !== multiAgentRun.id) throw new Error(`Role ${role.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
  if (!fanout) {
    fanout = createAgentFanout(
      run,
      {
        multiAgentRunId: multiAgentRun.id,
        groupId: group.id,
        reason: "dispatch attachment",
        roleIds: [role.id],
        taskIds: input.tasks.map((task) => task.id),
        dispatchIds: [input.dispatchId],
        concurrencyLimit: input.concurrencyLimit,
        sandboxProfileChoices: input.sandboxProfileId ? { dispatch: input.sandboxProfileId } : {},
      },
      now
    );
  }
  if (fanout.multiAgentRunId !== multiAgentRun.id || fanout.groupId !== group.id) {
    throw new Error(`Fanout ${fanout.id} does not match MultiAgentRun ${multiAgentRun.id} and group ${group.id}`);
  }
  const membershipIds: string[] = [];
  for (const task of input.tasks) {
    if (!task.workerId) throw new Error(`Task ${task.id} has no worker id for multi-agent membership`);
    const membership = assignAgentMembership(
      run,
      { multiAgentRunId: multiAgentRun.id, groupId: group.id, roleId: role.id, taskId: task.id, workerId: task.workerId, dispatchId: input.dispatchId, fanoutId: fanout.id, status: "running" },
      now,
      policyForMembership,
      workerExists
    );
    (task as unknown as { multiAgent?: unknown }).multiAgent = { runId: multiAgentRun.id, groupId: group.id, roleId: role.id, membershipId: membership.id, fanoutId: fanout.id };
    membershipIds.push(membership.id);
  }
  fanout.status = "dispatched";
  fanout.updatedAt = now;
  fanout.lifecycle.push(lifecycleEvent("planned", "dispatched", "dispatch created", undefined, undefined, now));
  fanout.dispatchIds = unique([...fanout.dispatchIds, input.dispatchId]);
  fanout.taskIds = unique([...fanout.taskIds, ...input.tasks.map((task) => task.id)]);
  fanout.workerIds = unique([...fanout.workerIds, ...input.tasks.map((task) => task.workerId || "").filter(Boolean)]);
  fanout.membershipIds = unique([...fanout.membershipIds, ...membershipIds]);
  if (input.sandboxProfileId) fanout.sandboxProfileChoices.dispatch = input.sandboxProfileId;
  const groupStatusBefore = group.status;
  group.status = "running";
  group.updatedAt = fanout.updatedAt;
  group.lifecycle.push(lifecycleEvent(groupStatusBefore, "running", "dispatch created", undefined, undefined, now));
  multiAgentRun.status = multiAgentRun.status === "planned" || multiAgentRun.status === "forming" ? "running" : multiAgentRun.status;
  touch(multiAgentRun, now);
  return { multiAgent: { runId: multiAgentRun.id, groupId: group.id, roleId: role.id, fanoutId: fanout.id }, membershipIds };
}

export interface RecordMultiAgentWorkerOutputInput {
  workerId: string;
  taskId: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  evidence: StateEvidence[];
  artifactPaths?: string[];
  blackboardMessageIds?: string[];
  blackboardArtifactRefIds?: string[];
}

export function recordMultiAgentWorkerOutput(run: WorkflowRun, input: RecordMultiAgentWorkerOutputInput, now: string): AgentMembership[] {
  const state = ensureMultiAgentState(run);
  const memberships = state.memberships.filter((membership) => membership.workerId === input.workerId && membership.taskId === input.taskId);
  if (!memberships.length) return [];
  const evidenceRefs = input.evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean);
  for (const membership of memberships) {
    const before = membership.status;
    membership.status = "reported";
    membership.updatedAt = now;
    membership.resultNodeId = input.resultNodeId || membership.resultNodeId;
    membership.verifierNodeId = input.verifierNodeId || membership.verifierNodeId;
    membership.evidenceRefs = unique([...membership.evidenceRefs, ...evidenceRefs]);
    membership.artifactPaths = unique([...(membership.artifactPaths || []), ...(input.artifactPaths || [])]);
    membership.blackboardMessageIds = unique([...(membership.blackboardMessageIds || []), ...(input.blackboardMessageIds || [])]);
    membership.blackboardArtifactRefIds = unique([...(membership.blackboardArtifactRefIds || []), ...(input.blackboardArtifactRefIds || [])]);
    membership.lifecycle.push(lifecycleEvent(before, "reported", "worker output accepted", undefined, undefined, now));
  }
  return memberships;
}

// ---------------------------------------------------------------------------
// Summary + graph
// ---------------------------------------------------------------------------

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
        return { roleId, requiredEvidence: role?.requiredEvidence.length || 0, memberships: memberships.length, reported, missing: Math.max(0, memberships.length - reported) };
      }),
      fanouts: group.fanoutIds,
      fanins: group.faninIds,
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
    nextAction: nextMultiAgentAction(run, blockedReasons),
  };
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

export function buildMultiAgentGraph(run: WorkflowRun): MultiAgentGraph {
  const state = ensureMultiAgentState(run);
  const nodes: MultiAgentGraph["nodes"] = [];
  const edges: GraphEdge[] = [];
  for (const record of state.runs) {
    nodes.push({ id: `${run.id}:multi-agent:${record.id}`, kind: "multi-agent-run", status: record.status, label: record.title || record.id, path: recordPath(run, "runs", record.id) });
    edges.push({ from: `${run.id}:run`, to: `${run.id}:multi-agent:${record.id}` });
    if (record.blackboardId) edges.push({ from: `${run.id}:multi-agent:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
    if (record.parentMultiAgentRunId) edges.push({ from: `${run.id}:multi-agent:${record.parentMultiAgentRunId}`, to: `${run.id}:multi-agent:${record.id}`, label: "child" });
  }
  for (const record of state.roles) {
    nodes.push({ id: `${run.id}:multi-agent:role:${record.id}`, kind: "agent-role", status: record.status, label: record.title, path: recordPath(run, "roles", record.id) });
    edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:role:${record.id}` });
    if (record.blackboardId) edges.push({ from: `${run.id}:multi-agent:role:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
  }
  for (const record of state.groups) {
    nodes.push({ id: `${run.id}:multi-agent:group:${record.id}`, kind: "agent-group", status: record.status, label: record.title || record.id, path: recordPath(run, "groups", record.id) });
    edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:group:${record.id}` });
    if (record.blackboardId) edges.push({ from: `${run.id}:multi-agent:group:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
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
    if (record.blackboardId) edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
    for (const artifactId of record.blackboardArtifactRefIds || []) edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:artifact:${artifactId}`, label: "evidence" });
    for (const messageId of record.blackboardMessageIds || []) edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:message:${messageId}`, label: "message" });
  }
  for (const record of state.fanins) {
    nodes.push({ id: `${run.id}:multi-agent:fanin:${record.id}`, kind: "agent-fanin", status: record.status, label: record.strategy, path: recordPath(run, "fanins", record.id) });
    edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
    if (record.fanoutId) edges.push({ from: `${run.id}:multi-agent:fanout:${record.fanoutId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
    for (const membershipId of record.reportedMembershipIds) edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "reported" });
    for (const membershipId of record.missingMembershipIds) edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "missing" });
    if (record.blackboardId) edges.push({ from: `${run.id}:multi-agent:fanin:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
  }
  return { nodes, edges: uniqueEdges(edges) };
}

/** Path derivation matching multi-agent/paths.ts: `<multiAgentDir>/<plural
 *  kind>/<safeFileName(id)>.json`. Pure — `run.paths.multiAgentDir` is
 *  expected to already be set (shell/multi-agent-io.ts's
 *  ensureMultiAgentState sets it before calling into this file). */
export function recordPath(run: WorkflowRun, kind: string, id: string): string {
  const root = run.paths.multiAgentDir || `${run.paths.runDir}/multi-agent`;
  return `${root}/${kind}/${safeFileName(id)}.json`;
}

export function multiAgentRoot(run: WorkflowRun): string {
  return run.paths.multiAgentDir || `${run.paths.runDir}/multi-agent`;
}
