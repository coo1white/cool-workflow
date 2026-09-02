"use strict";
// shell/multi-agent-io.ts — the impure wrapper wiring core/multi-agent/
// runtime.ts's pure record kernel to real disk (fs.mkdirSync, writeJson)
// and the trust-audit chain (recordTrustAuditEvent).
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// multi-agent module: ensureMultiAgentState's directory creation,
// persistMultiAgentState's index.json + per-record writes, and every
// create/transition call's audit-event recording + state-node append.
//
// Evidence: SPEC/multi-agent.md sections A ("Multi-agent kernel"),
// "Files on disk"; the old build's multi-agent module (byte-exact
// source for the wiring sequence).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentFanin = exports.getAgentFanout = exports.getAgentMembership = exports.getAgentGroup = exports.getAgentRole = exports.getMultiAgentRun = exports.buildMultiAgentGraph = exports.summarizeMultiAgent = void 0;
exports.multiAgentRoot = multiAgentRoot;
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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const node_store_1 = require("./node-store");
const state_node_1 = require("../core/state/state-node");
const contract_1 = require("../core/pipeline/contract");
const trust_audit_1 = require("./trust-audit");
const rt = __importStar(require("../core/multi-agent/runtime"));
const trust_policy_1 = require("../core/multi-agent/trust-policy");
const trust_policy_io_1 = require("./trust-policy-io");
const coordinator_io_1 = require("./coordinator-io");
const worker_isolation_1 = require("./worker-isolation");
function multiAgentRoot(run) {
    return run.paths.multiAgentDir || path.join(run.paths.runDir, "multi-agent");
}
/** Makes `run.paths.multiAgentDir` plus the six sub-dirs; fills
 *  `run.multiAgent` with empty arrays if absent. */
function ensureMultiAgentState(run) {
    run.paths.multiAgentDir = multiAgentRoot(run);
    fs.mkdirSync(run.paths.multiAgentDir, { recursive: true });
    for (const dir of ["runs", "roles", "groups", "memberships", "fanouts", "fanins"]) {
        fs.mkdirSync(path.join(run.paths.multiAgentDir, dir), { recursive: true });
    }
    return rt.ensureMultiAgentState(run);
}
function writeRecord(run, kind, record) {
    (0, fs_atomic_1.writeJson)(rt.recordPath(run, kind, record.id), record);
}
/** Checks file-name collisions, writes index.json + one JSON file per
 *  record. */
