"use strict";
// core/state/state-explosion/digest.ts — summarizeBlackboardDigest.
//
// MILESTONE 4. Byte-exact port of the old build's
// `summarizeBlackboardDigest` (src/state-explosion.ts:302-526). The old
// build's version also calls `summarizeBlackboard` (src/coordinator.ts),
// which reads `ensureBlackboardState` — a milestone-9 concern (the real
// Blackboard/topic/message/context/artifact/decision record shapes, not
// yet built; `WorkflowRun.blackboard` is `unknown[]` at this milestone,
// see core/state/types.ts's header note). This file defines its OWN
// minimal structural types for exactly the fields the digest logic reads
// (matching SPEC/state-core.md's field usage and the old build's real
// record shapes field-for-field), so the function is byte-identical
// output once milestone 9 lands real records — it degrades to empty
// lists today, when `run.blackboard.topics/messages/...` are genuinely
// empty arrays (the only value they can hold before milestone 9 writes
// any record into them).
//
// `nextAction`'s fallback mirrors the old build's own fallback (its
// `summary.nextAction` came from `summarizeBlackboard`; this milestone has
// no blackboard summary of its own yet, so the digest always uses ITS OWN
// nextAction fallback: `cw blackboard summary <runId>` —
// this is not a behavior change, since the old build's fallback was
// ALSO exactly that string whenever `summarizeBlackboard`'s own
// `nextAction` was falsy).
//
// Evidence: SPEC/state-core.md "summarizeBlackboardDigest(...)".
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeBlackboardDigest = summarizeBlackboardDigest;
const hash_1 = require("../../hash");
const helpers_1 = require("./helpers");
const collate_1 = require("../../util/collate");
/** Deterministic structural summary of one (or the default) blackboard.
 *  Every list is sorted by id (`byId`); `recentChanges` is the last 10 by
 *  `updatedAt` desc, THEN re-sorted by id for the final list (matching the
 *  old build's two-stage sort exactly). `now` is the explicit clock value
 *  for `generatedAt`; the real clock is read ONLY when it is omitted,
 *  matching graph.ts's finalizeGraphRecord / report.ts's
 *  buildStateExplosionReport `options.now` pattern. */
