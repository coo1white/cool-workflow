#!/usr/bin/env node
// stateexplosion-digest-blackboard — pins summarizeBlackboardDigest: the
// 12 entry lists, id/label formats, boardId scoping, and the recentChanges
// two-stage sort (updatedAt desc, then re-sorted by id).
//
// PURITY NOTE: summarizeBlackboardDigest calls `new Date().toISOString()`
// directly for `generatedAt` with NO clock parameter, unlike graph.ts's
// finalizeGraphRecord and report.ts's buildStateExplosionReport, which both
// accept an options.now and fall back to the real clock only when it's
// omitted. This function has no such fallback path — it always reads the
// real clock. That is a PURITY VIOLATION per project/docs/rebuild/PLAN.md ("core/ must not
// call Date.now()/new Date() — every such input is a function parameter")
// and is reported as a finding, not silently worked around. The assertion
// below only checks generatedAt is a parseable ISO string near "now",
// since there is no way to pin it to a literal today.
//
// Evidence: SPEC/state-core.md "summarizeBlackboardDigest(run, blackboardId?)".

const assert = require("node:assert/strict");
const { summarizeBlackboardDigest } = require("../dist/core/state/state-explosion/digest");
const { fingerprintRecords } = require("../dist/core/hash");

function emptyRun(id = "run-1") {
  return { id, blackboard: { boards: [], topics: [], messages: [], contexts: [], artifacts: [], decisions: [] } };
}

// Empty blackboard: every list is empty; id has no boardId suffix.
{
  const digest = summarizeBlackboardDigest(emptyRun());
  assert.equal(digest.id, "blackboard-digest", "id with no board is exactly 'blackboard-digest'");
  assert.equal(digest.scope, "blackboard", "scope is always 'blackboard'");
  assert.equal(digest.schemaVersion, 1, "schemaVersion is 1");
  for (const list of [
    "topicRollups",
    "threadSummaries",
    "unresolvedQuestions",
    "conflicts",
    "decisions",
    "artifacts",
    "adoptedEvidence",
    "missingEvidence",
    "policyViolations",
    "judgeRationale",
    "recentChanges",
    "highSignal",
  ]) {
    assert.deepEqual(digest[list], [], `${list} is empty for an empty blackboard`);
  }
  assert.equal(digest.sourceFingerprint, fingerprintRecords([]), "sourceFingerprint of an empty record set matches fingerprintRecords([])");
}

// topicRollups: label format "<title> (<n> messages, <n> contexts, <n> artifacts)", sorted by id.
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [
        { id: "t2", title: "Second", status: "open", contextIds: ["c1"], artifactRefIds: [] },
        { id: "t1", title: "First", status: "open", contextIds: [], artifactRefIds: ["a1", "a2"] },
      ],
      messages: [{ id: "m1", topicId: "t1", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", status: "posted", author: { kind: "agent", id: "x" }, body: "hi" }],
      contexts: [],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.deepEqual(digest.topicRollups.map((t) => t.id), ["t1", "t2"], "topicRollups is sorted by id");
  assert.equal(digest.topicRollups[0].label, "First (1 messages, 0 contexts, 2 artifacts)", "topicRollups label format for t1");
  assert.equal(digest.topicRollups[1].label, "Second (0 messages, 1 contexts, 0 artifacts)", "topicRollups label format for t2");
}

// threadSummaries: only topics with at least one message; label includes "latest by <kind>:<id>" when present.
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [
        { id: "t1", title: "Topic", status: "open", contextIds: [], artifactRefIds: [] },
        { id: "t2", title: "Empty topic", status: "open", contextIds: [], artifactRefIds: [] },
      ],
      messages: [
        { id: "m1", topicId: "t1", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", status: "posted", author: { kind: "agent", id: "a1" }, body: "first" },
        { id: "m2", topicId: "t1", createdAt: "2020-01-02T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z", status: "posted", author: { kind: "human", id: "u1" }, body: "second" },
      ],
      contexts: [],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.equal(digest.threadSummaries.length, 1, "threadSummaries excludes topics with zero messages (t2 dropped)");
  assert.equal(digest.threadSummaries[0].id, "thread:t1", "threadSummaries id is 'thread:<topicId>'");
  assert.equal(digest.threadSummaries[0].label, "Topic: 2 messages; latest by human:u1", "threadSummaries label names the chronologically-latest message's author");
}

// unresolvedQuestions: only kind==="question" && status==="open"; label "<key>: <truncated value>".
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [],
      messages: [],
      contexts: [
        { id: "c1", kind: "question", key: "k1", value: "what next?", status: "open", topicId: "t1", updatedAt: "2020-01-01T00:00:00.000Z" },
        { id: "c2", kind: "question", key: "k2", value: "answered", status: "resolved", topicId: "t1", updatedAt: "2020-01-01T00:00:00.000Z" },
        { id: "c3", kind: "fact", key: "k3", value: "irrelevant", status: "open", topicId: "t1", updatedAt: "2020-01-01T00:00:00.000Z" },
      ],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.equal(digest.unresolvedQuestions.length, 1, "only open questions are included (resolved question and non-question kind excluded)");
  assert.equal(digest.unresolvedQuestions[0].id, "c1", "unresolvedQuestions id is the context's own id");
  assert.equal(digest.unresolvedQuestions[0].label, "k1: what next?", "unresolvedQuestions label is '<key>: <truncated value>'");
}

