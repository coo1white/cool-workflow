"use strict";
// core/multi-agent/coordinator.ts — blackboard/topic/message/context/
// artifact/decision kernel.
//
// MILESTONE 9. Byte-exact port of the DECISION half of the old build's
// src/coordinator.ts + src/coordinator/{util,classify,paths}.ts: record
// shape construction, conflict detection, author/scope normalization,
// the status classifiers, link derivation, and the digest/graph
// projections. Audit-event recording and disk persistence are the
// caller's job — see shell/coordinator-io.ts.
//
// Evidence: SPEC/multi-agent.md section C ("Coordinator / blackboard");
// plugins/cool-workflow/src/coordinator.ts,
// src/coordinator/{util,classify,paths}.ts (byte-exact source).
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLACKBOARD_SCHEMA_VERSION = void 0;
exports.unique = unique;
exports.sortTags = sortTags;
exports.compact = compact;
exports.truncate = truncate;
exports.touch = touch;
exports.compareRecords = compareRecords;
exports.createId = createId;
exports.indexRow = indexRow;
exports.assertUnique = assertUnique;
exports.assertNoRecordPathCollisions = assertNoRecordPathCollisions;
exports.uniqueEdges = uniqueEdges;
exports.scrub = scrub;
exports.coordinatorStatusToNodeStatus = coordinatorStatusToNodeStatus;
exports.decisionStatus = decisionStatus;
exports.auditDecision = auditDecision;
exports.sourceForAuthor = sourceForAuthor;
exports.normalizeAuthor = normalizeAuthor;
exports.normalizeScope = normalizeScope;
exports.compactLinks = compactLinks;
exports.roleLinkFromAuthor = roleLinkFromAuthor;
exports.shouldEnforcePolicy = shouldEnforcePolicy;
exports.emptyBlackboardState = emptyBlackboardState;
exports.buildBlackboard = buildBlackboard;
exports.buildTopic = buildTopic;
exports.buildMessage = buildMessage;
exports.buildContext = buildContext;
exports.buildArtifact = buildArtifact;
exports.buildSnapshot = buildSnapshot;
exports.buildDecision = buildDecision;
exports.summarizeBlackboard = summarizeBlackboard;
exports.listBlackboardMessages = listBlackboardMessages;
exports.listBlackboardArtifacts = listBlackboardArtifacts;
exports.buildBlackboardGraph = buildBlackboardGraph;
const collate_1 = require("../util/collate");
exports.BLACKBOARD_SCHEMA_VERSION = 1;
/** Dedup, SORTS. Coordinator-side sorting `unique` — byte-identical
 *  behavior to core/multi-agent/runtime.ts's own copy, kept as a
 *  separate local function since the old build kept its own private
 *  copy in coordinator/util.ts too (see runtime.ts's file header). */
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
function sortTags(values) {
    return unique(values || []);
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && (!Array.isArray(entry) || entry.length > 0)));
}
function truncate(value) {
    return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}
