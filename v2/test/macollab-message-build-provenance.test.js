#!/usr/bin/env node
// macollab-message-build-provenance — coordinator.ts's buildMessage:
// provenance shape, parentIds folding (replyToId + parentIds), link
// derivation, visibility default.
//
// Evidence: SPEC/multi-agent.md section C (postBlackboardMessage row),
// "Message reply linking" edge case, message provenance shape.

const assert = require("node:assert/strict");
const { buildBlackboard, buildTopic, buildMessage } = require("../dist/core/multi-agent/coordinator");

const NOW = "2026-07-03T00:00:00.000Z";
const PATHS = { root: "/r", index: "/r/index.json", messages: "/r/messages.jsonl", topicsDir: "/r/topics", contextsDir: "/r/contexts", artifactsDir: "/r/artifacts", snapshotsDir: "/r/snapshots", decisionsDir: "/r/decisions" };
const bodyHash = (text) => `sha256:${Buffer.from(text).toString("hex").slice(0, 8)}`;
const sourceForActor = (author) => (author.kind === "worker" ? "cw-validated" : "operator-recorded");

const board = buildBlackboard("run-1", {}, "bb-0000", NOW, PATHS);
const topic = buildTopic("run-1", board, { title: "T" }, "topic-0000", NOW);

// buildMessage: default visibility "public"; status "active"; body passes through.
{
  const message = buildMessage("run-1", board, topic, { topicId: topic.id, body: "hello world" }, "msg-0000", NOW, bodyHash, sourceForActor);
  assert.equal(message.visibility, "public", "default visibility is public");
  assert.equal(message.status, "active", "a freshly built message is always status active");
  assert.equal(message.body, "hello world", "body passes through unchanged");
  assert.equal(message.topicId, topic.id, "topicId is set from the topic param, not input.topicId directly");
}

// buildMessage: provenance shape — bodyHash, locator, source, authorKind/Id.
{
  const message = buildMessage("run-1", board, topic, { topicId: topic.id, body: "provenance test" }, "msg-0001", NOW, bodyHash, sourceForActor);
  assert.equal(message.provenance.schemaVersion, 1, "provenance schemaVersion is 1");
  assert.equal(message.provenance.bodyHash, bodyHash("provenance test"), "provenance.bodyHash is bodyHash(body)");
  assert.equal(message.provenance.locator, `${board.id}/messages/msg-0001`, "provenance.locator is <boardId>/messages/<id>");
  assert.equal(message.provenance.authorKind, "operator", "default author kind (operator) is copied to provenance");
  assert.equal(message.provenance.topicScope, topic.id, "provenance.topicScope is the topic id");
}

// buildMessage: worker author -> provenance.source via sourceForActor, and workerId link inferred from author.
{
  const message = buildMessage("run-1", board, topic, { topicId: topic.id, body: "worker msg", author: { kind: "worker", id: "w-1" } }, "msg-0002", NOW, bodyHash, sourceForActor);
  assert.equal(message.provenance.source, "cw-validated", "worker author source resolved via injected sourceForActor function");
  assert.equal(message.provenance.workerId, "w-1", "workerId link on provenance falls back to author.id when author.kind is worker");
  assert.equal(message.links.workerId, "w-1", "message.links also carries workerId via roleLinkFromAuthor");
}

// buildMessage: parentIds folds replyToId in (deduped via unique()), even alongside explicit parentIds.
{
  const message = buildMessage("run-1", board, topic, { topicId: topic.id, body: "reply", replyToId: "msg-0001", parentIds: ["msg-0000", "msg-0001"] }, "msg-0003", NOW, bodyHash, sourceForActor);
  assert.deepEqual(message.parentIds, ["msg-0000", "msg-0001"], "replyToId already present in parentIds is deduped, not doubled");
  assert.equal(message.replyToId, "msg-0001", "replyToId is preserved as its own field too");
  assert.deepEqual(message.provenance.parentMessageIds, message.parentIds, "provenance.parentMessageIds mirrors the resolved parentIds exactly");
}

// buildMessage: no replyToId, no parentIds given -> empty parentIds array (not undefined).
{
  const message = buildMessage("run-1", board, topic, { topicId: topic.id, body: "no reply" }, "msg-0004", NOW, bodyHash, sourceForActor);
  assert.deepEqual(message.parentIds, [], "no reply/parents -> empty array");
}

// buildMessage: linkedEvidenceRefs/linkedArtifactRefIds/linkedAuditEventIds are each unique()'d (sorted).
{
  const message = buildMessage(
    "run-1",
    board,
    topic,
    { topicId: topic.id, body: "evidence", evidenceRefs: ["e2", "e1", "e1"], artifactRefIds: ["a2", "a1"], auditEventIds: ["ev2", "ev1"] },
    "msg-0005",
    NOW,
    bodyHash,
    sourceForActor
  );
  assert.deepEqual(message.linkedEvidenceRefs, ["e1", "e2"], "linkedEvidenceRefs deduped and sorted");
  assert.deepEqual(message.linkedArtifactRefIds, ["a1", "a2"], "linkedArtifactRefIds deduped and sorted");
  assert.deepEqual(message.linkedAuditEventIds, ["ev1", "ev2"], "linkedAuditEventIds deduped and sorted");
}

process.stdout.write("macollab-message-build-provenance: ok\n");