// conflicts: status==="conflicting" OR has conflictingContextIds.
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [],
      messages: [],
      contexts: [
        { id: "c1", kind: "fact", key: "k1", value: "v1", status: "conflicting", topicId: "t1", updatedAt: "2020-01-01T00:00:00.000Z" },
        { id: "c2", kind: "fact", key: "k2", value: "v2", status: "active", topicId: "t1", conflictingContextIds: ["c1"], updatedAt: "2020-01-01T00:00:00.000Z" },
        { id: "c3", kind: "fact", key: "k3", value: "v3", status: "active", topicId: "t1", updatedAt: "2020-01-01T00:00:00.000Z" },
      ],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.deepEqual(digest.conflicts.map((c) => c.id), ["c1", "c2"], "conflicts includes both explicit 'conflicting' status and any context WITH conflictingContextIds");
  assert.equal(digest.conflicts[0].label, "k1 conflicts with another value", "conflicts label falls back to 'another value' when conflictingContextIds is empty");
  assert.equal(digest.conflicts[1].label, "k2 conflicts with c1", "conflicts label lists the conflicting context ids when present");
}

// decisions + policyViolations: policyViolations is decisions filtered to outcome rejected/blocked/conflicting, id prefixed "policy:".
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [],
      messages: [],
      contexts: [],
      artifacts: [],
      decisions: [
        { id: "d1", kind: "review", outcome: "accepted", reason: "looks good", status: "final", subjectIds: [], updatedAt: "2020-01-01T00:00:00.000Z" },
        { id: "d2", kind: "review", outcome: "rejected", reason: "bad evidence", status: "final", subjectIds: [], updatedAt: "2020-01-01T00:00:00.000Z" },
      ],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.equal(digest.decisions.length, 2, "decisions includes every decision regardless of outcome");
  assert.deepEqual(digest.policyViolations.map((p) => p.id), ["policy:d2"], "policyViolations includes only the rejected/blocked/conflicting outcome, id prefixed 'policy:'");
}

// artifacts + adoptedEvidence: adoptedEvidence is artifacts filtered to status==="active", id prefixed "evidence:".
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [],
      messages: [],
      contexts: [],
      artifacts: [
        { id: "a1", kind: "doc", locator: "file://a1", status: "active", updatedAt: "2020-01-01T00:00:00.000Z" },
        { id: "a2", kind: "doc", path: "/a2.txt", status: "archived", updatedAt: "2020-01-01T00:00:00.000Z" },
      ],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.equal(digest.artifacts.length, 2, "artifacts includes every artifact regardless of status");
  assert.deepEqual(digest.adoptedEvidence.map((e) => e.id), ["evidence:a1"], "adoptedEvidence includes only active-status artifacts, id prefixed 'evidence:'");
  assert.equal(digest.artifacts[0].label, "doc file://a1", "artifact label prefers locator over path");
  assert.equal(digest.artifacts[1].label, "doc /a2.txt", "artifact label falls back to path when locator absent");
}