function persistMultiAgentState(run) {
    const state = ensureMultiAgentState(run);
    const root = multiAgentRoot(run);
    rt.assertNoRecordPathCollisions("MultiAgentRun", state.runs);
    rt.assertNoRecordPathCollisions("AgentRole", state.roles);
    rt.assertNoRecordPathCollisions("AgentGroup", state.groups);
    rt.assertNoRecordPathCollisions("AgentMembership", state.memberships);
    rt.assertNoRecordPathCollisions("AgentFanout", state.fanouts);
    rt.assertNoRecordPathCollisions("AgentFanin", state.fanins);
    (0, fs_atomic_1.writeJson)(path.join(root, "index.json"), {
        schemaVersion: rt.MULTI_AGENT_SCHEMA_VERSION,
        runId: run.id,
        counts: { runs: state.runs.length, roles: state.roles.length, groups: state.groups.length, memberships: state.memberships.length, fanouts: state.fanouts.length, fanins: state.fanins.length },
        runs: state.runs.map(rt.indexRow),
        roles: state.roles.map(rt.indexRow),
        groups: state.groups.map(rt.indexRow),
        memberships: state.memberships.map(rt.indexRow),
        fanouts: state.fanouts.map(rt.indexRow),
        fanins: state.fanins.map(rt.indexRow),
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
function appendMultiAgentNode(run, kind, id, status, metadata, parents = []) {
    const nodeId = kind === "multi-agent-run" ? `${run.id}:multi-agent:${id}` : `${run.id}:multi-agent:${kind.replace("agent-", "")}:${id}`;
    (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: nodeId,
        kind,
        status,
        loopStage: run.loopStage,
        outputs: metadata,
        artifacts: [{ id: kind, kind: "json", path: rt.recordPath(run, rt.pluralKind(kind), id) }],
        parents,
        contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata,
    }));
}
function now() {
    return new Date().toISOString();
}
function createMultiAgentRun(run, input = {}) {
    ensureMultiAgentState(run);
    const record = rt.createMultiAgentRun(run, input, now());
    appendMultiAgentNode(run, "multi-agent-run", record.id, rt.statusToNodeStatus(record.status), { title: record.title, objective: record.objective, phase: record.links.phase });
    (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "multi-agent.run", decision: "recorded", source: "runtime-derived", multiAgentRunId: record.id, metadata: { status: record.status, objective: record.objective } });
    persistMultiAgentState(run);
    return record;
}
function transitionMultiAgentRun(run, multiAgentRunId, status, options = {}) {
    ensureMultiAgentState(run);
    const before = rt.requireMultiAgentRun(run, multiAgentRunId).status;
    const record = rt.transitionMultiAgentRun(run, multiAgentRunId, status, options, now());
    appendMultiAgentNode(run, "multi-agent-run", record.id, rt.statusToNodeStatus(status), { status, reason: options.reason });
    (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "multi-agent.lifecycle", decision: status === "failed" ? "failed" : "validated", source: "cw-validated", multiAgentRunId: record.id, metadata: { from: before, to: status, reason: options.reason } });
    persistMultiAgentState(run);
    return record;
}
function createAgentRole(run, input) {
    ensureMultiAgentState(run);
    const role = rt.createAgentRole(run, input, now(), trust_policy_1.policyForRole);
    appendMultiAgentNode(run, "agent-role", role.id, "pending", { multiAgentRunId: role.multiAgentRunId, title: role.title, responsibilities: role.responsibilities, requiredEvidence: role.requiredEvidence }, [`${run.id}:multi-agent:${role.multiAgentRunId}`]);
    (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "multi-agent.role", decision: "recorded", source: "runtime-derived", multiAgentRunId: role.multiAgentRunId, agentRoleId: role.id, metadata: { responsibilities: role.responsibilities, requiredEvidence: role.requiredEvidence, sandboxProfileHints: role.sandboxProfileHints, faninObligations: role.faninObligations } });
    (0, trust_policy_io_1.recordRolePolicyAudit)(run, role);
    persistMultiAgentState(run);
    return role;
}
function createAgentGroup(run, input) {
    ensureMultiAgentState(run);
    const group = rt.createAgentGroup(run, input, now(), trust_policy_1.policyForGroup);
    appendMultiAgentNode(run, "agent-group", group.id, "running", { multiAgentRunId: group.multiAgentRunId, phase: group.phase, taskIds: group.taskIds }, [`${run.id}:multi-agent:${group.multiAgentRunId}`]);
    (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "multi-agent.group", decision: "recorded", source: "runtime-derived", multiAgentRunId: group.multiAgentRunId, agentGroupId: group.id, metadata: { phase: group.phase, taskIds: group.taskIds } });
    persistMultiAgentState(run);
    return group;
}
function workerExists(run) {
    return (workerId) => (run.workers || []).some((worker) => worker.id === workerId);
}
function attachWorkerMetadata(run, membership) {
    const workers = run.workers || [];
    const index = workers.findIndex((worker) => worker.id === membership.workerId);
    if (index < 0)
        return;
    const worker = workers[index];
    const multiAgent = { runId: membership.multiAgentRunId, groupId: membership.groupId, roleId: membership.roleId, membershipId: membership.id, fanoutId: membership.fanoutId };
    const updated = { ...worker, updatedAt: now(), multiAgent, metadata: { ...(worker.metadata || {}), multiAgent } };
    run.workers = workers.map((candidate) => (candidate.id === worker.id ? updated : candidate));
}
function assignAgentMembership(run, input) {
    ensureMultiAgentState(run);
    const membership = rt.assignAgentMembership(run, input, now(), trust_policy_1.policyForMembership, workerExists(run));
    if (membership.workerId)
        attachWorkerMetadata(run, membership);
    appendMultiAgentNode(run, "agent-membership", membership.id, rt.statusToNodeStatus(membership.status), { multiAgentRunId: membership.multiAgentRunId, groupId: membership.groupId, roleId: membership.roleId, taskId: membership.taskId, workerId: membership.workerId, dispatchId: membership.dispatchId, fanoutId: membership.fanoutId }, [`${run.id}:multi-agent:group:${membership.groupId}`, `${run.id}:multi-agent:role:${membership.roleId}`]);
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
        metadata: { status: membership.status, dispatchId: membership.dispatchId },
    });
    persistMultiAgentState(run);
    return membership;
}
function createAgentFanout(run, input) {
    ensureMultiAgentState(run);
    const fanout = rt.createAgentFanout(run, input, now());
    appendMultiAgentNode(run, "agent-fanout", fanout.id, "pending", { multiAgentRunId: fanout.multiAgentRunId, groupId: fanout.groupId, reason: fanout.reason, roleIds: fanout.roleIds, taskIds: fanout.taskIds, concurrencyLimit: fanout.concurrencyLimit, sandboxProfileChoices: fanout.sandboxProfileChoices }, [`${run.id}:multi-agent:group:${fanout.groupId}`]);
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.fanout",
        decision: "recorded",
        source: "runtime-derived",
        multiAgentRunId: fanout.multiAgentRunId,
        agentGroupId: fanout.groupId,
        agentFanoutId: fanout.id,
        metadata: { reason: fanout.reason, roleIds: fanout.roleIds, taskIds: fanout.taskIds, concurrencyLimit: fanout.concurrencyLimit, sandboxProfileChoices: fanout.sandboxProfileChoices },
    });
    persistMultiAgentState(run);
    return fanout;
}
function attachDispatchToMultiAgent(run, input) {
    const result = rt.attachDispatchToMultiAgent(run, input, now(), trust_policy_1.policyForMembership, workerExists(run));
    if (!result.multiAgent)
        return result;
    ensureMultiAgentState(run);
    // Mirror each task's freshly-set multiAgent attachment onto its durable
    // worker scope so worker.json (read by `cw worker show`/operators) and the
    // manifest both carry the run/group/role/membership/fanout linkage. The
    // core set it on the task; the scope is the shell-owned durable copy. Byte-
    // behavior port of the old build's dispatch attach (scope.multiAgent).
    for (const task of input.tasks) {
        const attachment = task.multiAgent;
        if (!attachment || !task.workerId)
            continue;
        const scope = (0, worker_isolation_1.getWorkerScope)(run, String(task.workerId));
        if (!scope)
            continue;
        scope.multiAgent = attachment;
        // Persist the durable worker.json overlay so `cw worker show` / a
        // reloaded run carries the attachment (the scope object is written at
        // allocation time, BEFORE this attach step runs).
        (0, fs_atomic_1.writeJson)(path.join(scope.workerDir, "worker.json"), scope);
    }
    const fanout = rt.requireAgentFanout(run, result.multiAgent.fanoutId);
    appendMultiAgentNode(run, "agent-fanout", fanout.id, "running", { status: fanout.status, dispatchIds: fanout.dispatchIds, workerIds: fanout.workerIds, membershipIds: fanout.membershipIds }, [`${run.id}:dispatch:${input.dispatchId}`]);
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.fanout.dispatch",
        decision: "validated",
        source: "cw-validated",
        multiAgentRunId: result.multiAgent.runId,
        agentRoleId: result.multiAgent.roleId,
        agentGroupId: result.multiAgent.groupId,
        agentFanoutId: fanout.id,
        metadata: { dispatchId: input.dispatchId, membershipIds: result.membershipIds, workerIds: fanout.workerIds },
    });
    persistMultiAgentState(run);
    return result;
}
function collectAgentFanin(run, input) {
    ensureMultiAgentState(run);
    const fanin = rt.collectAgentFanin(run, input, now());
    appendMultiAgentNode(run, "agent-fanin", fanin.id, fanin.verifierReady ? "verified" : "blocked", { multiAgentRunId: fanin.multiAgentRunId, groupId: fanin.groupId, fanoutId: fanin.fanoutId, requiredRoleIds: fanin.requiredRoleIds, missingRoleIds: fanin.missingRoleIds, missingMembershipIds: fanin.missingMembershipIds, verifierReady: fanin.verifierReady }, [`${run.id}:multi-agent:group:${fanin.groupId}`, ...(fanin.fanoutId ? [`${run.id}:multi-agent:fanout:${fanin.fanoutId}`] : []), ...fanin.evidenceCoverage.map((entry) => `${run.id}:multi-agent:membership:${entry.membershipId}`)]);
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "multi-agent.fanin",
        decision: fanin.verifierReady ? "validated" : "failed",
        source: "cw-validated",
        multiAgentRunId: fanin.multiAgentRunId,
        agentGroupId: fanin.groupId,
        agentFanoutId: fanin.fanoutId,
        agentFaninId: fanin.id,
        evidenceRefs: fanin.evidenceCoverage.flatMap((entry) => entry.evidenceRefs),
        metadata: { verifierReady: fanin.verifierReady, requiredRoleIds: fanin.requiredRoleIds, missingRoleIds: fanin.missingRoleIds, missingMembershipIds: fanin.missingMembershipIds, blockedReasons: fanin.blockedReasons },
    });
    persistMultiAgentState(run);
    return fanin;
}
/** Publish a board-linked worker's accepted output to the blackboard: one
 *  artifact ref (kind `worker-result`) plus one message, both scoped to the
 *  membership's first topic. Returns the created ids, or undefined when the
 *  worker's membership is not board-linked (no blackboardId/topicIds). Port
 *  of the old worker-accept/blackboard-fanout.ts publishWorkerOutputToBlackboard. */
