"use strict";
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
exports.createMultiAgentRun = createMultiAgentRun;
exports.transitionMultiAgentRun = transitionMultiAgentRun;
exports.createAgentRole = createAgentRole;
exports.createAgentGroup = createAgentGroup;
exports.assignAgentMembership = assignAgentMembership;
exports.createAgentFanout = createAgentFanout;
exports.collectAgentFanin = collectAgentFanin;
exports.showMultiAgentRun = showMultiAgentRun;
exports.showAgentRole = showAgentRole;
exports.showAgentGroup = showAgentGroup;
exports.showAgentMembership = showAgentMembership;
exports.showAgentFanout = showAgentFanout;
exports.showAgentFanin = showAgentFanin;
exports.blackboardSummary = blackboardSummary;
exports.blackboardGraph = blackboardGraph;
exports.resolveRunBlackboard = resolveRunBlackboard;
exports.createBlackboardTopic = createBlackboardTopic;
exports.postBlackboardMessage = postBlackboardMessage;
exports.listBlackboardMessages = listBlackboardMessages;
exports.putBlackboardContext = putBlackboardContext;
exports.addBlackboardArtifact = addBlackboardArtifact;
exports.listBlackboardArtifacts = listBlackboardArtifacts;
exports.snapshotBlackboard = snapshotBlackboard;
exports.recordCoordinatorDecision = recordCoordinatorDecision;
const state_1 = require("../state");
const report_1 = require("./report");
const cli_options_1 = require("./cli-options");
const ma = __importStar(require("../multi-agent"));
const cb = __importStar(require("../coordinator"));
function createMultiAgentRun(run, options = {}) {
    const record = ma.createMultiAgentRun(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        title: (0, cli_options_1.stringOption)(options.title),
        objective: (0, cli_options_1.stringOption)(options.objective || options.reason),
        parentMultiAgentRunId: (0, cli_options_1.stringOption)(options.parent || options.parentMultiAgentRunId),
        phase: (0, cli_options_1.stringOption)(options.phase),
        phaseId: (0, cli_options_1.stringOption)(options.phaseId),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function transitionMultiAgentRun(run, multiAgentRunId, options = {}) {
    const record = ma.transitionMultiAgentRun(run, multiAgentRunId, String(options.status || "running"), {
        reason: (0, cli_options_1.stringOption)(options.reason),
        actor: (0, cli_options_1.stringOption)(options.actor),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function createAgentRole(run, options = {}) {
    const record = ma.createAgentRole(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        multiAgentRunId: (0, cli_options_1.requiredStringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
        title: (0, cli_options_1.stringOption)(options.title),
        responsibilities: (0, cli_options_1.arrayOption)(options.responsibility || options.responsibilities).map(String),
        requiredEvidence: (0, cli_options_1.arrayOption)(options.requiredEvidence || options["required-evidence"]).map(String),
        sandboxProfileHints: (0, cli_options_1.arrayOption)(options.sandbox || options.sandboxProfile || options.sandboxProfileHint || options["sandbox-profile"]).map(String),
        expectedArtifacts: (0, cli_options_1.arrayOption)(options.expectedArtifact || options.expectedArtifacts || options["expected-artifact"]).map(String),
        faninObligations: (0, cli_options_1.arrayOption)(options.faninObligation || options.faninObligations || options["fanin-obligation"]).map(String),
        parentRoleId: (0, cli_options_1.stringOption)(options.parent || options.parentRoleId),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function createAgentGroup(run, options = {}) {
    const record = ma.createAgentGroup(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        multiAgentRunId: (0, cli_options_1.requiredStringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
        title: (0, cli_options_1.stringOption)(options.title),
        phase: (0, cli_options_1.stringOption)(options.phase),
        phaseId: (0, cli_options_1.stringOption)(options.phaseId),
        taskIds: (0, cli_options_1.arrayOption)(options.task || options.taskId || options.tasks).map(String),
        parentGroupId: (0, cli_options_1.stringOption)(options.parent || options.parentGroupId),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function assignAgentMembership(run, options = {}) {
    const record = ma.assignAgentMembership(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        groupId: (0, cli_options_1.requiredStringOption)(options.group || options.groupId || options["multi-agent-group"], "group id"),
        roleId: (0, cli_options_1.requiredStringOption)(options.role || options.roleId || options["multi-agent-role"], "role id"),
        taskId: (0, cli_options_1.requiredStringOption)(options.task || options.taskId, "task id"),
        workerId: (0, cli_options_1.stringOption)(options.worker || options.workerId),
        dispatchId: (0, cli_options_1.stringOption)(options.dispatch || options.dispatchId),
        fanoutId: (0, cli_options_1.stringOption)(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
        status: (0, cli_options_1.stringOption)(options.status),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function createAgentFanout(run, options = {}) {
    const record = ma.createAgentFanout(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        groupId: (0, cli_options_1.requiredStringOption)(options.group || options.groupId || options["multi-agent-group"], "group id"),
        reason: (0, cli_options_1.stringOption)(options.reason) || "work split",
        roleIds: (0, cli_options_1.arrayOption)(options.role || options.roleId || options.roles).map(String),
        taskIds: (0, cli_options_1.arrayOption)(options.task || options.taskId || options.tasks).map(String),
        workerIds: (0, cli_options_1.arrayOption)(options.worker || options.workerId || options.workers).map(String),
        membershipIds: (0, cli_options_1.arrayOption)(options.membership || options.membershipId || options.memberships).map(String),
        dispatchIds: (0, cli_options_1.arrayOption)(options.dispatch || options.dispatchId || options.dispatches).map(String),
        concurrencyLimit: (0, cli_options_1.numberOption)(options.limit || options.concurrency || options.concurrencyLimit),
        sandboxProfileChoices: (0, cli_options_1.parseSandboxChoices)(options),
        expectedReturnShape: (0, cli_options_1.stringOption)(options.expectedReturnShape || options["expected-return-shape"]),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function collectAgentFanin(run, options = {}) {
    const record = ma.collectAgentFanin(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        groupId: (0, cli_options_1.stringOption)(options.group || options.groupId || options["multi-agent-group"]),
        fanoutId: (0, cli_options_1.stringOption)(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
        requiredRoleIds: (0, cli_options_1.arrayOption)(options.requiredRole || options.requiredRoleId || options["required-role"]).map(String),
        strategy: (0, cli_options_1.stringOption)(options.strategy),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return record;
}
function showMultiAgentRun(run, multiAgentRunId) {
    const record = ma.getMultiAgentRun(run, multiAgentRunId);
    if (!record)
        throw new Error(`Unknown MultiAgentRun id for run ${run.id}: ${multiAgentRunId}`);
    return record;
}
function showAgentRole(run, roleId) {
    const record = ma.getAgentRole(run, roleId);
    if (!record)
        throw new Error(`Unknown AgentRole id for run ${run.id}: ${roleId}`);
    return record;
}
function showAgentGroup(run, groupId) {
    const record = ma.getAgentGroup(run, groupId);
    if (!record)
        throw new Error(`Unknown AgentGroup id for run ${run.id}: ${groupId}`);
    return record;
}
function showAgentMembership(run, membershipId) {
    const record = ma.getAgentMembership(run, membershipId);
    if (!record)
        throw new Error(`Unknown AgentMembership id for run ${run.id}: ${membershipId}`);
    return record;
}
function showAgentFanout(run, fanoutId) {
    const record = ma.getAgentFanout(run, fanoutId);
    if (!record)
        throw new Error(`Unknown AgentFanout id for run ${run.id}: ${fanoutId}`);
    return record;
}
function showAgentFanin(run, faninId) {
    const record = ma.getAgentFanin(run, faninId);
    if (!record)
        throw new Error(`Unknown AgentFanin id for run ${run.id}: ${faninId}`);
    return record;
}
function blackboardSummary(run, options = {}) {
    return cb.summarizeBlackboard(run, (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId));
}
function blackboardGraph(run) {
    return cb.buildBlackboardGraph(run);
}
function resolveRunBlackboard(run, options = {}) {
    const board = cb.resolveBlackboard(run, {
        id: (0, cli_options_1.stringOption)(options.id || options.blackboard || options.blackboardId),
        title: (0, cli_options_1.stringOption)(options.title),
        multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        groupId: (0, cli_options_1.stringOption)(options.group || options.groupId || options["multi-agent-group"]),
        roleId: (0, cli_options_1.stringOption)(options.role || options.roleId || options["multi-agent-role"]),
        membershipId: (0, cli_options_1.stringOption)(options.membership || options.membershipId || options["multi-agent-membership"]),
        author: (0, cli_options_1.parseBlackboardAuthor)(options),
        scope: (0, cli_options_1.parseBlackboardScope)(options),
        tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return board;
}
function createBlackboardTopic(run, options = {}) {
    const topic = cb.createBlackboardTopic(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        title: (0, cli_options_1.requiredStringOption)(options.title, "topic title"),
        description: (0, cli_options_1.stringOption)(options.description),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        author: (0, cli_options_1.parseBlackboardAuthor)(options),
        scope: (0, cli_options_1.parseBlackboardScope)(options),
        tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return topic;
}
function postBlackboardMessage(run, options = {}) {
    const message = cb.postBlackboardMessage(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        topicId: (0, cli_options_1.requiredStringOption)(options.topic || options.topicId, "topic id"),
        body: (0, cli_options_1.requiredStringOption)(options.body || options.message, "message body"),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        replyToId: (0, cli_options_1.stringOption)(options.replyTo || options.replyToId || options.parent),
        visibility: (0, cli_options_1.stringOption)(options.visibility),
        author: (0, cli_options_1.parseBlackboardAuthor)(options),
        scope: (0, cli_options_1.parseBlackboardScope)(options),
        evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
        artifactRefIds: (0, cli_options_1.arrayOption)(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
        auditEventIds: (0, cli_options_1.arrayOption)(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
        parentIds: (0, cli_options_1.arrayOption)(options.parentId || options.parentIds).map(String),
        tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return message;
}
function listBlackboardMessages(run, options = {}) {
    return cb.listBlackboardMessages(run, {
        topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId)
    });
}
function putBlackboardContext(run, options = {}) {
    const context = cb.putBlackboardContext(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        topicId: (0, cli_options_1.requiredStringOption)(options.topic || options.topicId, "topic id"),
        kind: (0, cli_options_1.requiredStringOption)(options.kind, "context kind"),
        key: (0, cli_options_1.stringOption)(options.key),
        value: (0, cli_options_1.requiredStringOption)(options.value || options.body, "context value"),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        supersedesContextIds: (0, cli_options_1.arrayOption)(options.supersedes || options.supersedesContext || options.supersedesContextId).map(String),
        author: (0, cli_options_1.parseBlackboardAuthor)(options),
        scope: (0, cli_options_1.parseBlackboardScope)(options),
        evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
        artifactRefIds: (0, cli_options_1.arrayOption)(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
        parentIds: (0, cli_options_1.arrayOption)(options.parent || options.parentId || options.parentIds).map(String),
        tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return context;
}
function addBlackboardArtifact(run, options = {}) {
    const artifact = cb.addBlackboardArtifact(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
        kind: (0, cli_options_1.requiredStringOption)(options.kind, "artifact kind"),
        path: (0, cli_options_1.stringOption)(options.path),
        locator: (0, cli_options_1.stringOption)(options.locator),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        owner: (0, cli_options_1.parseBlackboardAuthor)({ ...options, authorKind: options.ownerKind || options.authorKind, authorId: options.owner || options.ownerId || options.authorId }),
        author: (0, cli_options_1.parseBlackboardAuthor)(options),
        scope: (0, cli_options_1.parseBlackboardScope)(options),
        source: (0, cli_options_1.stringOption)(options.source),
        provenance: (0, cli_options_1.parseBlackboardLinks)(run.id, options),
        evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
        auditEventIds: (0, cli_options_1.arrayOption)(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
        parentIds: (0, cli_options_1.arrayOption)(options.parent || options.parentId || options.parentIds).map(String),
        tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return artifact;
}
function listBlackboardArtifacts(run, options = {}) {
    return cb.listBlackboardArtifacts(run, {
        topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId)
    });
}
function snapshotBlackboard(run, options = {}) {
    const snapshot = cb.createBlackboardSnapshot(run, (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId));
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return snapshot;
}
function recordCoordinatorDecision(run, options = {}) {
    const decision = cb.recordCoordinatorDecision(run, {
        id: (0, cli_options_1.stringOption)(options.id),
        blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
        kind: (0, cli_options_1.requiredStringOption)(options.kind, "decision kind"),
        outcome: (0, cli_options_1.requiredStringOption)(options.outcome, "decision outcome"),
        reason: (0, cli_options_1.requiredStringOption)(options.reason, "decision reason"),
        subjectIds: (0, cli_options_1.arrayOption)(options.subject || options.subjectId || options.subjectIds).map(String),
        topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
        author: (0, cli_options_1.parseBlackboardAuthor)({ ...options, authorKind: options.authorKind || "coordinator", authorId: options.authorId || "cw" }),
        scope: (0, cli_options_1.parseBlackboardScope)(options),
        evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
        artifactRefIds: (0, cli_options_1.arrayOption)(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
        messageIds: (0, cli_options_1.arrayOption)(options.message || options.messageId || options.messageIds).map(String),
        parentIds: (0, cli_options_1.arrayOption)(options.parent || options.parentId || options.parentIds).map(String),
        tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
        metadata: (0, cli_options_1.metadataOption)(options)
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return decision;
}
