#!/usr/bin/env node
// macollab-context-conflict-detection — coordinator.ts's buildContext:
// same-board+topic+kind+key with a DIFFERENT value marks BOTH sides
// conflicting; --supersedes suppresses the conflict; a question context
// defaults to status "open", other kinds default to "active".
//
// BYTE-COMPAT invariant 10 [load-bearing]: "Context conflicts are loud" —
// never a silent overwrite.
//
// Evidence: SPEC/multi-agent.md section C (putBlackboardContext row),
// invariant 10, context-kind list.

const assert = require("node:assert/strict");
const { buildBlackboard, buildTopic, buildContext } = require("../dist/core/multi-agent/coordinator");

const NOW = "2026-07-03T00:00:00.000Z";
const PATHS = { root: "/r", index: "/r/index.json", messages: "/r/messages.jsonl", topicsDir: "/r/topics", contextsDir: "/r/contexts", artifactsDir: "/r/artifacts", snapshotsDir: "/r/snapshots", decisionsDir: "/r/decisions" };

const board = buildBlackboard("run-1", {}, "bb-0000", NOW, PATHS);
const topic = buildTopic("run-1", board, { title: "T" }, "topic-0000", NOW);

// buildContext: question kind defaults to status "open"; other kinds default to "active".
{
  const question = buildContext("run-1", board, topic, { topicId: topic.id, kind: "question", value: "why?" }, "ctx-0000", NOW, []);
  assert.equal(question.context.status, "open", "question kind with no conflict defaults to open");
  const fact = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", value: "x=1" }, "ctx-0001", NOW, []);
  assert.equal(fact.context.status, "active", "non-question kind with no conflict defaults to active");
}

// buildContext: key defaults to kind when not given.
{
  const result = buildContext("run-1", board, topic, { topicId: topic.id, kind: "assumption", value: "v" }, "ctx-0002", NOW, []);
  assert.equal(result.context.key, "assumption", "no explicit key -> key falls back to kind");
}

// buildContext: same board+topic+kind+key, DIFFERENT value -> BOTH sides marked conflicting.
{
  const existing = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "temp", value: "20C" }, "ctx-0003", NOW, []).context;
  const result = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "temp", value: "25C" }, "ctx-0004", NOW, [existing]);
  assert.equal(result.context.status, "conflicting", "new context with a differing value on the same key gets status conflicting");
  assert.deepEqual(result.context.conflictingContextIds, [existing.id], "new context records the conflicting existing id");
  assert.equal(result.conflicts.length, 1, "the conflicts array returned alongside the context has exactly one entry");
  assert.equal(result.conflicts[0].id, existing.id, "the returned conflicts array names the pre-existing context");
}

// buildContext: same value does NOT conflict (identical fact re-asserted).
{
  const existing = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "temp2", value: "20C" }, "ctx-0005", NOW, []).context;
  const result = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "temp2", value: "20C" }, "ctx-0006", NOW, [existing]);
  assert.equal(result.context.status, "active", "identical value on the same key does not trigger a conflict");
  assert.deepEqual(result.context.conflictingContextIds, [], "no conflicting ids recorded when values match");
}

// buildContext: different KIND or different TOPIC does not conflict even with the same key+differing value.
{
  const existing = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "shared-key", value: "A" }, "ctx-0007", NOW, []).context;
  const differentKind = buildContext("run-1", board, topic, { topicId: topic.id, kind: "assumption", key: "shared-key", value: "B" }, "ctx-0008", NOW, [existing]);
  assert.equal(differentKind.context.status, "active", "different kind with the same key does not conflict");
  const otherTopic = buildTopic("run-1", board, { title: "Other" }, "topic-0001", NOW);
  const differentTopic = buildContext("run-1", board, otherTopic, { topicId: otherTopic.id, kind: "fact", key: "shared-key", value: "B" }, "ctx-0009", NOW, [existing]);
  assert.equal(differentTopic.context.status, "active", "different topic with the same key/kind does not conflict");
}

// buildContext: an existing context already superseded is excluded from conflict detection.
{
  const existing = { ...buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "superseded-key", value: "old" }, "ctx-0010", NOW, []).context, status: "superseded" };
  const result = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "superseded-key", value: "new" }, "ctx-0011", NOW, [existing]);
  assert.equal(result.context.status, "active", "a superseded existing context is excluded from conflict detection entirely");
}

// buildContext: --supersedes suppresses the conflict for the superseded id specifically.
{
  const existing = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "supersede-key", value: "old" }, "ctx-0012", NOW, []).context;
  const result = buildContext("run-1", board, topic, { topicId: topic.id, kind: "fact", key: "supersede-key", value: "new", supersedesContextIds: [existing.id] }, "ctx-0013", NOW, [existing]);
  assert.equal(result.context.status, "active", "supersedes the differing existing id -> no conflict, status stays active");
  assert.deepEqual(result.context.supersedesContextIds, [existing.id], "supersedesContextIds records the target explicitly");
}

process.stdout.write("macollab-context-conflict-detection: ok\n");
