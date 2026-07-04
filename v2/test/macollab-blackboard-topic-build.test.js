#!/usr/bin/env node
// macollab-blackboard-topic-build — coordinator.ts's buildBlackboard and
// buildTopic pure record builders.
//
// Evidence: SPEC/multi-agent.md section C (resolveBlackboard/createBlackboardTopic
// rows), "Author defaults", context-kind list.

const assert = require("node:assert/strict");
const { buildBlackboard, buildTopic } = require("../dist/core/multi-agent/coordinator");

const NOW = "2026-07-03T00:00:00.000Z";
const PATHS = { root: "/r", index: "/r/index.json", messages: "/r/messages.jsonl", topicsDir: "/r/topics", contextsDir: "/r/contexts", artifactsDir: "/r/artifacts", snapshotsDir: "/r/snapshots", decisionsDir: "/r/decisions" };

// buildBlackboard: defaults — title falls back to id, scope defaults to {kind:"run", id: runId}
// unless a multiAgentRunId is given (then scope kind is "multi-agent-run").
{
  const board = buildBlackboard("run-1", {}, "bb-0000", NOW, PATHS);
  assert.equal(board.title, "bb-0000", "no title given -> title falls back to the board id");
  assert.deepEqual(board.scope, { kind: "run", id: "run-1" }, "no multiAgentRunId -> scope defaults to run scope");
  assert.equal(board.status, "active", "a freshly built board is always status active");
  assert.deepEqual(board.topicIds, [], "topicIds starts empty");
  assert.equal(board.messageCount, 0, "messageCount starts at 0");
  assert.equal(board.createdAt, NOW, "createdAt is the passed-in clock value, not a real clock read");
  assert.equal(board.updatedAt, NOW, "updatedAt equals createdAt on creation");
}

// buildBlackboard: multiAgentRunId given -> scope kind becomes multi-agent-run, and the link is compacted in.
{
  const board = buildBlackboard("run-1", { multiAgentRunId: "mar-0000", title: "My Board" }, "bb-0001", NOW, PATHS);
  assert.deepEqual(board.scope, { kind: "multi-agent-run", id: "mar-0000" }, "multiAgentRunId given -> scope kind is multi-agent-run");
  assert.equal(board.title, "My Board", "explicit title is preserved");
  assert.equal(board.links.multiAgentRunId, "mar-0000", "multiAgentRunId is folded into links too");
  assert.equal(board.links.workflowRunId, "run-1", "workflowRunId is always present in links");
}

// buildBlackboard: explicit scope input wins over the multiAgentRunId-derived fallback.
{
  const board = buildBlackboard("run-1", { multiAgentRunId: "mar-0000", scope: { kind: "task", id: "t-1" } }, "bb-0002", NOW, PATHS);
  assert.deepEqual(board.scope, { kind: "task", id: "t-1" }, "explicit scope input overrides the multiAgentRunId-derived fallback");
}

// buildBlackboard: tags are sorted+deduped via sortTags; metadata is scrubbed.
{
  const board = buildBlackboard("run-1", { tags: ["z", "a", "z"], metadata: { secret: "shh", ok: "fine" } }, "bb-0003", NOW, PATHS);
  assert.deepEqual(board.tags, ["a", "z"], "tags deduped and sorted");
  assert.equal(board.metadata.secret, "[redacted]", "metadata secret key scrubbed");
  assert.equal(board.metadata.ok, "fine", "metadata non-secret key preserved");
}

// buildTopic: default status is "open" (distinct from message/context default "active").
{
  const board = buildBlackboard("run-1", {}, "bb-0000", NOW, PATHS);
  const topic = buildTopic("run-1", board, { title: "Discussion" }, "topic-0000", NOW);
  assert.equal(topic.status, "open", "a freshly built topic defaults to status open");
  assert.equal(topic.title, "Discussion", "title passes through");
  assert.deepEqual(topic.messageIds, [], "messageIds starts empty");
  assert.equal(topic.blackboardId, "bb-0000", "topic.blackboardId is the board's id (from base())");
  assert.equal(topic.runId, "run-1", "topic.runId matches the passed runId");
}

// buildTopic: author defaults to "operator" fallback kind when none given; topic links merge board links + role link + explicit scope.
{
  const board = buildBlackboard("run-1", { groupId: "group-1" }, "bb-0000", NOW, PATHS);
  const topic = buildTopic("run-1", board, { title: "T", author: { kind: "role", id: "role-1" } }, "topic-0001", NOW);
  assert.equal(topic.author.kind, "role", "explicit author kind preserved");
  assert.equal(topic.links.agentGroupId, "group-1", "board's agentGroupId link is inherited by the topic");
  assert.equal(topic.links.agentRoleId, "role-1", "author kind role contributes agentRoleId via roleLinkFromAuthor");
}

// buildTopic: no author given falls back to operator kind, with id "operator".
{
  const board = buildBlackboard("run-1", {}, "bb-0000", NOW, PATHS);
  const topic = buildTopic("run-1", board, { title: "T" }, "topic-0002", NOW);
  assert.deepEqual({ kind: topic.author.kind, id: topic.author.id }, { kind: "operator", id: "operator" }, "no author given -> operator/operator fallback");
}

process.stdout.write("macollab-blackboard-topic-build: ok\n");
