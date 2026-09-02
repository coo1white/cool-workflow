"use strict";
// core/multi-agent/runtime.ts — multi-agent record kernel: run/role/group/
// membership/fanout/fanin create+transition.
//
// MILESTONE 9. Byte-exact port of the DECISION half of the old build's
// multi-agent module and its helpers, ids, and graph modules: record shape
// construction, the
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
// multi-agent helpers module kept its own copy too — see that file's header).
// core/multi-agent/topology.ts, candidate-scoring.ts, and the host/step
// layer have their OWN separate `unique` that does NOT sort (insertion-
// order only) — never merge the two. See uniquedual-role-vs-candidate-
// order.case.js and project/docs/rebuild/PLAN.md byte-compat item 3.
//
// Evidence: SPEC/multi-agent.md sections A ("Multi-agent kernel"), the
// "Kernel error strings" and "Fanin blocked-reason strings" Exact-outputs
// blocks, invariants 1-4/11; the old build's multi-agent module and its
// helpers/ids/paths/graph modules (byte-exact source).
Object.defineProperty(exports, "__esModule", { value: true });
exports.MULTI_AGENT_SCHEMA_VERSION = void 0;
exports.createId = createId;
exports.unique = unique;
exports.compact = compact;
exports.touch = touch;
exports.pluralKind = pluralKind;
exports.statusToNodeStatus = statusToNodeStatus;
exports.countBy = countBy;
exports.uniqueEdges = uniqueEdges;
exports.indexRow = indexRow;
exports.assertNoRecordPathCollisions = assertNoRecordPathCollisions;
exports.ensureMultiAgentState = ensureMultiAgentState;
exports.getMultiAgentRun = getMultiAgentRun;
exports.getAgentRole = getAgentRole;
exports.getAgentGroup = getAgentGroup;
exports.getAgentMembership = getAgentMembership;
exports.getAgentFanout = getAgentFanout;
exports.getAgentFanin = getAgentFanin;
exports.requireMultiAgentRun = requireMultiAgentRun;
exports.requireAgentRole = requireAgentRole;
exports.requireAgentGroup = requireAgentGroup;
exports.requireAgentFanout = requireAgentFanout;
exports.requireRunTask = requireRunTask;
exports.assertLifecycleTransition = assertLifecycleTransition;
exports.lifecycleEvent = lifecycleEvent;
exports.isMembershipReported = isMembershipReported;
exports.createMultiAgentRun = createMultiAgentRun;
exports.transitionMultiAgentRun = transitionMultiAgentRun;
exports.createAgentRole = createAgentRole;
exports.createAgentGroup = createAgentGroup;
exports.assignAgentMembership = assignAgentMembership;
exports.createAgentFanout = createAgentFanout;
exports.collectAgentFanin = collectAgentFanin;
exports.attachDispatchToMultiAgent = attachDispatchToMultiAgent;
exports.recordMultiAgentWorkerOutput = recordMultiAgentWorkerOutput;
exports.summarizeMultiAgent = summarizeMultiAgent;
exports.buildMultiAgentGraph = buildMultiAgentGraph;
exports.recordPath = recordPath;
exports.multiAgentRoot = multiAgentRoot;
exports.MULTI_AGENT_SCHEMA_VERSION = 1;
// ---------------------------------------------------------------------------
// Shared primitives (byte-exact to multi-agent/helpers.ts + ids.ts)
// ---------------------------------------------------------------------------
/** Deterministic record id: `${prefix}-${4-digit zero-padded seq}`. Pure
 *  function of its arguments — no Date, no random. */
