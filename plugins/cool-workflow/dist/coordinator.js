"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLACKBOARD_SCHEMA_VERSION = void 0;
exports.ensureBlackboardState = ensureBlackboardState;
exports.resolveBlackboard = resolveBlackboard;
exports.createBlackboardTopic = createBlackboardTopic;
exports.postBlackboardMessage = postBlackboardMessage;
exports.putBlackboardContext = putBlackboardContext;
exports.addBlackboardArtifact = addBlackboardArtifact;
exports.createBlackboardSnapshot = createBlackboardSnapshot;
exports.recordCoordinatorDecision = recordCoordinatorDecision;
exports.summarizeBlackboard = summarizeBlackboard;
exports.listBlackboardMessages = listBlackboardMessages;
exports.listBlackboardArtifacts = listBlackboardArtifacts;
exports.buildBlackboardGraph = buildBlackboardGraph;
exports.persistBlackboardState = persistBlackboardState;
exports.bridgeStateArtifactToBlackboard = bridgeStateArtifactToBlackboard;
exports.evidenceFromArtifactRef = evidenceFromArtifactRef;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pipeline_contract_1 = require("./pipeline-contract");
const state_1 = require("./state");
const state_node_1 = require("./state-node");
const multi_agent_1 = require("./multi-agent");
const trust_audit_1 = require("./trust-audit");
const multi_agent_trust_1 = require("./multi-agent-trust");
const util_1 = require("./coordinator/util");
const classify_1 = require("./coordinator/classify");
const paths_1 = require("./coordinator/paths");
// NOTE: the symbols imported above from ./coordinator/{util,classify,paths} were
// PRIVATE helpers inside this module before the carve (no importer reaches them,
// including the `import * as cb` consumer in orchestrator/multi-agent-operations).
// They are relocated as pure code movement — zero signature/behavior change — and
// imported back for internal use only, so this module's PUBLIC surface stays
// byte-identical (no new exports). The public exported functions below are
// unchanged.
exports.BLACKBOARD_SCHEMA_VERSION = 1;
function ensureBlackboardState(run) {
    run.paths.blackboardDir = (0, paths_1.blackboardRoot)(run);
    node_fs_1.default.mkdirSync(run.paths.blackboardDir, { recursive: true });
    for (const dir of ["topics", "contexts", "artifacts", "snapshots", "decisions"]) {
        node_fs_1.default.mkdirSync(node_path_1.default.join(run.paths.blackboardDir, dir), { recursive: true });
    }
    if (!run.blackboard) {
        run.blackboard = emptyState();
    }
    run.blackboard.schemaVersion = exports.BLACKBOARD_SCHEMA_VERSION;
    run.blackboard.boards = run.blackboard.boards || [];
    run.blackboard.topics = run.blackboard.topics || [];
    run.blackboard.messages = run.blackboard.messages || [];
    run.blackboard.contexts = run.blackboard.contexts || [];
    run.blackboard.artifacts = run.blackboard.artifacts || [];
    run.blackboard.snapshots = run.blackboard.snapshots || [];
    run.blackboard.decisions = run.blackboard.decisions || [];
    return run.blackboard;
}
function resolveBlackboard(run, input = {}) {
    const state = ensureBlackboardState(run);
    const existing = input.id
        ? state.boards.find((board) => board.id === input.id)
        : input.multiAgentRunId
            ? state.boards.find((board) => board.links.multiAgentRunId === input.multiAgentRunId)
            : state.boards[0];
    if (existing) {
        linkMultiAgent(run, existing.id, existing.topicIds, input);
        (0, util_1.touch)(existing);
        persistBlackboardState(run);
        return existing;
    }
    const id = input.id || (0, util_1.createId)("bb", state.boards.length + 1);
    (0, util_1.assertUnique)(state.boards, id, "Blackboard");
    const now = (0, util_1.timestamp)();
    const author = normalizeAuthor(input.author, "runtime");
    const scope = normalizeScope(input.scope, input.multiAgentRunId ? { kind: "multi-agent-run", id: input.multiAgentRunId } : { kind: "run", id: run.id });
    const board = {
        schemaVersion: exports.BLACKBOARD_SCHEMA_VERSION,
        id,
        runId: run.id,
        createdAt: now,
        updatedAt: now,
        author,
        scope,
        status: "active",
        parentIds: [],
        tags: (0, util_1.sortTags)(input.tags),
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
        paths: (0, paths_1.boardPaths)(run),
        metadata: (0, util_1.scrub)(input.metadata)
    };
    linkMultiAgent(run, board.id, [], input);
    state.boards.push(board);
    appendBlackboardNode(run, "blackboard", board.id, "running", board.title, board.paths.index);
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
function createBlackboardTopic(run, input) {
    const board = resolveBlackboard(run, { id: input.blackboardId });
    const state = ensureBlackboardState(run);
    const id = input.id || (0, util_1.createId)("topic", state.topics.length + 1);
    (0, util_1.assertUnique)(state.topics, id, "BlackboardTopic");
    const topicLinks = compactLinks(run, { ...board.links, ...roleLinkFromAuthor(input.author), ...input.scope });
    const now = (0, util_1.timestamp)();
    const topic = {
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
    board.topicIds = (0, util_1.unique)([...board.topicIds, topic.id]);
    (0, util_1.touch)(board);
    linkMultiAgent(run, board.id, [topic.id], board.links);
    appendBlackboardNode(run, "blackboard-topic", topic.id, "running", topic.title, (0, paths_1.recordPath)(run, "topics", topic.id), [`${run.id}:blackboard:${board.id}`]);
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
    topic.links.auditEventIds = (0, util_1.unique)([...(topic.links.auditEventIds || []), audit.id]);
    (0, multi_agent_trust_1.recordBlackboardWriteAudit)(run, {
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
function postBlackboardMessage(run, input) {
    const state = ensureBlackboardState(run);
    const topic = requireTopic(run, input.topicId);
    const board = requireBoard(run, input.blackboardId || topic.blackboardId);
    if (input.replyToId && !state.messages.some((message) => message.id === input.replyToId)) {
        throw new Error(`Unknown parent BlackboardMessage id: ${input.replyToId}`);
    }
    if (!input.body.trim())
        throw new Error("Blackboard message body is required");
    const id = input.id || (0, util_1.createId)("msg", state.messages.length + 1);
    (0, util_1.assertUnique)(state.messages, id, "BlackboardMessage");
    const author = normalizeAuthor(input.author, "operator");
    const links = compactLinks(run, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
    const enforcePolicy = shouldEnforcePolicy(author, links);
    const permission = enforcePolicy
        ? (0, multi_agent_trust_1.assertMultiAgentActionAllowed)(run, {
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
    const message = {
        ...base(run, board.id, id, author, input.scope, "active", input.tags, input.metadata),
        topicId: topic.id,
        body: input.body,
        visibility: input.visibility || "public",
        replyToId: input.replyToId,
        parentIds: (0, util_1.unique)([...(input.parentIds || []), ...(input.replyToId ? [input.replyToId] : [])]),
        linkedEvidenceRefs: (0, util_1.unique)(input.evidenceRefs || []),
        linkedArtifactRefIds: requireArtifactRefs(run, input.artifactRefIds || []),
        linkedAuditEventIds: (0, util_1.unique)(input.auditEventIds || []),
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
            source: (0, multi_agent_trust_1.sourceForActor)(author),
            linkedEvidenceRefs: (0, util_1.unique)(input.evidenceRefs || []),
            linkedAuditEventIds: (0, util_1.unique)(input.auditEventIds || []),
            parentMessageIds: (0, util_1.unique)([...(input.parentIds || []), ...(input.replyToId ? [input.replyToId] : [])]),
            topicScope: topic.id,
            bodyHash: (0, multi_agent_trust_1.hashText)(input.body),
            locator: `${board.id}/messages/${id}`
        }
    };
    state.messages.push(message);
    topic.messageIds = (0, util_1.unique)([...topic.messageIds, message.id]);
    board.messageCount = state.messages.filter((entry) => entry.blackboardId === board.id).length;
    (0, util_1.touch)(topic);
    (0, util_1.touch)(board);
    appendBlackboardNode(run, "blackboard-message", message.id, "completed", (0, util_1.truncate)(message.body), (0, paths_1.messagesPath)(run), [`${run.id}:blackboard:topic:${topic.id}`]);
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "blackboard.message",
        decision: "recorded",
        source: (0, classify_1.sourceForAuthor)(message.author),
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
    const writeAudit = (0, multi_agent_trust_1.recordBlackboardWriteAudit)(run, {
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
        parentEventIds: (0, util_1.unique)([...(permission ? [permission.event.id] : []), audit.id]),
        policyRef: permission?.policyRef,
        metadata: { visibility: message.visibility }
    });
    const provenanceAudit = (0, multi_agent_trust_1.recordMessageProvenanceAudit)(run, {
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
        const rationaleAudit = (0, multi_agent_trust_1.recordJudgeRationaleAudit)(run, {
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
        message.linkedAuditEventIds = (0, util_1.unique)([...message.linkedAuditEventIds, rationaleAudit.id]);
    }
    message.linkedAuditEventIds = (0, util_1.unique)([...message.linkedAuditEventIds, audit.id, writeAudit.id, provenanceAudit.id]);
    message.links.auditEventIds = (0, util_1.unique)([...(message.links.auditEventIds || []), audit.id, writeAudit.id, provenanceAudit.id]);
    if (message.provenance) {
        message.provenance.linkedAuditEventIds = (0, util_1.unique)([...message.provenance.linkedAuditEventIds, audit.id, writeAudit.id, provenanceAudit.id]);
    }
    persistBlackboardState(run);
    return message;
}
function putBlackboardContext(run, input) {
    const state = ensureBlackboardState(run);
    const topic = requireTopic(run, input.topicId);
    const board = requireBoard(run, input.blackboardId || topic.blackboardId);
    const key = input.key || input.kind;
    const id = input.id || (0, util_1.createId)("ctx", state.contexts.length + 1);
    (0, util_1.assertUnique)(state.contexts, id, "BlackboardContext");
    const author = normalizeAuthor(input.author, "operator");
    const links = compactLinks(run, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs });
    const permission = shouldEnforcePolicy(author, links)
        ? (0, multi_agent_trust_1.assertMultiAgentActionAllowed)(run, {
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
    const conflicts = state.contexts.filter((context) => context.blackboardId === board.id &&
        context.topicId === topic.id &&
        context.kind === input.kind &&
        context.key === key &&
        context.status !== "superseded" &&
        !input.supersedesContextIds?.includes(context.id) &&
        context.value !== input.value);
    for (const supersededId of input.supersedesContextIds || []) {
        const superseded = requireContext(run, supersededId);
        superseded.status = "superseded";
        superseded.supersededByContextId = id;
        (0, util_1.touch)(superseded);
    }
    const status = conflicts.length ? "conflicting" : input.kind === "question" ? "open" : "active";
    const context = {
        ...base(run, board.id, id, author, input.scope, status, input.tags, input.metadata),
        topicId: topic.id,
        kind: input.kind,
        key,
        value: input.value,
        supersedesContextIds: (0, util_1.unique)(input.supersedesContextIds || []),
        conflictingContextIds: conflicts.map((entry) => entry.id),
        evidenceRefs: (0, util_1.unique)(input.evidenceRefs || []),
        artifactRefIds: requireArtifactRefs(run, input.artifactRefIds || []),
        links
    };
    for (const conflict of conflicts) {
        conflict.status = "conflicting";
        conflict.conflictingContextIds = (0, util_1.unique)([...conflict.conflictingContextIds, context.id]);
        (0, util_1.touch)(conflict);
    }
    state.contexts.push(context);
    topic.contextIds = (0, util_1.unique)([...topic.contextIds, context.id]);
    board.contextIds = (0, util_1.unique)([...board.contextIds, context.id]);
    (0, util_1.touch)(topic);
    (0, util_1.touch)(board);
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
    appendBlackboardNode(run, "blackboard-context", context.id, (0, classify_1.statusToNodeStatus)(context.status), `${context.kind}:${context.key}`, (0, paths_1.recordPath)(run, "contexts", context.id), [`${run.id}:blackboard:topic:${topic.id}`]);
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "blackboard.context",
        decision: conflicts.length ? "failed" : "accepted",
        source: (0, classify_1.sourceForAuthor)(context.author),
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
    const writeAudit = (0, multi_agent_trust_1.recordBlackboardWriteAudit)(run, {
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
        parentEventIds: (0, util_1.unique)([...(permission ? [permission.event.id] : []), audit.id]),
        policyRef: permission?.policyRef,
        metadata: { kind: context.kind, key: context.key, conflicts: context.conflictingContextIds }
    });
    context.links.auditEventIds = (0, util_1.unique)([...(context.links.auditEventIds || []), audit.id]);
    context.links.auditEventIds = (0, util_1.unique)([...(context.links.auditEventIds || []), writeAudit.id]);
    persistBlackboardState(run);
    return context;
}
function addBlackboardArtifact(run, input) {
    if (!input.path && !input.locator)
        throw new Error("Blackboard artifact requires --path or --locator");
    const state = ensureBlackboardState(run);
    const board = resolveBlackboard(run, { id: input.blackboardId });
    const topic = input.topicId ? requireTopic(run, input.topicId) : undefined;
    if (topic && topic.blackboardId !== board.id)
        throw new Error(`Topic ${topic.id} does not belong to blackboard ${board.id}`);
    const id = input.id || (0, util_1.createId)("artifact", state.artifacts.length + 1);
    (0, util_1.assertUnique)(state.artifacts, id, "BlackboardArtifactRef");
    const author = normalizeAuthor(input.author, "operator");
    const links = compactLinks(run, { ...board.links, ...(topic?.links || {}), ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
    const permission = shouldEnforcePolicy(author, links)
        ? (0, multi_agent_trust_1.assertMultiAgentActionAllowed)(run, {
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
    const absolutePath = input.path ? node_path_1.default.resolve(input.path) : undefined;
    const artifact = {
        ...base(run, board.id, id, author, input.scope, "active", input.tags, input.metadata),
        topicId: topic?.id,
        kind: input.kind,
        path: absolutePath,
        locator: input.locator,
        owner: normalizeAuthor(input.owner || input.author, "operator"),
        source: input.source || "operator-recorded",
        provenance: compactLinks(run, { ...(input.provenance || {}), ...links }),
        evidenceRefs: (0, util_1.unique)(input.evidenceRefs || []),
        checksum: absolutePath && node_fs_1.default.existsSync(absolutePath) && node_fs_1.default.statSync(absolutePath).isFile() ? (0, util_1.checksumFile)(absolutePath) : undefined,
        trustAuditEventIds: (0, util_1.unique)(input.auditEventIds || [])
    };
    state.artifacts.push(artifact);
    board.artifactRefIds = (0, util_1.unique)([...board.artifactRefIds, artifact.id]);
    if (topic)
        topic.artifactRefIds = (0, util_1.unique)([...topic.artifactRefIds, artifact.id]);
    (0, util_1.touch)(board);
    if (topic)
        (0, util_1.touch)(topic);
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
    appendBlackboardNode(run, "blackboard-artifact", artifact.id, "completed", artifact.kind, (0, paths_1.recordPath)(run, "artifacts", artifact.id), [
        topic ? `${run.id}:blackboard:topic:${topic.id}` : `${run.id}:blackboard:${board.id}`
    ]);
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "blackboard.artifact",
        decision: "accepted",
        source: (0, classify_1.sourceForAuthor)(artifact.author),
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
    const writeAudit = (0, multi_agent_trust_1.recordBlackboardWriteAudit)(run, {
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
        parentEventIds: (0, util_1.unique)([...(permission ? [permission.event.id] : []), audit.id]),
        policyRef: permission?.policyRef,
        metadata: { kind: artifact.kind, locator: artifact.locator, checksum: artifact.checksum }
    });
    artifact.trustAuditEventIds = (0, util_1.unique)([...artifact.trustAuditEventIds, audit.id, writeAudit.id]);
    persistBlackboardState(run);
    return artifact;
}
function createBlackboardSnapshot(run, blackboardId) {
    const state = ensureBlackboardState(run);
    const board = resolveBlackboard(run, { id: blackboardId });
    const id = (0, util_1.createId)("snapshot", state.snapshots.length + 1);
    const snapshotPath = (0, paths_1.recordPath)(run, "snapshots", id);
    const summary = summarizeBlackboard(run, board.id);
    const snapshot = {
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
    board.snapshotIds = (0, util_1.unique)([...board.snapshotIds, snapshot.id]);
    (0, util_1.touch)(board);
    appendBlackboardNode(run, "blackboard-snapshot", snapshot.id, "completed", snapshot.id, snapshotPath, [`${run.id}:blackboard:${board.id}`]);
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "blackboard.snapshot",
        decision: "recorded",
        source: "runtime-derived",
        actor: "cw",
        blackboardId: board.id,
        blackboardSnapshotId: snapshot.id,
        metadata: { snapshotPath, counts: summary }
    });
    const writeAudit = (0, multi_agent_trust_1.recordBlackboardWriteAudit)(run, {
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
    snapshot.links.auditEventIds = (0, util_1.unique)([...snapshot.links.auditEventIds, writeAudit.id]);
    persistBlackboardState(run);
    return snapshot;
}
function recordCoordinatorDecision(run, input) {
    const state = ensureBlackboardState(run);
    const board = resolveBlackboard(run, { id: input.blackboardId });
    const id = input.id || (0, util_1.createId)("decision", state.decisions.length + 1);
    (0, util_1.assertUnique)(state.decisions, id, "CoordinatorDecision");
    const decision = {
        ...base(run, board.id, id, input.author || { kind: "coordinator", id: "cw" }, input.scope, (0, classify_1.decisionStatus)(input.outcome), input.tags, input.metadata),
        kind: input.kind,
        outcome: input.outcome,
        subjectIds: (0, util_1.unique)(input.subjectIds || []),
        reason: input.reason,
        evidenceRefs: (0, util_1.unique)(input.evidenceRefs || []),
        artifactRefIds: requireArtifactRefs(run, input.artifactRefIds || []),
        messageIds: requireMessages(run, input.messageIds || []),
        links: compactLinks(run, { ...board.links, ...roleLinkFromAuthor(input.author), ...(input.links || {}), evidenceRefs: input.evidenceRefs })
    };
    state.decisions.push(decision);
    board.decisionIds = (0, util_1.unique)([...board.decisionIds, decision.id]);
    (0, util_1.touch)(board);
    appendBlackboardNode(run, "coordinator-decision", decision.id, (0, classify_1.statusToNodeStatus)(decision.status), `${decision.kind}:${decision.outcome}`, (0, paths_1.recordPath)(run, "decisions", decision.id), [
        `${run.id}:blackboard:${board.id}`,
        ...(input.topicId ? [`${run.id}:blackboard:topic:${input.topicId}`] : [])
    ]);
    const audit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "coordinator.decision",
        decision: (0, classify_1.auditDecision)(input.outcome),
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
    const writeAudit = (0, multi_agent_trust_1.recordBlackboardWriteAudit)(run, {
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
        const panelAudit = (0, multi_agent_trust_1.recordJudgeRationaleAudit)(run, {
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
        decision.links.auditEventIds = (0, util_1.unique)([...(decision.links.auditEventIds || []), panelAudit.id]);
    }
    decision.links.auditEventIds = (0, util_1.unique)([...(decision.links.auditEventIds || []), audit.id, writeAudit.id]);
    persistBlackboardState(run);
    return decision;
}
function summarizeBlackboard(run, blackboardId) {
    const state = ensureBlackboardState(run);
    const board = blackboardId ? state.boards.find((entry) => entry.id === blackboardId) : state.boards[0];
    const scoped = (items) => board ? items.filter((item) => item.blackboardId === board.id) : [];
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
        indexPath: board?.paths.index || node_path_1.default.join((0, paths_1.blackboardRoot)(run), "index.json"),
        nextAction: nextAction(run, board, openQuestions, conflicts, artifacts)
    };
}
function listBlackboardMessages(run, options = {}) {
    const state = ensureBlackboardState(run);
    return state.messages
        .filter((message) => (!options.blackboardId || message.blackboardId === options.blackboardId) && (!options.topicId || message.topicId === options.topicId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
function listBlackboardArtifacts(run, options = {}) {
    const state = ensureBlackboardState(run);
    return state.artifacts
        .filter((artifact) => (!options.blackboardId || artifact.blackboardId === options.blackboardId) && (!options.topicId || artifact.topicId === options.topicId))
        .sort((left, right) => left.id.localeCompare(right.id));
}
function buildBlackboardGraph(run) {
    const state = ensureBlackboardState(run);
    const nodes = [];
    const edges = [];
    for (const board of state.boards) {
        nodes.push({ id: `${run.id}:blackboard:${board.id}`, kind: "blackboard", status: board.status, label: board.title, path: board.paths.index });
        edges.push({ from: `${run.id}:run`, to: `${run.id}:blackboard:${board.id}` });
        if (board.links.multiAgentRunId)
            edges.push({ from: `${run.id}:multi-agent:${board.links.multiAgentRunId}`, to: `${run.id}:blackboard:${board.id}`, label: "coordinates" });
    }
    for (const topic of state.topics) {
        nodes.push({ id: `${run.id}:blackboard:topic:${topic.id}`, kind: "blackboard-topic", status: topic.status, label: topic.title, path: (0, paths_1.recordPath)(run, "topics", topic.id) });
        edges.push({ from: `${run.id}:blackboard:${topic.blackboardId}`, to: `${run.id}:blackboard:topic:${topic.id}` });
    }
    for (const context of state.contexts) {
        nodes.push({ id: `${run.id}:blackboard:context:${context.id}`, kind: "blackboard-context", status: context.status, label: `${context.kind}:${context.key}`, path: (0, paths_1.recordPath)(run, "contexts", context.id) });
        edges.push({ from: `${run.id}:blackboard:topic:${context.topicId}`, to: `${run.id}:blackboard:context:${context.id}` });
        for (const conflicting of context.conflictingContextIds)
            edges.push({ from: `${run.id}:blackboard:context:${context.id}`, to: `${run.id}:blackboard:context:${conflicting}`, label: "conflicts" });
    }
    for (const artifact of state.artifacts) {
        nodes.push({ id: `${run.id}:blackboard:artifact:${artifact.id}`, kind: "blackboard-artifact", status: artifact.status, label: artifact.kind, path: (0, paths_1.recordPath)(run, "artifacts", artifact.id) });
        edges.push({ from: artifact.topicId ? `${run.id}:blackboard:topic:${artifact.topicId}` : `${run.id}:blackboard:${artifact.blackboardId}`, to: `${run.id}:blackboard:artifact:${artifact.id}` });
    }
    for (const message of state.messages) {
        nodes.push({ id: `${run.id}:blackboard:message:${message.id}`, kind: "blackboard-message", status: message.status, label: (0, util_1.truncate)(message.body), path: (0, paths_1.messagesPath)(run) });
        edges.push({ from: `${run.id}:blackboard:topic:${message.topicId}`, to: `${run.id}:blackboard:message:${message.id}` });
        if (message.replyToId)
            edges.push({ from: `${run.id}:blackboard:message:${message.replyToId}`, to: `${run.id}:blackboard:message:${message.id}`, label: "reply" });
        for (const artifactId of message.linkedArtifactRefIds)
            edges.push({ from: `${run.id}:blackboard:message:${message.id}`, to: `${run.id}:blackboard:artifact:${artifactId}`, label: "cites" });
    }
    for (const decision of state.decisions) {
        nodes.push({ id: `${run.id}:coordinator:decision:${decision.id}`, kind: "coordinator-decision", status: decision.status, label: `${decision.kind}:${decision.outcome}`, path: (0, paths_1.recordPath)(run, "decisions", decision.id) });
        edges.push({ from: `${run.id}:blackboard:${decision.blackboardId}`, to: `${run.id}:coordinator:decision:${decision.id}` });
        for (const subjectId of decision.subjectIds)
            edges.push({ from: `${run.id}:coordinator:decision:${decision.id}`, to: graphSubject(run, subjectId), label: "subject" });
    }
    for (const snapshot of state.snapshots) {
        nodes.push({ id: `${run.id}:blackboard:snapshot:${snapshot.id}`, kind: "blackboard-snapshot", status: snapshot.status, label: snapshot.id, path: snapshot.snapshotPath });
        edges.push({ from: `${run.id}:blackboard:${snapshot.blackboardId}`, to: `${run.id}:blackboard:snapshot:${snapshot.id}` });
    }
    return { nodes, edges: (0, util_1.uniqueEdges)(edges) };
}
function persistBlackboardState(run) {
    const state = ensureBlackboardState(run);
    const root = (0, paths_1.blackboardRoot)(run);
    (0, util_1.assertNoRecordPathCollisions)("BlackboardTopic", state.topics);
    (0, util_1.assertNoRecordPathCollisions)("BlackboardContext", state.contexts);
    (0, util_1.assertNoRecordPathCollisions)("BlackboardArtifactRef", state.artifacts);
    (0, util_1.assertNoRecordPathCollisions)("BlackboardSnapshot", state.snapshots);
    (0, util_1.assertNoRecordPathCollisions)("CoordinatorDecision", state.decisions);
    const index = {
        schemaVersion: exports.BLACKBOARD_SCHEMA_VERSION,
        runId: run.id,
        generatedAt: (0, util_1.timestamp)(),
        counts: {
            boards: state.boards.length,
            topics: state.topics.length,
            messages: state.messages.length,
            contexts: state.contexts.length,
            artifacts: state.artifacts.length,
            snapshots: state.snapshots.length,
            decisions: state.decisions.length
        },
        boards: state.boards.map(util_1.indexRow),
        topics: state.topics.map(util_1.indexRow),
        contexts: state.contexts.map(util_1.indexRow),
        artifacts: state.artifacts.map(util_1.indexRow),
        snapshots: state.snapshots.map(util_1.indexRow),
        decisions: state.decisions.map(util_1.indexRow),
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
    (0, state_1.writeJson)(node_path_1.default.join(root, "index.json"), index);
    node_fs_1.default.writeFileSync((0, paths_1.messagesPath)(run), state.messages.sort(util_1.compareRecords).map((message) => JSON.stringify(message)).join("\n") + (state.messages.length ? "\n" : ""), "utf8");
    for (const topic of state.topics)
        (0, state_1.writeJson)((0, paths_1.recordPath)(run, "topics", topic.id), topic);
    for (const context of state.contexts)
        (0, state_1.writeJson)((0, paths_1.recordPath)(run, "contexts", context.id), context);
    for (const artifact of state.artifacts)
        (0, state_1.writeJson)((0, paths_1.recordPath)(run, "artifacts", artifact.id), artifact);
    for (const snapshot of state.snapshots)
        (0, state_1.writeJson)((0, paths_1.recordPath)(run, "snapshots", snapshot.id), snapshot);
    for (const decision of state.decisions)
        (0, state_1.writeJson)((0, paths_1.recordPath)(run, "decisions", decision.id), decision);
}
function bridgeStateArtifactToBlackboard(run, artifact, input = {}) {
    return addBlackboardArtifact(run, {
        kind: artifact.kind,
        path: artifact.path,
        locator: artifact.path,
        metadata: { description: artifact.description, stateArtifactId: artifact.id },
        ...input
    });
}
function evidenceFromArtifactRef(artifact) {
    return {
        id: artifact.id,
        source: "blackboard-artifact",
        path: artifact.path,
        locator: artifact.locator || artifact.path,
        summary: `${artifact.kind} ${artifact.path || artifact.locator || artifact.id}`,
        provenance: {
            schemaVersion: 1,
            runId: artifact.runId,
            source: "cw-validated",
            workerId: artifact.provenance.workerId,
            taskId: artifact.provenance.taskId,
            candidateId: artifact.provenance.candidateId,
            commitId: artifact.provenance.commitId,
            auditEventIds: artifact.trustAuditEventIds
        }
    };
}
function emptyState() {
    return {
        schemaVersion: exports.BLACKBOARD_SCHEMA_VERSION,
        boards: [],
        topics: [],
        messages: [],
        contexts: [],
        artifacts: [],
        snapshots: [],
        decisions: []
    };
}
function roleLinkFromAuthor(author) {
    if (!author?.id)
        return {};
    if (author.kind === "role")
        return { agentRoleId: author.id };
    if (author.kind === "group")
        return { agentGroupId: author.id };
    if (author.kind === "membership")
        return { agentMembershipId: author.id };
    if (author.kind === "worker")
        return { workerId: author.id };
    return {};
}
function shouldEnforcePolicy(author, links) {
    if (author.kind === "role" || author.kind === "group" || author.kind === "membership" || author.kind === "worker")
        return true;
    return Boolean(links.agentRoleId || links.agentGroupId || links.agentMembershipId);
}
function base(run, blackboardId, id, author, scope, status = "active", tags, metadata) {
    const now = (0, util_1.timestamp)();
    return {
        schemaVersion: exports.BLACKBOARD_SCHEMA_VERSION,
        id,
        runId: run.id,
        blackboardId,
        createdAt: now,
        updatedAt: now,
        author: normalizeAuthor(author, "operator"),
        scope: normalizeScope(scope, { kind: "run", id: run.id }),
        status,
        parentIds: [],
        tags: (0, util_1.sortTags)(tags),
        metadata: (0, util_1.scrub)(metadata)
    };
}
function normalizeAuthor(input, fallbackKind) {
    const kind = input?.kind || fallbackKind;
    const id = input?.id || (kind === "runtime" || kind === "coordinator" ? "cw" : kind === "operator" ? "operator" : undefined);
    if (!id)
        throw new Error("Blackboard author requires an explicit id");
    return { kind, id, displayName: input?.displayName };
}
function normalizeScope(input, fallback) {
    const kind = input?.kind || fallback.kind;
    const id = input?.id || fallback.id;
    if (!kind || !id)
        throw new Error("Blackboard scope requires kind and id");
    return { kind, id };
}
function compactLinks(run, input) {
    return (0, util_1.compact)({
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
        auditEventIds: (0, util_1.unique)(input.auditEventIds || []),
        evidenceRefs: (0, util_1.unique)(input.evidenceRefs || [])
    });
}
function linkMultiAgent(run, blackboardId, topicIds, input) {
    const groupId = "agentGroupId" in input ? input.agentGroupId : ("groupId" in input ? input.groupId : undefined);
    const roleId = "agentRoleId" in input ? input.agentRoleId : ("roleId" in input ? input.roleId : undefined);
    const membershipId = "agentMembershipId" in input ? input.agentMembershipId : ("membershipId" in input ? input.membershipId : undefined);
    if (input.multiAgentRunId) {
        const record = (0, multi_agent_1.getMultiAgentRun)(run, input.multiAgentRunId);
        if (record) {
            record.blackboardId = blackboardId;
            record.topicIds = (0, util_1.unique)([...(record.topicIds || []), ...topicIds]);
            record.links.blackboardId = blackboardId;
            record.links.blackboardTopicIds = (0, util_1.unique)([...(record.links.blackboardTopicIds || []), ...topicIds]);
        }
    }
    if (groupId) {
        const record = (0, multi_agent_1.getAgentGroup)(run, groupId);
        if (record) {
            record.blackboardId = blackboardId;
            record.topicIds = (0, util_1.unique)([...(record.topicIds || []), ...topicIds]);
        }
    }
    if (roleId) {
        const record = (0, multi_agent_1.getAgentRole)(run, roleId);
        if (record) {
            record.blackboardId = blackboardId;
            record.topicIds = (0, util_1.unique)([...(record.topicIds || []), ...topicIds]);
        }
    }
    if (membershipId) {
        const record = (0, multi_agent_1.getAgentMembership)(run, membershipId);
        if (record) {
            record.blackboardId = blackboardId;
            record.topicIds = (0, util_1.unique)([...(record.topicIds || []), ...topicIds]);
        }
    }
}
function requireBoard(run, id) {
    const board = ensureBlackboardState(run).boards.find((entry) => entry.id === id);
    if (!board)
        throw new Error(`Unknown Blackboard id: ${id}`);
    return board;
}
function requireTopic(run, id) {
    const topic = ensureBlackboardState(run).topics.find((entry) => entry.id === id);
    if (!topic)
        throw new Error(`Unknown BlackboardTopic id: ${id}`);
    return topic;
}
function requireContext(run, id) {
    const context = ensureBlackboardState(run).contexts.find((entry) => entry.id === id);
    if (!context)
        throw new Error(`Unknown BlackboardContext id: ${id}`);
    return context;
}
function requireArtifactRefs(run, ids) {
    const state = ensureBlackboardState(run);
    for (const id of ids) {
        if (!state.artifacts.some((artifact) => artifact.id === id))
            throw new Error(`Unknown BlackboardArtifactRef id: ${id}`);
    }
    return (0, util_1.unique)(ids);
}
function requireMessages(run, ids) {
    const state = ensureBlackboardState(run);
    for (const id of ids) {
        if (!state.messages.some((message) => message.id === id))
            throw new Error(`Unknown BlackboardMessage id: ${id}`);
    }
    return (0, util_1.unique)(ids);
}
function appendBlackboardNode(run, kind, id, status, label, artifactPath, parents = []) {
    const nodeId = kind === "blackboard"
        ? `${run.id}:blackboard:${id}`
        : kind === "coordinator-decision"
            ? `${run.id}:coordinator:decision:${id}`
            : `${run.id}:blackboard:${kind.replace("blackboard-", "")}:${id}`;
    (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: nodeId,
        kind,
        status,
        loopStage: run.loopStage,
        outputs: { id, label },
        artifacts: [{ id: kind, kind: "json", path: artifactPath }],
        parents,
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { id, label }
    }));
}
function graphSubject(run, id) {
    const state = ensureBlackboardState(run);
    if (state.contexts.some((entry) => entry.id === id))
        return `${run.id}:blackboard:context:${id}`;
    if (state.artifacts.some((entry) => entry.id === id))
        return `${run.id}:blackboard:artifact:${id}`;
    if (state.messages.some((entry) => entry.id === id))
        return `${run.id}:blackboard:message:${id}`;
    return id;
}
function nextAction(run, board, openQuestions, conflicts, artifacts) {
    if (!board)
        return `node scripts/cw.js blackboard topic create ${run.id} --id <topic-id> --title "<title>"`;
    if (conflicts.length)
        return `node scripts/cw.js coordinator decision ${run.id} --kind conflict-resolution --outcome accepted --subject ${conflicts[0].id} --reason "<reason>"`;
    if (openQuestions.length)
        return `node scripts/cw.js blackboard message post ${run.id} --topic ${openQuestions[0].topicId} --body "<answer with evidence>"`;
    if (!artifacts.length)
        return `node scripts/cw.js blackboard artifact add ${run.id} --path <path> --kind <kind>`;
    return `node scripts/cw.js blackboard snapshot ${run.id}`;
}