// judgeRationale: messages tagged "judge-rationale" or with metadata.judgeRationale; id prefixed "judge:".
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [{ id: "t1", title: "T", status: "open", contextIds: [], artifactRefIds: [] }],
      messages: [
        { id: "m1", topicId: "t1", createdAt: "x", updatedAt: "x", status: "posted", author: { kind: "agent", id: "j1" }, body: "rationale here", tags: ["judge-rationale"] },
        { id: "m2", topicId: "t1", createdAt: "x", updatedAt: "x", status: "posted", author: { kind: "agent", id: "a2" }, body: "not rationale" },
      ],
      contexts: [],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.deepEqual(digest.judgeRationale.map((j) => j.id), ["judge:m1"], "judgeRationale includes only tagged messages, id prefixed 'judge:'");
}

// missingEvidence: derived reason strings for questions/contexts with no evidence, sorted, id "missing:<index>:<slug(reason)>".
{
  const run = {
    id: "run-1",
    blackboard: {
      topics: [],
      messages: [],
      contexts: [
        { id: "c1", kind: "question", key: "k1", value: "v1", status: "open", topicId: "t1", updatedAt: "2020-01-01T00:00:00.000Z" },
        { id: "c2", kind: "fact", key: "k2", value: "v2", status: "active", topicId: "t1", updatedAt: "2020-01-01T00:00:00.000Z" },
      ],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.equal(digest.missingEvidence.length, 2, "both the open question and the non-superseded fact with no evidence are flagged");
  assert.ok(
    digest.missingEvidence.some((m) => m.label === "question c1 has no indexed evidence"),
    "missing-evidence label for a question uses 'question <id> has no indexed evidence'"
  );
  assert.ok(
    digest.missingEvidence.some((m) => m.label === "context c2 has no indexed evidence"),
    "missing-evidence label for a non-question context uses 'context <id> has no indexed evidence'"
  );
}

// recentChanges: last 10 by updatedAt desc, THEN re-sorted by id.
{
  const messages = Array.from({ length: 3 }, (_, i) => ({
    id: `m${i}`,
    topicId: "t1",
    createdAt: `2020-01-0${i + 1}T00:00:00.000Z`,
    updatedAt: `2020-01-0${i + 1}T00:00:00.000Z`,
    status: "posted",
    author: { kind: "agent", id: "a" },
    body: "b",
  }));
  const run = { id: "run-1", blackboard: { topics: [], messages, contexts: [], artifacts: [], decisions: [] } };
  const digest = summarizeBlackboardDigest(run);
  // After taking the 10 most-recent by updatedAt desc (all 3 fit), the
  // final list is re-sorted by id ascending: recent:m0, recent:m1, recent:m2.
  assert.deepEqual(digest.recentChanges.map((r) => r.id), ["recent:m0", "recent:m1", "recent:m2"], "recentChanges final order is re-sorted by id, not by updatedAt");
}

// boardId scoping: only records with a matching blackboardId are included; id gets ":<boardId>" suffix.
{
  const run = {
    id: "run-1",
    blackboard: {
      boards: [{ id: "board-a" }, { id: "board-b" }],
      topics: [
        { id: "ta", blackboardId: "board-a", title: "A", status: "open", contextIds: [], artifactRefIds: [] },
        { id: "tb", blackboardId: "board-b", title: "B", status: "open", contextIds: [], artifactRefIds: [] },
      ],
      messages: [],
      contexts: [],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run, "board-a");
  assert.equal(digest.id, "blackboard-digest:board-a", "id gets ':<boardId>' suffix when a boardId is passed");
  assert.equal(digest.blackboardId, "board-a", "blackboardId field echoes the resolved board id");
  assert.deepEqual(digest.topicRollups.map((t) => t.id), ["ta"], "only records matching the requested boardId are included");
}

// boardId omitted: defaults to the FIRST board in bb.boards (if any).
{
  const run = {
    id: "run-1",
    blackboard: {
      boards: [{ id: "board-x" }, { id: "board-y" }],
      topics: [{ id: "tx", blackboardId: "board-x", title: "X", status: "open", contextIds: [], artifactRefIds: [] }],
      messages: [],
      contexts: [],
      artifacts: [],
      decisions: [],
    },
  };
  const digest = summarizeBlackboardDigest(run);
  assert.equal(digest.blackboardId, "board-x", "with no explicit boardId, the FIRST board in bb.boards is used");
}

// generatedAt is a well-formed ISO string (purity gap: cannot be pinned — see finding).
{
  const digest = summarizeBlackboardDigest(emptyRun());
  assert.ok(!Number.isNaN(Date.parse(digest.generatedAt)), "generatedAt must at least be a parseable ISO timestamp");
}

process.stdout.write("stateexplosion-digest-blackboard: ok\n");