function summarizeBlackboardDigest(run, blackboardId, now) {
    const bb = run.blackboard || { boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] };
    const board = blackboardId ? (bb.boards || []).find((b) => b.id === blackboardId) : (bb.boards || [])[0];
    const boardId = board?.id;
    const inBoard = (items) => boardId ? items.filter((item) => item.blackboardId === boardId) : items;
    const topics = inBoard(bb.topics || []);
    const messages = inBoard(bb.messages || []);
    const contexts = inBoard(bb.contexts || []);
    const artifacts = inBoard(bb.artifacts || []);
    const decisions = inBoard(bb.decisions || []);
    const topicRollups = topics
        .map((topic) => {
        const topicMessages = messages.filter((m) => m.topicId === topic.id);
        return {
            id: topic.id,
            label: `${topic.title} (${topicMessages.length} messages, ${topic.contextIds.length} contexts, ${topic.artifactRefIds.length} artifacts)`,
            status: topic.status,
            sourceIds: [topic.id, ...topicMessages.map((m) => m.id)],
            evidenceRefs: (0, helpers_1.unique)(topicMessages.flatMap((m) => m.linkedEvidenceRefs || [])),
            expansionCommand: `cw blackboard message list ${run.id} --topic ${topic.id}`,
        };
    })
        .sort(helpers_1.byId);
    const threadSummaries = topics
        .map((topic) => {
        const topicMessages = messages
            .filter((m) => m.topicId === topic.id)
            .sort((a, b) => (0, collate_1.stableCompare)(a.createdAt, b.createdAt) || (0, collate_1.stableCompare)(a.id, b.id));
        const last = topicMessages[topicMessages.length - 1];
        return {
            id: `thread:${topic.id}`,
            label: `${topic.title}: ${topicMessages.length} messages${last ? `; latest by ${last.author.kind}:${last.author.id}` : ""}`,
            status: topic.status,
            sourceIds: topicMessages.map((m) => m.id),
            evidenceRefs: (0, helpers_1.unique)(topicMessages.flatMap((m) => m.linkedEvidenceRefs || [])),
            expansionCommand: `cw blackboard message list ${run.id} --topic ${topic.id}`,
        };
    })
        .filter((entry) => entry.sourceIds.length)
        .sort(helpers_1.byId);
    const unresolvedQuestions = contexts
        .filter((c) => c.kind === "question" && c.status === "open")
        .map((c) => ({
        id: c.id,
        label: `${c.key}: ${(0, helpers_1.truncate)(c.value)}`,
        status: c.status,
        sourceIds: [c.id],
        evidenceRefs: (0, helpers_1.unique)([...(c.evidenceRefs || []), ...(c.artifactRefIds || [])]),
        expansionCommand: `cw blackboard message post ${run.id} --topic ${c.topicId} --body "<answer with evidence>"`,
    }))
        .sort(helpers_1.byId);
    const conflicts = contexts
        .filter((c) => c.status === "conflicting" || (c.conflictingContextIds || []).length)
        .map((c) => ({
        id: c.id,
        label: `${c.key} conflicts with ${(c.conflictingContextIds || []).join(", ") || "another value"}`,
        status: c.status,
        sourceIds: [c.id, ...(c.conflictingContextIds || [])],
        evidenceRefs: (0, helpers_1.unique)([...(c.evidenceRefs || []), ...(c.artifactRefIds || [])]),
        expansionCommand: `cw coordinator decision ${run.id} --kind conflict-resolution --outcome accepted --subject ${c.id} --reason "<reason>"`,
    }))
        .sort(helpers_1.byId);
    const decisionEntries = decisions
        .map((d) => ({
        id: d.id,
        label: `${d.kind}:${d.outcome} ${(0, helpers_1.truncate)(d.reason)}`,
        status: d.status,
        sourceIds: [d.id, ...(d.subjectIds || [])],
        evidenceRefs: (0, helpers_1.unique)([...(d.evidenceRefs || []), ...(d.artifactRefIds || [])]),
        expansionCommand: `cw node show ${run.id} ${run.id}:coordinator:decision:${d.id}`,
    }))
        .sort(helpers_1.byId);
    const artifactEntries = artifacts
        .map((a) => ({
        id: a.id,
        label: `${a.kind} ${a.locator || a.path || a.id}`,
        status: a.status,
        sourceIds: [a.id],
        evidenceRefs: (0, helpers_1.unique)(a.evidenceRefs || []),
        expansionCommand: `cw blackboard artifact list ${run.id}`,
    }))
        .sort(helpers_1.byId);
    const adoptedEvidence = artifacts
        .filter((a) => a.status === "active")
        .map((a) => ({
        id: `evidence:${a.id}`,
        label: `${a.kind} ${a.locator || a.path || a.id}`,
        status: a.status,
        sourceIds: [a.id],
        evidenceRefs: (0, helpers_1.unique)([a.locator || a.path || a.id, ...(a.evidenceRefs || [])]),
        expansionCommand: `cw audit blackboard ${run.id} --json`,
    }))
        .sort(helpers_1.byId);
    // The old build's missingEvidence came from `summarizeBlackboard`'s own
    // computed reasons (open questions / non-superseded contexts with no
    // evidence). Milestone 9 owns that computation; this milestone derives
    // the identical reason strings directly from `contexts` so the shape
    // and sort order match exactly once real context records exist.
    const missingEvidenceReasons = [
        ...unresolvedQuestions
            .map((entry) => contexts.find((c) => c.id === entry.id))
            .filter((c) => Boolean(c) && !(c.evidenceRefs || []).length && !(c.artifactRefIds || []).length)
            .map((c) => `question ${c.id} has no indexed evidence`),
        ...contexts
            .filter((c) => c.kind !== "question" && c.status !== "superseded" && !(c.evidenceRefs || []).length && !(c.artifactRefIds || []).length)
            .map((c) => `context ${c.id} has no indexed evidence`),
    ].sort();
    const missingEvidence = missingEvidenceReasons
        .map((reason, index) => ({
        id: `missing:${index}:${(0, helpers_1.slug)(reason)}`,
        label: reason,
        status: "missing",
        sourceIds: [],
        evidenceRefs: [],
        expansionCommand: `cw multi-agent failures ${run.id}`,
    }))
        .sort(helpers_1.byId);
    const policyViolations = decisions
        .filter((d) => d.outcome === "rejected" || d.outcome === "blocked" || d.outcome === "conflicting")
        .map((d) => ({
        id: `policy:${d.id}`,
        label: `${d.kind}:${d.outcome} ${(0, helpers_1.truncate)(d.reason)}`,
        status: d.status,
        sourceIds: [d.id],
        evidenceRefs: (0, helpers_1.unique)(d.evidenceRefs || []),
        expansionCommand: `cw audit policy ${run.id} --json`,
    }))
        .sort(helpers_1.byId);
    const judgeRationale = messages
        .filter((m) => (m.tags || []).includes("judge-rationale") || Boolean(m.metadata?.judgeRationale))
        .map((m) => ({
        id: `judge:${m.id}`,
        label: `${m.author.kind}:${m.author.id} ${(0, helpers_1.truncate)(m.body)}`,
        status: m.status,
        sourceIds: [m.id],
        evidenceRefs: (0, helpers_1.unique)(m.linkedEvidenceRefs || []),
        expansionCommand: `cw audit judge ${run.id} --json`,
    }))
        .sort(helpers_1.byId);
    const recentChanges = [...messages, ...contexts, ...artifacts, ...decisions]
        .map((record) => ({
        id: record.id,
        updatedAt: record.updatedAt,
        status: record.status,
    }))
        .sort((a, b) => (0, collate_1.stableCompare)(b.updatedAt, a.updatedAt) || (0, collate_1.stableCompare)(a.id, b.id))
        .slice(0, 10)
        .map((record) => ({
        id: `recent:${record.id}`,
        label: `${record.id} (${record.status})`,
        status: record.status,
        sourceIds: [record.id],
        evidenceRefs: [],
        expansionCommand: `cw node show ${run.id} ${record.id}`,
    }))
        .sort(helpers_1.byId);
    const highSignal = [...conflicts, ...unresolvedQuestions, ...policyViolations, ...missingEvidence].sort(helpers_1.byId);
    const sourceRecordIds = (0, helpers_1.unique)([
        ...topics.map((t) => t.id),
        ...messages.map((m) => m.id),
        ...contexts.map((c) => c.id),
        ...artifacts.map((a) => a.id),
        ...decisions.map((d) => d.id),
    ]);
    const evidenceRefs = (0, helpers_1.unique)([
        ...messages.flatMap((m) => m.linkedEvidenceRefs || []),
        ...artifacts.flatMap((a) => [a.locator || a.path || a.id, ...(a.evidenceRefs || [])]),
        ...contexts.flatMap((c) => c.evidenceRefs || []),
    ]);
    const trustAuditEventRefs = (0, helpers_1.unique)([
        ...messages.flatMap((m) => m.linkedAuditEventIds || []),
        ...artifacts.flatMap((a) => a.trustAuditEventIds || []),
    ]);
    const fingerprint = (0, hash_1.fingerprintRecords)([...topics, ...messages, ...contexts, ...artifacts, ...decisions]);
    return {
        schemaVersion: 1,
        runId: run.id,
        id: `blackboard-digest${boardId ? `:${boardId}` : ""}`,
        scope: "blackboard",
        blackboardId: boardId,
        sourceRecordIds,
        sourceFingerprint: fingerprint,
        includedCount: topicRollups.length + conflicts.length + unresolvedQuestions.length + decisionEntries.length + artifactEntries.length,
        omittedCount: Math.max(0, messages.length - threadSummaries.length),
        importantRefs: (0, helpers_1.unique)([...conflicts.map((c) => c.id), ...unresolvedQuestions.map((q) => q.id), ...policyViolations.map((p) => p.id)]),
        evidenceRefs,
        trustAuditEventRefs,
        generatedAt: now || new Date().toISOString(),
        status: "valid",
        deterministic: true,
        nextAction: `cw blackboard summary ${run.id}`,
        topicRollups,
        threadSummaries,
        unresolvedQuestions,
        conflicts,
        decisions: decisionEntries,
        artifacts: artifactEntries,
        adoptedEvidence,
        missingEvidence,
        policyViolations,
        judgeRationale,
        recentChanges,
        highSignal,
    };
}