function createId(prefix, seq) {
    return `${prefix}-${String(seq).padStart(4, "0")}`;
}
/** DROPS falsy values, then SORTS (default string sort). Kernel-side
 *  sorting `unique` — see file header byte-compat note. Never merge with
 *  topology.ts/candidate-scoring.ts's insertion-order sibling. */
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
function compact(value) {
    if (!value)
        return undefined;
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function touch(record, now) {
    record.updatedAt = now;
    return record;
}
function pluralKind(kind) {
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
 *  `completed`) per project/docs/rebuild/PLAN.md byte-compat / rebuild risk 7 — collapsing
 *  the two tables changes graph output and eval dependency_parity. */
function statusToNodeStatus(status) {
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
function countBy(items, key) {
    const counts = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
function uniqueEdges(edges) {
    const seen = new Set();
    const result = [];
    for (const edge of edges) {
        const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(edge);
    }
    return result;
}
function indexRow(record) {
    return { id: record.id, status: record.status, updatedAt: record.updatedAt };
}
/** Byte-exact "safe file name" charset used elsewhere in core/shell:
 *  chars outside `[a-zA-Z0-9_.:-]` become `_`. Kept as a local copy since
 *  this pure module cannot import shell/fs-atomic.ts's `safeFileName`. */
function safeFileName(value) {
    return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
function assertNoRecordPathCollisions(label, records) {
    const seen = new Map();
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
// State access
// ---------------------------------------------------------------------------
/** Fills `run.multiAgent` with empty arrays if absent (pure — no fs; the
 *  directory-creation half lives in shell/multi-agent-io.ts's
 *  ensureMultiAgentState). */
function ensureMultiAgentState(run) {
    const existing = run.multiAgent;
    const state = {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
        runs: existing?.runs || [],
        roles: existing?.roles || [],
        groups: existing?.groups || [],
        memberships: existing?.memberships || [],
        fanouts: existing?.fanouts || [],
        fanins: existing?.fanins || [],
    };
    run.multiAgent = state;
    return state;
}
function getMultiAgentRun(run, id) {
    return ensureMultiAgentState(run).runs.find((record) => record.id === id);
}
function getAgentRole(run, id) {
    return ensureMultiAgentState(run).roles.find((record) => record.id === id);
}
function getAgentGroup(run, id) {
    return ensureMultiAgentState(run).groups.find((record) => record.id === id);
}
function getAgentMembership(run, id) {
    return ensureMultiAgentState(run).memberships.find((record) => record.id === id);
}
function getAgentFanout(run, id) {
    return ensureMultiAgentState(run).fanouts.find((record) => record.id === id);
}
function getAgentFanin(run, id) {
    return ensureMultiAgentState(run).fanins.find((record) => record.id === id);
}
function requireMultiAgentRun(run, id) {
    const record = getMultiAgentRun(run, id);
    if (!record)
        throw new Error(`Unknown MultiAgentRun id: ${id}`);
    return record;
}
function requireAgentRole(run, id) {
    const record = getAgentRole(run, id);
    if (!record)
        throw new Error(`Unknown AgentRole id: ${id}`);
    return record;
}
function requireAgentGroup(run, id) {
    const record = getAgentGroup(run, id);
    if (!record)
        throw new Error(`Unknown AgentGroup id: ${id}`);
    return record;
}
function requireAgentFanout(run, id) {
    const record = getAgentFanout(run, id);
    if (!record)
        throw new Error(`Unknown AgentFanout id: ${id}`);
    return record;
}
function requireRunTask(run, id) {
    const task = run.tasks.find((record) => record.id === id);
    if (!task)
        throw new Error(`Unknown task id for multi-agent record: ${id}`);
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
function assertLifecycleTransition(from, to) {
    const allowed = {
        planned: ["forming", "running", "failed", "cancelled"],
        forming: ["running", "failed", "cancelled"],
        running: ["collecting", "completed", "failed", "cancelled"],
        collecting: ["verifying", "completed", "failed", "cancelled"],
        verifying: ["completed", "failed", "cancelled"],
        completed: [],
        failed: [],
        cancelled: [],
    };
    if (from === to)
        return;
    if (!allowed[from].includes(to))
        throw new Error(`Invalid MultiAgentRun lifecycle transition: ${from} -> ${to}`);
}
function lifecycleEvent(from, to, reason, actor, metadata, now) {
    return { at: now, from, to, actor: actor || "cw", reason, metadata: compact(metadata) };
}
/** A membership counts as reported only when status is reported/verified
 *  AND it carries at least one evidence ref. */
function isMembershipReported(membership) {
    return (membership.status === "reported" || membership.status === "verified") && membership.evidenceRefs.length > 0;
}
function createMultiAgentRun(run, input, now) {
    const state = ensureMultiAgentState(run);
    const id = input.id || createId("mar", state.runs.length + 1);
    if (state.runs.some((record) => record.id === id))
        throw new Error(`Duplicate MultiAgentRun id: ${id}`);
    const status = input.status || "planned";
    const record = {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
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
function transitionMultiAgentRun(run, multiAgentRunId, status, options, now) {
    ensureMultiAgentState(run);
    const record = requireMultiAgentRun(run, multiAgentRunId);
    assertLifecycleTransition(record.status, status);
    if (status === "completed")
        assertMultiAgentRunCompletionReady(run, record);
    const before = record.status;
    record.status = status;
    record.updatedAt = now;
    record.lifecycle.push(lifecycleEvent(before, status, options.reason, options.actor, options.metadata, now));
    if (status === "completed")
        completeOwnedMultiAgentRecords(run, record, options.reason, now);
    return record;
}
function assertMultiAgentRunCompletionReady(run, multiAgentRun) {
    const state = ensureMultiAgentState(run);
    const groups = state.groups.filter((record) => record.multiAgentRunId === multiAgentRun.id);
    const fanins = state.fanins.filter((record) => record.multiAgentRunId === multiAgentRun.id);
    const blocked = fanins.flatMap((fanin) => {
        const reasons = [...fanin.blockedReasons];
        if (fanin.status === "blocked" || fanin.status === "failed")
            reasons.push(`fanin ${fanin.id} status is ${fanin.status}`);
        if (!fanin.verifierReady)
            reasons.push(`fanin ${fanin.id} is not verifier-ready`);
        return reasons.map((reason) => `${fanin.id}: ${reason}`);
    });
    for (const group of groups) {
        if ((group.membershipIds.length || group.fanoutIds.length) && !group.faninIds.length) {
            blocked.push(`group ${group.id} has no fanin record`);
        }
    }
    if (blocked.length)
        throw new Error(`Cannot complete MultiAgentRun ${multiAgentRun.id}: ${blocked.join("; ")}`);
}
function completeOwnedMultiAgentRecords(run, multiAgentRun, reason, now) {
    const state = ensureMultiAgentState(run);
    for (const role of state.roles.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (role.status === "completed" || role.status === "cancelled")
            continue;
        const before = role.status;
        role.status = "completed";
        role.updatedAt = now;
        role.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
    }
    for (const group of state.groups.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (group.status === "completed" || group.status === "failed" || group.status === "cancelled")
            continue;
        const before = group.status;
        group.status = "completed";
        group.updatedAt = now;
        group.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
    }
    for (const fanout of state.fanouts.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (fanout.status === "completed" || fanout.status === "failed" || fanout.status === "cancelled")
            continue;
        const before = fanout.status;
        fanout.status = "completed";
        fanout.updatedAt = now;
        fanout.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
    }
    for (const fanin of state.fanins.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (fanin.status === "completed" || fanin.status === "failed")
            continue;
        const before = fanin.status;
        fanin.status = "completed";
        fanin.updatedAt = now;
        fanin.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed", undefined, undefined, now));
    }
}
/** `policyFor` is injected (core/multi-agent/trust-policy.ts's
 *  `policyForRole`) so this file never has to import that module's
 *  cross-cutting policy shape directly at the top level — kept as a
 *  parameter purely to avoid an import cycle risk, not for genericity. */
function createAgentRole(run, input, now, policyFor) {
    const state = ensureMultiAgentState(run);
    const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
    const id = input.id || createId("role", state.roles.length + 1);
    if (state.roles.some((record) => record.id === id))
        throw new Error(`Duplicate AgentRole id: ${id}`);
    if (input.parentRoleId)
        requireAgentRole(run, input.parentRoleId);
    const role = {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
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
function createAgentGroup(run, input, now, policyFor) {
    const state = ensureMultiAgentState(run);
    const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
    const id = input.id || createId("group", state.groups.length + 1);
    if (state.groups.some((record) => record.id === id))
        throw new Error(`Duplicate AgentGroup id: ${id}`);
    if (input.parentGroupId)
        requireAgentGroup(run, input.parentGroupId);
    for (const taskId of input.taskIds || [])
        requireRunTask(run, taskId);
    const group = {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
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
function assignAgentMembership(run, input, now, policyForMembership, workerExists) {
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
    const duplicate = state.memberships.find((membership) => membership.groupId === group.id &&
        membership.roleId === role.id &&
        membership.taskId === task.id &&
        (input.workerId ? membership.workerId === input.workerId : !membership.workerId));
    if (duplicate) {
        throw new Error(`Duplicate AgentMembership for group=${group.id}, role=${role.id}, task=${task.id}, worker=${input.workerId || "none"}`);
    }
    const id = input.id || createId("membership", state.memberships.length + 1);
    if (state.memberships.some((record) => record.id === id))
        throw new Error(`Duplicate AgentMembership id: ${id}`);
    const status = input.status || (input.workerId ? "running" : "assigned");
    const membership = {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
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
    if (membership.workerId)
        group.workerIds = unique([...group.workerIds, membership.workerId]);
    touch(group, now);
    const roleStatusBefore = role.status;
    role.status = "active";
    role.updatedAt = now;
    role.lifecycle.push(lifecycleEvent(roleStatusBefore, "active", "membership assigned", undefined, undefined, now));
    return membership;
}
function createAgentFanout(run, input, now) {
    const state = ensureMultiAgentState(run);
    const group = requireAgentGroup(run, input.groupId);
    const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group.multiAgentRunId);
    if (group.multiAgentRunId !== multiAgentRun.id)
        throw new Error(`AgentGroup ${group.id} does not belong to ${multiAgentRun.id}`);
    const id = input.id || createId("fanout", state.fanouts.length + 1);
    if (state.fanouts.some((record) => record.id === id))
        throw new Error(`Duplicate AgentFanout id: ${id}`);
    for (const roleId of input.roleIds || [])
        requireAgentRole(run, roleId);
    for (const taskId of input.taskIds || [])
        requireRunTask(run, taskId);
    const roleIds = unique(input.roleIds || group.roleIds);
    const taskIds = unique(input.taskIds || group.taskIds);
    const fanout = {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
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
function collectAgentFanin(run, input, now) {
    const state = ensureMultiAgentState(run);
    const fanout = input.fanoutId ? requireAgentFanout(run, input.fanoutId) : undefined;
    const group = requireAgentGroup(run, input.groupId || fanout?.groupId || "");
    const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group.multiAgentRunId);
    if (group.multiAgentRunId !== multiAgentRun.id)
        throw new Error(`Group ${group.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
    if (fanout && fanout.groupId !== group.id)
        throw new Error(`Fanout ${fanout.id} does not belong to group ${group.id}`);
    const id = input.id || createId("fanin", state.fanins.length + 1);
    if (state.fanins.some((record) => record.id === id))
        throw new Error(`Duplicate AgentFanin id: ${id}`);
    const requiredRoleIds = unique(input.requiredRoleIds?.length ? input.requiredRoleIds : group.roleIds);
    for (const roleId of requiredRoleIds)
        requireAgentRole(run, roleId);
    const scopedMemberships = state.memberships.filter((membership) => membership.groupId === group.id && (!fanout || membership.fanoutId === fanout.id));
    const coverage = scopedMemberships.map((membership) => ({
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
    // An aggregation gate that observed zero members must not report itself
    // ready: with no required roles and no memberships every per-item check
    // above is vacuously empty, which used to yield verifierReady:true for a
    // fan-in over nothing (fail-open).
    if (!requiredRoleIds.length && !scopedMemberships.length) {
        blockedReasons.push("fan-in has no memberships and no required roles — nothing to aggregate");
    }
    const requiredMemberships = scopedMemberships.filter((membership) => requiredRoleIds.includes(membership.roleId));
    const blackboardId = input.blackboardId || group.blackboardId || multiAgentRun.blackboardId;
    const requiresBlackboardEvidence = Boolean(blackboardId || requiredMemberships.some((membership) => membership.blackboardId));
    if (requiresBlackboardEvidence) {
        for (const membership of requiredMemberships) {
            const indexedEvidence = [...(membership.blackboardArtifactRefIds || []), ...(membership.blackboardMessageIds || [])];
            if (!indexedEvidence.length)
                blockedReasons.push(`membership ${membership.id} has no indexed blackboard evidence`);
        }
    }
    const verifierReady = blockedReasons.length === 0;
    const status = verifierReady ? "ready" : "blocked";
    const fanin = {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
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
/** `attachDispatchToMultiAgent` — ties a dispatch to multi-agent state.
 *  Silent no-op (`{membershipIds: []}`) when NONE of the four ids are
 *  given. `policyForMembership` and `workerExists` are injected the same
 *  way `assignAgentMembership` needs them. */
function attachDispatchToMultiAgent(run, input, now, policyForMembership, workerExists) {
    if (!input.multiAgentRunId && !input.groupId && !input.roleId && !input.fanoutId)
        return { membershipIds: [] };
    ensureMultiAgentState(run);
    let fanout = input.fanoutId ? requireAgentFanout(run, input.fanoutId) : undefined;
    let group = input.groupId ? requireAgentGroup(run, input.groupId) : undefined;
    if (!group && fanout)
        group = requireAgentGroup(run, fanout.groupId);
    const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId || group?.multiAgentRunId || fanout?.multiAgentRunId || "");
    if (!group)
        throw new Error("Dispatch multi-agent attach requires --multi-agent-group or --multiAgentGroup");
    if (group.multiAgentRunId !== multiAgentRun.id)
        throw new Error(`Group ${group.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
    const roleIds = input.roleId ? [input.roleId] : unique([...(fanout ? fanout.roleIds : [])]);
    if (roleIds.length !== 1) {
        throw new Error(`Dispatch multi-agent attach requires exactly one role for deterministic membership; found ${roleIds.length || 0}`);
    }
    const role = requireAgentRole(run, roleIds[0]);
    if (role.multiAgentRunId !== multiAgentRun.id)
        throw new Error(`Role ${role.id} does not belong to MultiAgentRun ${multiAgentRun.id}`);
    if (!fanout) {
        fanout = createAgentFanout(run, {
            multiAgentRunId: multiAgentRun.id,
            groupId: group.id,
            reason: "dispatch attachment",
            roleIds: [role.id],
            taskIds: input.tasks.map((task) => task.id),
            dispatchIds: [input.dispatchId],
            concurrencyLimit: input.concurrencyLimit,
            sandboxProfileChoices: input.sandboxProfileId ? { dispatch: input.sandboxProfileId } : {},
        }, now);
    }
    if (fanout.multiAgentRunId !== multiAgentRun.id || fanout.groupId !== group.id) {
        throw new Error(`Fanout ${fanout.id} does not match MultiAgentRun ${multiAgentRun.id} and group ${group.id}`);
    }
    const membershipIds = [];
    for (const task of input.tasks) {
        if (!task.workerId)
            throw new Error(`Task ${task.id} has no worker id for multi-agent membership`);
        const membership = assignAgentMembership(run, { multiAgentRunId: multiAgentRun.id, groupId: group.id, roleId: role.id, taskId: task.id, workerId: task.workerId, dispatchId: input.dispatchId, fanoutId: fanout.id, status: "running" }, now, policyForMembership, workerExists);
        task.multiAgent = { runId: multiAgentRun.id, groupId: group.id, roleId: role.id, membershipId: membership.id, fanoutId: fanout.id };
        membershipIds.push(membership.id);
    }
    fanout.status = "dispatched";
    fanout.updatedAt = now;
    fanout.lifecycle.push(lifecycleEvent("planned", "dispatched", "dispatch created", undefined, undefined, now));
    fanout.dispatchIds = unique([...fanout.dispatchIds, input.dispatchId]);
    fanout.taskIds = unique([...fanout.taskIds, ...input.tasks.map((task) => task.id)]);
    fanout.workerIds = unique([...fanout.workerIds, ...input.tasks.map((task) => task.workerId || "").filter(Boolean)]);
    fanout.membershipIds = unique([...fanout.membershipIds, ...membershipIds]);
    if (input.sandboxProfileId)
        fanout.sandboxProfileChoices.dispatch = input.sandboxProfileId;
    const groupStatusBefore = group.status;
    group.status = "running";
    group.updatedAt = fanout.updatedAt;
    group.lifecycle.push(lifecycleEvent(groupStatusBefore, "running", "dispatch created", undefined, undefined, now));
    multiAgentRun.status = multiAgentRun.status === "planned" || multiAgentRun.status === "forming" ? "running" : multiAgentRun.status;
    touch(multiAgentRun, now);
    return { multiAgent: { runId: multiAgentRun.id, groupId: group.id, roleId: role.id, fanoutId: fanout.id }, membershipIds };
}
function recordMultiAgentWorkerOutput(run, input, now) {
    const state = ensureMultiAgentState(run);
    const memberships = state.memberships.filter((membership) => membership.workerId === input.workerId && membership.taskId === input.taskId);
    if (!memberships.length)
        return [];
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
function summarizeMultiAgent(run) {
    const state = ensureMultiAgentState(run);
    const blockedReasons = [];
    for (const fanin of state.fanins)
        blockedReasons.push(...fanin.blockedReasons.map((reason) => `${fanin.id}: ${reason}`));
    for (const membership of state.memberships) {
        if (membership.status === "failed")
            blockedReasons.push(`${membership.id}: failed membership`);
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
function nextMultiAgentAction(run, blockedReasons) {
    const state = ensureMultiAgentState(run);
    if (!state.runs.length)
        return `cw multi-agent run ${run.id} --id <multi-agent-run-id>`;
    if (blockedReasons.length)
        return `cw multi-agent fanin ${run.id} --group <group-id> --fanout <fanout-id>`;
    const running = state.memberships.find((membership) => membership.status === "running");
    if (running?.workerId)
        return `cw worker manifest ${run.id} ${running.workerId}`;
    const groupWithoutFanin = state.groups.find((group) => group.membershipIds.length && !group.faninIds.length);
    if (groupWithoutFanin)
        return `cw multi-agent fanin ${run.id} --group ${groupWithoutFanin.id}`;
    return undefined;
}
function buildMultiAgentGraph(run) {
    const state = ensureMultiAgentState(run);
    const nodes = [];
    const edges = [];
    for (const record of state.runs) {
        nodes.push({ id: `${run.id}:multi-agent:${record.id}`, kind: "multi-agent-run", status: record.status, label: record.title || record.id, path: recordPath(run, "runs", record.id) });
        edges.push({ from: `${run.id}:run`, to: `${run.id}:multi-agent:${record.id}` });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
        if (record.parentMultiAgentRunId)
            edges.push({ from: `${run.id}:multi-agent:${record.parentMultiAgentRunId}`, to: `${run.id}:multi-agent:${record.id}`, label: "child" });
    }
    for (const record of state.roles) {
        nodes.push({ id: `${run.id}:multi-agent:role:${record.id}`, kind: "agent-role", status: record.status, label: record.title, path: recordPath(run, "roles", record.id) });
        edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:role:${record.id}` });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:role:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
    }
    for (const record of state.groups) {
        nodes.push({ id: `${run.id}:multi-agent:group:${record.id}`, kind: "agent-group", status: record.status, label: record.title || record.id, path: recordPath(run, "groups", record.id) });
        edges.push({ from: `${run.id}:multi-agent:${record.multiAgentRunId}`, to: `${run.id}:multi-agent:group:${record.id}` });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:group:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
        for (const taskId of record.taskIds)
            edges.push({ from: `${run.id}:multi-agent:group:${record.id}`, to: `${run.id}:task:${taskId}`, label: "task" });
    }
    for (const record of state.fanouts) {
        nodes.push({ id: `${run.id}:multi-agent:fanout:${record.id}`, kind: "agent-fanout", status: record.status, label: record.reason, path: recordPath(run, "fanouts", record.id) });
        edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:fanout:${record.id}` });
        for (const dispatchId of record.dispatchIds)
            edges.push({ from: `${run.id}:multi-agent:fanout:${record.id}`, to: `${run.id}:dispatch:${dispatchId}`, label: "dispatch" });
    }
    for (const record of state.memberships) {
        nodes.push({ id: `${run.id}:multi-agent:membership:${record.id}`, kind: "agent-membership", status: record.status, label: `${record.roleId}/${record.taskId}`, path: recordPath(run, "memberships", record.id) });
        edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:membership:${record.id}` });
        edges.push({ from: `${run.id}:multi-agent:role:${record.roleId}`, to: `${run.id}:multi-agent:membership:${record.id}` });
        edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:task:${record.taskId}`, label: "task" });
        if (record.workerId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:worker:${record.workerId}`, label: "worker" });
        if (record.resultNodeId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: record.resultNodeId, label: "result" });
        if (record.verifierNodeId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: record.verifierNodeId, label: "verifier" });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
        for (const artifactId of record.blackboardArtifactRefIds || [])
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:artifact:${artifactId}`, label: "evidence" });
        for (const messageId of record.blackboardMessageIds || [])
            edges.push({ from: `${run.id}:multi-agent:membership:${record.id}`, to: `${run.id}:blackboard:message:${messageId}`, label: "message" });
    }
    for (const record of state.fanins) {
        nodes.push({ id: `${run.id}:multi-agent:fanin:${record.id}`, kind: "agent-fanin", status: record.status, label: record.strategy, path: recordPath(run, "fanins", record.id) });
        edges.push({ from: `${run.id}:multi-agent:group:${record.groupId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
        if (record.fanoutId)
            edges.push({ from: `${run.id}:multi-agent:fanout:${record.fanoutId}`, to: `${run.id}:multi-agent:fanin:${record.id}` });
        for (const membershipId of record.reportedMembershipIds)
            edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "reported" });
        for (const membershipId of record.missingMembershipIds)
            edges.push({ from: `${run.id}:multi-agent:membership:${membershipId}`, to: `${run.id}:multi-agent:fanin:${record.id}`, label: "missing" });
        if (record.blackboardId)
            edges.push({ from: `${run.id}:multi-agent:fanin:${record.id}`, to: `${run.id}:blackboard:${record.blackboardId}`, label: "blackboard" });
    }
    return { nodes, edges: uniqueEdges(edges) };
}
/** Path derivation matching multi-agent/paths.ts: `<multiAgentDir>/<plural
 *  kind>/<safeFileName(id)>.json`. Pure — `run.paths.multiAgentDir` is
 *  expected to already be set (shell/multi-agent-io.ts's
 *  ensureMultiAgentState sets it before calling into this file). */
function recordPath(run, kind, id) {
    const root = run.paths.multiAgentDir || `${run.paths.runDir}/multi-agent`;
    return `${root}/${kind}/${safeFileName(id)}.json`;
}
function multiAgentRoot(run) {
    return run.paths.multiAgentDir || `${run.paths.runDir}/multi-agent`;
}