function touch(record, now) {
    record.updatedAt = now;
    return record;
}
function compareRecords(left, right) {
    return compareBytes(left.createdAt, right.createdAt) || compareBytes(left.id, right.id);
}
function compareBytes(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
function createId(prefix, seq) {
    return `${prefix}-${String(seq).padStart(4, "0")}`;
}
function indexRow(record) {
    return { id: record.id, blackboardId: record.blackboardId, topicId: record.topicId, status: record.status, updatedAt: record.updatedAt };
}
function assertUnique(items, id, label) {
    if (items.some((item) => item.id === id))
        throw new Error(`Duplicate ${label} id: ${id}`);
}
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
/** Recursive secret redaction: keys matching secret/token/password/
 *  credential/authorization/api-key/env become "[redacted]"; string
 *  values matching secret/token/password/credential become
 *  "[redacted]" too. Recurses into nested objects and arrays. */
const SECRET_KEY_RE = /secret|token|password|credential|authorization|api[_-]?key|env/i;
const SECRET_VALUE_RE = /secret|token|password|credential/i;
function scrubValue(value) {
    if (Array.isArray(value))
        return value.map(scrubValue);
    if (value && typeof value === "object")
        return scrub(value);
    if (typeof value === "string" && SECRET_VALUE_RE.test(value))
        return "[redacted]";
    return value;
}
function scrub(value) {
    if (!value)
        return undefined;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined)
            continue;
        result[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : scrubValue(entry);
    }
    return Object.keys(result).length ? result : undefined;
}
// ---------------------------------------------------------------------------
// Status/source classifiers (coordinator/classify.ts) — kept as a
// SEPARATE table from multi-agent/runtime.ts's statusToNodeStatus (byte-
// compat / rebuild risk 7: different default — "completed" here vs
// "pending" there — collapsing them changes graph output and eval
// dependency_parity).
// ---------------------------------------------------------------------------
function coordinatorStatusToNodeStatus(status) {
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
function decisionStatus(outcome) {
    if (outcome === "conflicting" || outcome === "blocked")
        return "conflicting";
    if (outcome === "rejected")
        return "rejected";
    if (outcome === "superseded")
        return "superseded";
    return "active";
}
function auditDecision(outcome) {
    if (outcome === "rejected")
        return "rejected";
    if (outcome === "blocked" || outcome === "conflicting")
        return "failed";
    return "accepted";
}
function sourceForAuthor(author) {
    if (author.kind === "runtime" || author.kind === "coordinator")
        return "runtime-derived";
    if (author.kind === "worker" || author.kind === "verifier")
        return "cw-validated";
    return "operator-recorded";
}
// ---------------------------------------------------------------------------
// Author / scope / links normalization
// ---------------------------------------------------------------------------
/** No actor id + kind runtime/coordinator -> "cw"; kind operator -> "operator";
 *  any other kind with no id throws. */
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
function compactLinks(runId, input) {
    return compact({
        workflowRunId: runId,
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
        evidenceRefs: unique(input.evidenceRefs || []),
    });
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
/** Policy is enforced when the author kind is role/group/membership/
 *  worker or the resolved links carry an agent role/group/membership
 *  id. */
function shouldEnforcePolicy(author, links) {
    if (author.kind === "role" || author.kind === "group" || author.kind === "membership" || author.kind === "worker")
        return true;
    return Boolean(links.agentRoleId || links.agentGroupId || links.agentMembershipId);
}
function emptyBlackboardState() {
    return { schemaVersion: exports.BLACKBOARD_SCHEMA_VERSION, boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] };
}
function base(runId, blackboardId, id, now, author, scope, status, tags, metadata) {
    return {
        schemaVersion: exports.BLACKBOARD_SCHEMA_VERSION,
        id,
        runId,
        blackboardId,
        createdAt: now,
        updatedAt: now,
        author,
        scope,
        status,
        parentIds: [],
        tags: sortTags(tags),
        metadata: scrub(metadata),
    };
}
function buildBlackboard(runId, input, id, now, paths) {
    const author = normalizeAuthor(input.author, "runtime");
    const scope = normalizeScope(input.scope, input.multiAgentRunId ? { kind: "multi-agent-run", id: input.multiAgentRunId } : { kind: "run", id: runId });
    return {
        schemaVersion: exports.BLACKBOARD_SCHEMA_VERSION,
        id,
        runId,
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
        links: compactLinks(runId, { multiAgentRunId: input.multiAgentRunId, agentGroupId: input.groupId, agentRoleId: input.roleId, agentMembershipId: input.membershipId }),
        paths,
        metadata: scrub(input.metadata),
    };
}
function buildTopic(runId, board, input, id, now) {
    const topicLinks = compactLinks(runId, { ...board.links, ...roleLinkFromAuthor(input.author), ...input.scope });
    return {
        ...base(runId, board.id, id, now, normalizeAuthor(input.author, "operator"), normalizeScope(input.scope, { kind: "run", id: runId }), "open", input.tags, input.metadata),
        title: input.title,
        description: input.description,
        messageIds: [],
        contextIds: [],
        artifactRefIds: [],
        links: topicLinks,
    };
}
function buildMessage(runId, board, topic, input, id, now, bodyHash, sourceForActor) {
    const author = normalizeAuthor(input.author, "operator");
    const links = compactLinks(runId, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
    const parentIds = unique([...(input.parentIds || []), ...(input.replyToId ? [input.replyToId] : [])]);
    return {
        ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), "active", input.tags, input.metadata),
        topicId: topic.id,
        body: input.body,
        visibility: input.visibility || "public",
        replyToId: input.replyToId,
        parentIds,
        linkedEvidenceRefs: unique(input.evidenceRefs || []),
        linkedArtifactRefIds: unique(input.artifactRefIds || []),
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
            parentMessageIds: parentIds,
            topicScope: topic.id,
            bodyHash: bodyHash(input.body),
            locator: `${board.id}/messages/${id}`,
        },
    };
}
/** Conflict detection: a same-board+topic+kind+key context with a
 *  DIFFERENT value that isn't already superseded (and isn't itself being
 *  superseded by this write) marks BOTH sides `conflicting`. */