function indexWorkerOutputToBlackboard(run, input) {
    const state = ensureMultiAgentState(run);
    const membership = state.memberships.find((entry) => entry.workerId === input.workerId && entry.taskId === input.taskId);
    if (!membership || !membership.blackboardId || !membership.topicIds.length)
        return undefined;
    // Idempotency: a re-run of `worker output` for the same worker/task must not
    // index the evidence twice (the old accept path ran once per acceptance).
    if ((membership.blackboardArtifactRefIds || []).length || (membership.blackboardMessageIds || []).length)
        return undefined;
    const topicId = membership.topicIds[0];
    const evidenceRefs = input.evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean);
    // The worker-output accept path (worker-isolation.ts) does not thread the
    // on-disk result path down to us, so derive the artifact's locator from the
    // best evidence pointer (a real file locator/path) or fall back to the
    // result state node id — addBlackboardArtifact requires a path OR locator.
    const primaryPath = (input.artifactPaths && input.artifactPaths[0]) || undefined;
    const primaryLocator = input.evidence.map((entry) => entry.locator || entry.path).find(Boolean) || input.resultNodeId;
    const links = {
        multiAgentRunId: membership.multiAgentRunId,
        agentGroupId: membership.groupId,
        agentRoleId: membership.roleId,
        agentMembershipId: membership.id,
        agentFanoutId: membership.fanoutId,
        taskId: membership.taskId,
        workerId: membership.workerId,
    };
    const artifact = (0, coordinator_io_1.addBlackboardArtifact)(run, {
        topicId,
        blackboardId: membership.blackboardId,
        kind: "worker-result",
        path: primaryPath,
        locator: primaryPath ? undefined : primaryLocator,
        owner: { kind: "worker", id: String(membership.workerId) },
        author: { kind: "runtime", id: "cw" },
        scope: { kind: "worker", id: String(membership.workerId) },
        source: "cw-validated-worker-output",
        provenance: links,
        evidenceRefs,
        links,
    });
    const message = (0, coordinator_io_1.postBlackboardMessage)(run, {
        topicId,
        blackboardId: membership.blackboardId,
        body: `Worker ${membership.workerId} reported output for ${membership.roleId}.`,
        author: { kind: "worker", id: String(membership.workerId) },
        scope: { kind: "worker", id: String(membership.workerId) },
        artifactRefIds: [artifact.id],
        evidenceRefs,
        links,
        metadata: { taskId: membership.taskId },
    });
    return { messageIds: [message.id], artifactRefIds: [artifact.id] };
}
function recordMultiAgentWorkerOutput(run, input) {
    ensureMultiAgentState(run);
    // Auto-index a board-linked worker's accepted output into the blackboard
    // (one artifact ref + one message per membership on a board), then thread
    // those ids into the kernel so the membership carries
    // blackboardArtifactRefIds/blackboardMessageIds and a board-scoped fanin
    // (requiresBlackboardEvidence) can see the evidence as indexed. Byte-behavior
    // port of the old build's worker-accept/blackboard-fanout.ts fanOut step,
    // which v2's forbidden worker-isolation accept path dropped.
    const boardLinks = indexWorkerOutputToBlackboard(run, input);
    const enrichedInput = boardLinks
        ? {
            ...input,
            blackboardMessageIds: [...(input.blackboardMessageIds || []), ...boardLinks.messageIds],
            blackboardArtifactRefIds: [...(input.blackboardArtifactRefIds || []), ...boardLinks.artifactRefIds],
        }
        : input;
    const memberships = rt.recordMultiAgentWorkerOutput(run, enrichedInput, now());
    for (const membership of memberships) {
        appendMultiAgentNode(run, "agent-membership", membership.id, "completed", { resultNodeId: membership.resultNodeId, verifierNodeId: membership.verifierNodeId, evidenceRefs: membership.evidenceRefs }, [membership.resultNodeId, membership.verifierNodeId].filter(Boolean));
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
            metadata: { verifierNodeId: input.verifierNodeId },
        });
    }
    if (memberships.length)
        persistMultiAgentState(run);
    return memberships;
}
exports.summarizeMultiAgent = rt.summarizeMultiAgent;
exports.buildMultiAgentGraph = rt.buildMultiAgentGraph;
exports.getMultiAgentRun = rt.getMultiAgentRun;
exports.getAgentRole = rt.getAgentRole;
exports.getAgentGroup = rt.getAgentGroup;
exports.getAgentMembership = rt.getAgentMembership;
exports.getAgentFanout = rt.getAgentFanout;
exports.getAgentFanin = rt.getAgentFanin;
