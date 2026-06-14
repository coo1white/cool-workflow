"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MULTI_AGENT_SCHEMA_VERSION = void 0;
exports.ensureMultiAgentState = ensureMultiAgentState;
exports.persistMultiAgentState = persistMultiAgentState;
exports.createMultiAgentRun = createMultiAgentRun;
exports.transitionMultiAgentRun = transitionMultiAgentRun;
exports.createAgentRole = createAgentRole;
exports.createAgentGroup = createAgentGroup;
exports.assignAgentMembership = assignAgentMembership;
exports.createAgentFanout = createAgentFanout;
exports.attachDispatchToMultiAgent = attachDispatchToMultiAgent;
exports.collectAgentFanin = collectAgentFanin;
exports.recordMultiAgentWorkerOutput = recordMultiAgentWorkerOutput;
exports.summarizeMultiAgent = summarizeMultiAgent;
exports.buildMultiAgentGraph = buildMultiAgentGraph;
exports.getMultiAgentRun = getMultiAgentRun;
exports.getAgentRole = getAgentRole;
exports.getAgentGroup = getAgentGroup;
exports.getAgentMembership = getAgentMembership;
exports.getAgentFanout = getAgentFanout;
exports.getAgentFanin = getAgentFanin;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const state_node_1 = require("./state-node");
const trust_audit_1 = require("./trust-audit");
const multi_agent_trust_1 = require("./multi-agent-trust");
exports.MULTI_AGENT_SCHEMA_VERSION = 1;
function ensureMultiAgentState(run) {
    run.paths.multiAgentDir = multiAgentRoot(run);
    node_fs_1.default.mkdirSync(run.paths.multiAgentDir, { recursive: true });
    for (const dir of ["runs", "roles", "groups", "memberships", "fanouts", "fanins"]) {
        node_fs_1.default.mkdirSync(node_path_1.default.join(run.paths.multiAgentDir, dir), { recursive: true });
    }
    if (!run.multiAgent) {
        run.multiAgent = {
            schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
            runs: [],
            roles: [],
            groups: [],
            memberships: [],
            fanouts: [],
            fanins: []
        };
    }
    run.multiAgent.schemaVersion = exports.MULTI_AGENT_SCHEMA_VERSION;
    run.multiAgent.runs = run.multiAgent.runs || [];
    run.multiAgent.roles = run.multiAgent.roles || [];
    run.multiAgent.groups = run.multiAgent.groups || [];
    run.multiAgent.memberships = run.multiAgent.memberships || [];
    run.multiAgent.fanouts = run.multiAgent.fanouts || [];
    run.multiAgent.fanins = run.multiAgent.fanins || [];
    return run.multiAgent;
}
function persistMultiAgentState(run) {
    const state = ensureMultiAgentState(run);
    const root = multiAgentRoot(run);
    assertNoRecordPathCollisions("MultiAgentRun", state.runs);
    assertNoRecordPathCollisions("AgentRole", state.roles);
    assertNoRecordPathCollisions("AgentGroup", state.groups);
    assertNoRecordPathCollisions("AgentMembership", state.memberships);
    assertNoRecordPathCollisions("AgentFanout", state.fanouts);
    assertNoRecordPathCollisions("AgentFanin", state.fanins);
    (0, state_1.writeJson)(node_path_1.default.join(root, "index.json"), {
        schemaVersion: exports.MULTI_AGENT_SCHEMA_VERSION,
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
    for (const record of state.runs)
        writeRecord(run, "runs", record);
    for (const record of state.roles)
        writeRecord(run, "roles", record);
    for (const record of state.groups)
        writeRecord(run, "groups", record);
    for (const record of state.memberships)
        writeRecord(run, "memberships", record);
    for (const record of state.fanouts)
        writeRecord(run, "fanouts", record);
    for (const record of state.fanins)
        writeRecord(run, "fanins", record);
}
function createMultiAgentRun(run, input = {}) {
    const state = ensureMultiAgentState(run);
    const id = input.id || createId("mar", state.runs.length + 1);
    if (state.runs.some((record) => record.id === id))
        throw new Error(`Duplicate MultiAgentRun id: ${id}`);
    const now = new Date().toISOString();
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
        lifecycle: [lifecycleEvent(undefined, status, "created")],
        links: {
            workflowRunId: run.id,
            phase: input.phase,
            phaseId: input.phaseId,
            blackboardId: input.blackboardId,
            blackboardTopicIds: unique(input.topicIds || [])
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
            metadata: { title: input.title }
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
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.run",
        decision: "recorded",
        source: "runtime-derived",
        multiAgentRunId: record.id,
        metadata: { status: record.status, objective: record.objective }
    });
    persistMultiAgentState(run);
    return record;
}
function transitionMultiAgentRun(run, multiAgentRunId, status, options = {}) {
    ensureMultiAgentState(run);
    const record = requireMultiAgentRun(run, multiAgentRunId);
    assertLifecycleTransition(record.status, status);
    if (status === "completed")
        assertMultiAgentRunCompletionReady(run, record);
    const before = record.status;
    record.status = status;
    record.updatedAt = new Date().toISOString();
    record.lifecycle.push(lifecycleEvent(before, status, options.reason, options.actor, options.metadata));
    if (status === "completed")
        completeOwnedMultiAgentRecords(run, record, options.reason);
    appendMultiAgentNode(run, "multi-agent-run", record.id, statusToNodeStatus(status), {
        status,
        reason: options.reason
    });
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.lifecycle",
        decision: status === "failed" ? "failed" : "validated",
        source: "cw-validated",
        multiAgentRunId: record.id,
        metadata: { from: before, to: status, reason: options.reason }
    });
    persistMultiAgentState(run);
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
    if (blocked.length) {
        throw new Error(`Cannot complete MultiAgentRun ${multiAgentRun.id}: ${blocked.join("; ")}`);
    }
}
function completeOwnedMultiAgentRecords(run, multiAgentRun, reason) {
    const state = ensureMultiAgentState(run);
    for (const role of state.roles.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (role.status === "completed" || role.status === "cancelled")
            continue;
        const before = role.status;
        role.status = "completed";
        role.updatedAt = multiAgentRun.updatedAt;
        role.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
    }
    for (const group of state.groups.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (group.status === "completed" || group.status === "failed" || group.status === "cancelled")
            continue;
        const before = group.status;
        group.status = "completed";
        group.updatedAt = multiAgentRun.updatedAt;
        group.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
    }
    for (const fanout of state.fanouts.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (fanout.status === "completed" || fanout.status === "failed" || fanout.status === "cancelled")
            continue;
        const before = fanout.status;
        fanout.status = "completed";
        fanout.updatedAt = multiAgentRun.updatedAt;
        fanout.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
    }
    for (const fanin of state.fanins.filter((record) => record.multiAgentRunId === multiAgentRun.id)) {
        if (fanin.status === "completed" || fanin.status === "failed")
            continue;
        const before = fanin.status;
        fanin.status = "completed";
        fanin.updatedAt = multiAgentRun.updatedAt;
        fanin.lifecycle.push(lifecycleEvent(before, "completed", reason || "multi-agent run completed"));
    }
}
function createAgentRole(run, input) {
    const state = ensureMultiAgentState(run);
    const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
    const id = input.id || createId("role", state.roles.length + 1);
    if (state.roles.some((record) => record.id === id))
        throw new Error(`Duplicate AgentRole id: ${id}`);
    if (input.parentRoleId)
        requireAgentRole(run, input.parentRoleId);
    const now = new Date().toISOString();
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
        lifecycle: [lifecycleEvent(undefined, "planned", "created")],
        parentRoleId: input.parentRoleId,
        childRoleIds: [],
        policy: undefined,
        metadata: compact(input.metadata)
    };
    role.policy = (0, multi_agent_trust_1.policyForRole)(role);
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
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
    (0, multi_agent_trust_1.recordRolePolicyAudit)(run, role);
    persistMultiAgentState(run);
    return role;
}
function createAgentGroup(run, input) {
    const state = ensureMultiAgentState(run);
    const multiAgentRun = requireMultiAgentRun(run, input.multiAgentRunId);
    const id = input.id || createId("group", state.groups.length + 1);
    if (state.groups.some((record) => record.id === id))
        throw new Error(`Duplicate AgentGroup id: ${id}`);
    if (input.parentGroupId)
        requireAgentGroup(run, input.parentGroupId);
    for (const taskId of input.taskIds || [])
        requireRunTask(run, taskId);
    const now = new Date().toISOString();
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
        lifecycle: [lifecycleEvent(undefined, "forming", "created")],
        parentGroupId: input.parentGroupId,
        childGroupIds: [],
        policy: undefined,
        metadata: compact(input.metadata)
    };
    group.policy = (0, multi_agent_trust_1.policyForGroup)(group);
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
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function assignAgentMembership(run, input) {
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
    const now = new Date().toISOString();
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
        lifecycle: [lifecycleEvent(undefined, status, "assigned")],
        evidenceRefs: [],
        artifactPaths: [],
        blackboardId: input.blackboardId || group.blackboardId || role.blackboardId,
        topicIds: unique([...(group.topicIds || []), ...(role.topicIds || []), ...(input.topicIds || [])]),
        blackboardMessageIds: [],
        blackboardArtifactRefIds: [],
        policy: undefined,
        metadata: compact(input.metadata)
    };
    membership.policy = (0, multi_agent_trust_1.policyForMembership)(membership, role);
    state.memberships.push(membership);
    group.membershipIds = unique([...group.membershipIds, membership.id]);
    group.roleIds = unique([...group.roleIds, role.id]);
    group.taskIds = unique([...group.taskIds, task.id]);
    if (membership.workerId)
        group.workerIds = unique([...group.workerIds, membership.workerId]);
    touch(group);
    const roleStatusBefore = role.status;
    role.status = "active";
    role.updatedAt = now;
    role.lifecycle.push(lifecycleEvent(roleStatusBefore, "active", "membership assigned"));
    if (membership.workerId)
        attachWorkerMetadata(run, membership);
    appendMultiAgentNode(run, "agent-membership", membership.id, statusToNodeStatus(membership.status), {
        multiAgentRunId: membership.multiAgentRunId,
        groupId: membership.groupId,
        roleId: membership.roleId,
        taskId: membership.taskId,
        workerId: membership.workerId,
        dispatchId: membership.dispatchId,
        fanoutId: membership.fanoutId
    }, [`${run.id}:multi-agent:group:${membership.groupId}`, `${run.id}:multi-agent:role:${membership.roleId}`]);
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function createAgentFanout(run, input) {
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
    const now = new Date().toISOString();
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
        roleIds: unique(input.roleIds || group.roleIds),
        taskIds: unique(input.taskIds || group.taskIds),
        workerIds: unique(input.workerIds || []),
        membershipIds: unique(input.membershipIds || []),
        dispatchIds: unique(input.dispatchIds || []),
        concurrencyLimit: input.concurrencyLimit,
        sandboxProfileChoices: input.sandboxProfileChoices || {},
        expectedReturnShape: input.expectedReturnShape || "Each member writes a Markdown result with a cw:result JSON fence containing summary, findings, and evidence.",
        blackboardId: input.blackboardId || group.blackboardId || multiAgentRun.blackboardId,
        topicIds: unique([...(group.topicIds || []), ...(multiAgentRun.topicIds || []), ...(input.topicIds || [])]),
        lifecycle: [lifecycleEvent(undefined, "planned", "created")],
        policy: {
            schemaVersion: 1,
            id: `${id}-policy`,
            policyRef: `multiAgent.fanouts.${id}.policy`,
            subjectKind: "fanout",
            subjectId: id,
            allowedBlackboardTopicIds: unique(fanoutTopicIds(group, multiAgentRun, input)),
            allowedWriteOperations: ["message", "context", "artifact"],
            allowedCandidateOperations: ["register"],
            allowedJudgeOperations: [],
            sandboxProfileHints: unique(Object.values(input.sandboxProfileChoices || {}).map(String)),
            requiredEvidenceRefs: [],
            deniedOperations: [],
            metadata: { reason: input.reason }
        },
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
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function attachDispatchToMultiAgent(run, input) {
    if (!input.multiAgentRunId && !input.groupId && !input.roleId && !input.fanoutId)
        return { membershipIds: [] };
    const state = ensureMultiAgentState(run);
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
            sandboxProfileChoices: input.sandboxProfileId ? { dispatch: input.sandboxProfileId } : {}
        });
    }
    if (fanout.multiAgentRunId !== multiAgentRun.id || fanout.groupId !== group.id) {
        throw new Error(`Fanout ${fanout.id} does not match MultiAgentRun ${multiAgentRun.id} and group ${group.id}`);
    }
    const membershipIds = [];
    for (const task of input.tasks) {
        if (!task.workerId)
            throw new Error(`Task ${task.id} has no worker id for multi-agent membership`);
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
    if (input.sandboxProfileId)
        fanout.sandboxProfileChoices.dispatch = input.sandboxProfileId;
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
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function collectAgentFanin(run, input) {
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
    const requiredMemberships = scopedMemberships.filter((membership) => requiredRoleIds.includes(membership.roleId));
    const blackboardId = input.blackboardId || group.blackboardId || multiAgentRun.blackboardId;
    const requiresBlackboardEvidence = Boolean(blackboardId || requiredMemberships.some((membership) => membership.blackboardId));
    if (requiresBlackboardEvidence) {
        for (const membership of requiredMemberships) {
            const indexedEvidence = [
                ...((membership.blackboardArtifactRefIds || [])),
                ...((membership.blackboardMessageIds || []))
            ];
            if (!indexedEvidence.length)
                blockedReasons.push(`membership ${membership.id} has no indexed blackboard evidence`);
        }
    }
    const verifierReady = blockedReasons.length === 0;
    const status = verifierReady ? "ready" : "blocked";
    const now = new Date().toISOString();
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
        lifecycle: [lifecycleEvent(undefined, status, "collected")],
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
            metadata: { verifierReady, strategy: input.strategy || "required-role-evidence" }
        },
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
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function recordMultiAgentWorkerOutput(run, input) {
    const state = ensureMultiAgentState(run);
    const memberships = state.memberships.filter((membership) => membership.workerId === input.workerId && membership.taskId === input.taskId);
    if (!memberships.length)
        return [];
    const evidenceRefs = input.evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean);
    for (const membership of memberships) {
        const before = membership.status;
        membership.status = "reported";
        membership.updatedAt = new Date().toISOString();
        membership.resultNodeId = input.resultNodeId || membership.resultNodeId;
        membership.verifierNodeId = input.verifierNodeId || membership.verifierNodeId;
        membership.evidenceRefs = unique([...membership.evidenceRefs, ...evidenceRefs]);
        membership.artifactPaths = unique([...(membership.artifactPaths || []), ...(input.artifactPaths || [])]);
        membership.blackboardMessageIds = unique([...(membership.blackboardMessageIds || []), ...(input.blackboardMessageIds || [])]);
        membership.blackboardArtifactRefIds = unique([...(membership.blackboardArtifactRefIds || []), ...(input.blackboardArtifactRefIds || [])]);
        membership.lifecycle.push(lifecycleEvent(before, "reported", "worker output accepted"));
        appendMultiAgentNode(run, "agent-membership", membership.id, "completed", {
            resultNodeId: membership.resultNodeId,
            verifierNodeId: membership.verifierNodeId,
            evidenceRefs: membership.evidenceRefs
        }, [membership.resultNodeId, membership.verifierNodeId].filter(Boolean));
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function buildMultiAgentGraph(run) {
    const state = ensureMultiAgentState(run);
    const root = multiAgentRoot(run);
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
    if (!node_fs_1.default.existsSync(root))
        node_fs_1.default.mkdirSync(root, { recursive: true });
    return { nodes, edges: uniqueEdges(edges) };
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
function multiAgentRoot(run) {
    return run.paths.multiAgentDir || node_path_1.default.join(run.paths.runDir, "multi-agent");
}
function recordPath(run, kind, id) {
    return node_path_1.default.join(multiAgentRoot(run), kind, `${(0, state_1.safeFileName)(id)}.json`);
}
function fanoutTopicIds(group, multiAgentRun, input) {
    return [...(group.topicIds || []), ...(multiAgentRun.topicIds || []), ...(input.topicIds || [])];
}
function writeRecord(run, kind, record) {
    (0, state_1.writeJson)(recordPath(run, kind, record.id), record);
}
function assertNoRecordPathCollisions(label, records) {
    const seen = new Map();
    for (const record of records) {
        const safe = (0, state_1.safeFileName)(record.id);
        const existing = seen.get(safe);
        if (existing && existing !== record.id) {
            throw new Error(`${label} ids ${existing} and ${record.id} collide on safe file name ${safe}`);
        }
        seen.set(safe, record.id);
    }
}
function indexRow(record) {
    return { id: record.id, status: record.status, updatedAt: record.updatedAt };
}
function appendMultiAgentNode(run, kind, id, status, metadata, parents = []) {
    const nodeId = kind === "multi-agent-run" ? `${run.id}:multi-agent:${id}` : `${run.id}:multi-agent:${kind.replace("agent-", "")}:${id}`;
    (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: nodeId,
        kind,
        status,
        loopStage: run.loopStage,
        outputs: metadata,
        artifacts: [{ id: kind, kind: "json", path: recordPath(run, pluralKind(kind), id) }],
        parents,
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata
    }));
}
function pluralKind(kind) {
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
function assertLifecycleTransition(from, to) {
    const allowed = {
        planned: ["forming", "running", "failed", "cancelled"],
        forming: ["running", "failed", "cancelled"],
        running: ["collecting", "completed", "failed", "cancelled"],
        collecting: ["verifying", "completed", "failed", "cancelled"],
        verifying: ["completed", "failed", "cancelled"],
        completed: [],
        failed: [],
        cancelled: []
    };
    if (from === to)
        return;
    if (!allowed[from].includes(to))
        throw new Error(`Invalid MultiAgentRun lifecycle transition: ${from} -> ${to}`);
}
function lifecycleEvent(from, to, reason, actor = "cw", metadata) {
    return {
        at: new Date().toISOString(),
        from,
        to,
        actor,
        reason,
        metadata: compact(metadata)
    };
}
function attachWorkerMetadata(run, membership) {
    const workers = run.workers || [];
    const index = workers.findIndex((worker) => worker.id === membership.workerId);
    if (index < 0)
        return;
    const worker = workers[index];
    const multiAgent = {
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
function isMembershipReported(membership) {
    return (membership.status === "reported" || membership.status === "verified") && membership.evidenceRefs.length > 0;
}
function nextMultiAgentAction(run, blockedReasons) {
    const state = ensureMultiAgentState(run);
    if (!state.runs.length)
        return `node scripts/cw.js multi-agent run ${run.id} --id <multi-agent-run-id>`;
    if (blockedReasons.length)
        return `node scripts/cw.js multi-agent fanin ${run.id} --group <group-id> --fanout <fanout-id>`;
    const running = state.memberships.find((membership) => membership.status === "running");
    if (running?.workerId)
        return `node scripts/cw.js worker manifest ${run.id} ${running.workerId}`;
    const groupWithoutFanin = state.groups.find((group) => group.membershipIds.length && !group.faninIds.length);
    if (groupWithoutFanin)
        return `node scripts/cw.js multi-agent fanin ${run.id} --group ${groupWithoutFanin.id}`;
    return undefined;
}
function touch(record) {
    record.updatedAt = new Date().toISOString();
    return record;
}
// Deterministic record id (FreeBSD-audit L12/L13): the record's POSITION in its
// per-run collection, threaded from the call site. No wall-clock stamp, no PRNG
// suffix — re-running the same multi-agent topology mints byte-identical ids, so
// snapshot/replay digests match. Each call site already asserts the minted id is
// unique within its collection, and these collections only ever append.
function createId(prefix, seq) {
    return `${prefix}-${String(seq).padStart(4, "0")}`;
}
function compact(value) {
    if (!value)
        return undefined;
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
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