function buildContext(runId, board, topic, input, id, now, existingContexts) {
    const key = input.key || input.kind;
    const author = normalizeAuthor(input.author, "operator");
    const links = compactLinks(runId, { ...topic.links, ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs });
    const conflicts = existingContexts.filter((context) => context.blackboardId === board.id &&
        context.topicId === topic.id &&
        context.kind === input.kind &&
        context.key === key &&
        context.status !== "superseded" &&
        !input.supersedesContextIds?.includes(context.id) &&
        context.value !== input.value);
    const status = conflicts.length ? "conflicting" : input.kind === "question" ? "open" : "active";
    const context = {
        ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), status, input.tags, input.metadata),
        topicId: topic.id,
        kind: input.kind,
        key,
        value: input.value,
        supersedesContextIds: unique(input.supersedesContextIds || []),
        conflictingContextIds: conflicts.map((entry) => entry.id),
        evidenceRefs: unique(input.evidenceRefs || []),
        artifactRefIds: unique(input.artifactRefIds || []),
        links,
    };
    return { context, conflicts };
}
function buildArtifact(runId, board, topic, input, id, now, absolutePath, checksum) {
    const author = normalizeAuthor(input.author, "operator");
    const links = compactLinks(runId, { ...board.links, ...(topic?.links || {}), ...roleLinkFromAuthor(author), ...(input.links || {}), evidenceRefs: input.evidenceRefs, auditEventIds: input.auditEventIds });
    return {
        ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), "active", input.tags, input.metadata),
        topicId: topic?.id,
        kind: input.kind,
        path: absolutePath,
        locator: input.locator,
        owner: normalizeAuthor(input.owner || input.author, "operator"),
        source: input.source || "operator-recorded",
        provenance: compactLinks(runId, { ...(input.provenance || {}), ...links }),
        evidenceRefs: unique(input.evidenceRefs || []),
        checksum,
        trustAuditEventIds: unique(input.auditEventIds || []),
    };
}
function buildSnapshot(runId, board, id, now, snapshotPath, indexPath, summary, messageIds) {
    return {
        ...base(runId, board.id, id, now, { kind: "runtime", id: "cw" }, { kind: "run", id: runId }, "active", ["snapshot"], undefined),
        topicIds: [...board.topicIds].sort(),
        messageIds: [...messageIds].sort(),
        contextIds: [...board.contextIds].sort(),
        artifactRefIds: [...board.artifactRefIds].sort(),
        decisionIds: [...board.decisionIds].sort(),
        snapshotPath,
        indexPath,
        summary,
        links: compactLinks(runId, board.links),
    };
}
function buildDecision(runId, board, input, id, now) {
    const author = normalizeAuthor(input.author || { kind: "coordinator", id: "cw" }, "coordinator");
    return {
        ...base(runId, board.id, id, now, author, normalizeScope(input.scope, { kind: "run", id: runId }), decisionStatus(input.outcome), input.tags, input.metadata),
        kind: input.kind,
        outcome: input.outcome,
        subjectIds: unique(input.subjectIds || []),
        reason: input.reason,
        evidenceRefs: unique(input.evidenceRefs || []),
        artifactRefIds: unique(input.artifactRefIds || []),
        messageIds: unique(input.messageIds || []),
        links: compactLinks(runId, { ...board.links, ...roleLinkFromAuthor(input.author), ...(input.links || {}), evidenceRefs: input.evidenceRefs }),
    };
}
function summarizeBlackboard(runId, state, blackboardId, defaultIndexPath) {
    const board = blackboardId ? state.boards.find((entry) => entry.id === blackboardId) : state.boards[0];
    const scoped = (items) => (board ? items.filter((item) => item.blackboardId === board.id) : []);
    const contexts = scoped(state.contexts);
    const artifacts = scoped(state.artifacts);
    const openQuestions = contexts.filter((context) => context.kind === "question" && context.status === "open");
    const conflicts = contexts.filter((context) => context.status === "conflicting" || context.conflictingContextIds.length);
    const missingEvidence = [
        ...openQuestions.filter((context) => !context.evidenceRefs.length && !context.artifactRefIds.length).map((context) => `question ${context.id} has no indexed evidence`),
        ...contexts.filter((context) => context.kind !== "question" && context.status !== "superseded" && !context.evidenceRefs.length && !context.artifactRefIds.length).map((context) => `context ${context.id} has no indexed evidence`),
    ].sort();
    const readyForFanin = Boolean(board && !openQuestions.length && !conflicts.length && artifacts.length > 0 && missingEvidence.length === 0);
    const latestSnapshot = scoped(state.snapshots)
        .sort((left, right) => (0, collate_1.stableCompare)(left.createdAt, right.createdAt))
        .at(-1);
    return {
        runId,
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
        indexPath: board?.paths.index || defaultIndexPath,
        nextAction: nextAction(runId, board, openQuestions, conflicts, artifacts),
    };
}
function nextAction(runId, board, openQuestions, conflicts, artifacts) {
    if (!board)
        return `node scripts/cw.js blackboard topic create ${runId} --id <topic-id> --title "<title>"`;
    if (conflicts.length)
        return `node scripts/cw.js coordinator decision ${runId} --kind conflict-resolution --outcome accepted --subject ${conflicts[0].id} --reason "<reason>"`;
    if (openQuestions.length)
        return `node scripts/cw.js blackboard message post ${runId} --topic ${openQuestions[0].topicId} --body "<answer with evidence>"`;
    if (!artifacts.length)
        return `node scripts/cw.js blackboard artifact add ${runId} --path <path> --kind <kind>`;
    return `node scripts/cw.js blackboard snapshot ${runId}`;
}
function listBlackboardMessages(state, options = {}) {
    return state.messages
        .filter((message) => (!options.blackboardId || message.blackboardId === options.blackboardId) && (!options.topicId || message.topicId === options.topicId))
        .sort((left, right) => (0, collate_1.stableCompare)(left.createdAt, right.createdAt) || (0, collate_1.stableCompare)(left.id, right.id));
}
function listBlackboardArtifacts(state, options = {}) {
    return state.artifacts
        .filter((artifact) => (!options.blackboardId || artifact.blackboardId === options.blackboardId) && (!options.topicId || artifact.topicId === options.topicId))
        .sort((left, right) => (0, collate_1.stableCompare)(left.id, right.id));
}
function buildBlackboardGraph(runId, state, recordPath, messagesPath) {
    const nodes = [];
    const edges = [];
    for (const board of state.boards) {
        nodes.push({ id: `${runId}:blackboard:${board.id}`, kind: "blackboard", status: board.status, label: board.title, path: board.paths.index });
        edges.push({ from: `${runId}:run`, to: `${runId}:blackboard:${board.id}` });
        if (board.links.multiAgentRunId)
            edges.push({ from: `${runId}:multi-agent:${board.links.multiAgentRunId}`, to: `${runId}:blackboard:${board.id}`, label: "coordinates" });
    }
    for (const topic of state.topics) {
        nodes.push({ id: `${runId}:blackboard:topic:${topic.id}`, kind: "blackboard-topic", status: topic.status, label: topic.title, path: recordPath("topics", topic.id) });
        edges.push({ from: `${runId}:blackboard:${topic.blackboardId}`, to: `${runId}:blackboard:topic:${topic.id}` });
    }
    for (const context of state.contexts) {
        nodes.push({ id: `${runId}:blackboard:context:${context.id}`, kind: "blackboard-context", status: context.status, label: `${context.kind}:${context.key}`, path: recordPath("contexts", context.id) });
        edges.push({ from: `${runId}:blackboard:topic:${context.topicId}`, to: `${runId}:blackboard:context:${context.id}` });
        for (const conflicting of context.conflictingContextIds)
            edges.push({ from: `${runId}:blackboard:context:${context.id}`, to: `${runId}:blackboard:context:${conflicting}`, label: "conflicts" });
    }
    for (const artifact of state.artifacts) {
        nodes.push({ id: `${runId}:blackboard:artifact:${artifact.id}`, kind: "blackboard-artifact", status: artifact.status, label: artifact.kind, path: recordPath("artifacts", artifact.id) });
        edges.push({ from: artifact.topicId ? `${runId}:blackboard:topic:${artifact.topicId}` : `${runId}:blackboard:${artifact.blackboardId}`, to: `${runId}:blackboard:artifact:${artifact.id}` });
    }
    for (const message of state.messages) {
        nodes.push({ id: `${runId}:blackboard:message:${message.id}`, kind: "blackboard-message", status: message.status, label: truncate(message.body), path: messagesPath });
        edges.push({ from: `${runId}:blackboard:topic:${message.topicId}`, to: `${runId}:blackboard:message:${message.id}` });
        if (message.replyToId)
            edges.push({ from: `${runId}:blackboard:message:${message.replyToId}`, to: `${runId}:blackboard:message:${message.id}`, label: "reply" });
        for (const artifactId of message.linkedArtifactRefIds)
            edges.push({ from: `${runId}:blackboard:message:${message.id}`, to: `${runId}:blackboard:artifact:${artifactId}`, label: "cites" });
    }
    for (const decision of state.decisions) {
        nodes.push({ id: `${runId}:coordinator:decision:${decision.id}`, kind: "coordinator-decision", status: decision.status, label: `${decision.kind}:${decision.outcome}`, path: recordPath("decisions", decision.id) });
        edges.push({ from: `${runId}:blackboard:${decision.blackboardId}`, to: `${runId}:coordinator:decision:${decision.id}` });
        for (const subjectId of decision.subjectIds)
            edges.push({ from: `${runId}:coordinator:decision:${decision.id}`, to: graphSubject(runId, state, subjectId), label: "subject" });
    }
    for (const snapshot of state.snapshots) {
        nodes.push({ id: `${runId}:blackboard:snapshot:${snapshot.id}`, kind: "blackboard-snapshot", status: snapshot.status, label: snapshot.id, path: snapshot.snapshotPath });
        edges.push({ from: `${runId}:blackboard:${snapshot.blackboardId}`, to: `${runId}:blackboard:snapshot:${snapshot.id}` });
    }
    return { nodes, edges: uniqueEdges(edges) };
}
function graphSubject(runId, state, id) {
    if (state.contexts.some((entry) => entry.id === id))
        return `${runId}:blackboard:context:${id}`;
    if (state.artifacts.some((entry) => entry.id === id))
        return `${runId}:blackboard:artifact:${id}`;
    if (state.messages.some((entry) => entry.id === id))
        return `${runId}:blackboard:message:${id}`;
    return id;
}
