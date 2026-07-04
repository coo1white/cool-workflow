#!/usr/bin/env node
// macollab-artifact-snapshot-decision-build — coordinator.ts's
// buildArtifact, buildSnapshot, buildDecision.
//
// Evidence: SPEC/multi-agent.md section C (addBlackboardArtifact,
// createBlackboardSnapshot, recordCoordinatorDecision rows), "sorts all
// id lists" edge case for snapshots, decisionStatus mapping.

const assert = require("node:assert/strict");
const { buildBlackboard, buildTopic, buildArtifact, buildSnapshot, buildDecision } = require("../dist/core/multi-agent/coordinator");

const NOW = "2026-07-03T00:00:00.000Z";
const PATHS = { root: "/r", index: "/r/index.json", messages: "/r/messages.jsonl", topicsDir: "/r/topics", contextsDir: "/r/contexts", artifactsDir: "/r/artifacts", snapshotsDir: "/r/snapshots", decisionsDir: "/r/decisions" };

const board = buildBlackboard("run-1", {}, "bb-0000", NOW, PATHS);
const topic = buildTopic("run-1", board, { title: "T" }, "topic-0000", NOW);

// buildArtifact: default source "operator-recorded"; owner falls back to author; status always "active".
{
  const artifact = buildArtifact("run-1", board, topic, { kind: "report", path: "/abs/path.md" }, "artifact-0000", NOW, "/abs/path.md", "checksum123");
  assert.equal(artifact.source, "operator-recorded", "default source is operator-recorded");
  assert.equal(artifact.status, "active", "a freshly built artifact is always status active");
  assert.equal(artifact.owner.kind, "operator", "owner falls back to normalizeAuthor(input.owner || input.author, operator) -> operator/operator");
  assert.equal(artifact.checksum, "checksum123", "checksum param passes through");
  assert.equal(artifact.path, "/abs/path.md", "resolved absolutePath param becomes .path");
  assert.equal(artifact.topicId, topic.id, "topicId set from the topic param");
}

// buildArtifact: no topic given -> topicId undefined; provenance merges board+topic+author links+input.provenance+links.
{
  const artifact = buildArtifact("run-1", board, undefined, { kind: "manual" }, "artifact-0001", NOW, undefined, undefined);
  assert.equal(artifact.topicId, undefined, "no topic param -> topicId is undefined");
  assert.equal(artifact.path, undefined, "no absolutePath param -> path undefined");
  assert.equal(artifact.checksum, undefined, "no checksum param -> checksum undefined");
}

// buildArtifact: explicit owner overrides the author fallback; evidenceRefs/trustAuditEventIds unique()'d.
{
  const artifact = buildArtifact(
    "run-1",
    board,
    topic,
    { kind: "report", owner: { kind: "worker", id: "w-1" }, author: { kind: "operator", id: "operator" }, evidenceRefs: ["e2", "e1"], auditEventIds: ["a2", "a1", "a1"] },
    "artifact-0002",
    NOW,
    undefined,
    undefined
  );
  assert.equal(artifact.owner.kind, "worker", "explicit owner input wins over author for the owner field");
  assert.equal(artifact.owner.id, "w-1", "explicit owner id preserved");
  assert.deepEqual(artifact.evidenceRefs, ["e1", "e2"], "evidenceRefs deduped and sorted");
  assert.deepEqual(artifact.trustAuditEventIds, ["a1", "a2"], "trustAuditEventIds (from auditEventIds input) deduped and sorted");
}

// buildSnapshot: id lists are SORTED; status always "active"; tags fixed to ["snapshot"]; author fixed to runtime/cw.
{
  const boardWithIds = { ...board, topicIds: ["topic-0002", "topic-0000", "topic-0001"], contextIds: ["ctx-2", "ctx-1"], artifactRefIds: ["art-b", "art-a"], decisionIds: ["dec-2", "dec-1"] };
  const snapshot = buildSnapshot("run-1", boardWithIds, "snapshot-0000", NOW, "/r/snapshots/s.json", "/r/index.json", { count: 3 }, ["msg-2", "msg-1"]);
  assert.deepEqual(snapshot.topicIds, ["topic-0000", "topic-0001", "topic-0002"], "topicIds copied from board and sorted");
  assert.deepEqual(snapshot.messageIds, ["msg-1", "msg-2"], "messageIds param sorted");
  assert.deepEqual(snapshot.contextIds, ["ctx-1", "ctx-2"], "contextIds sorted");
  assert.deepEqual(snapshot.artifactRefIds, ["art-a", "art-b"], "artifactRefIds sorted");
  assert.deepEqual(snapshot.decisionIds, ["dec-1", "dec-2"], "decisionIds sorted");
  assert.equal(snapshot.status, "active", "snapshot status is always active");
  assert.deepEqual(snapshot.tags, ["snapshot"], "snapshot tags are fixed to [snapshot]");
  assert.deepEqual({ kind: snapshot.author.kind, id: snapshot.author.id }, { kind: "runtime", id: "cw" }, "snapshot author is fixed to runtime/cw");
  assert.equal(snapshot.summary.count, 3, "summary object passes through");
}

// buildSnapshot does not mutate the input arrays (sorts copies).
{
  const messageIds = ["msg-b", "msg-a"];
  buildSnapshot("run-1", board, "snapshot-0001", NOW, "/p", "/i", {}, messageIds);
  assert.deepEqual(messageIds, ["msg-b", "msg-a"], "buildSnapshot must not mutate the caller's messageIds array");
}

// buildDecision: status derived via decisionStatus(outcome); default author kind coordinator/cw when none given.
{
  const decision = buildDecision("run-1", board, { kind: "conflict-resolution", outcome: "accepted", reason: "resolved" }, "decision-0000", NOW);
  assert.equal(decision.status, "active", "accepted outcome maps to active status via decisionStatus()");
  assert.deepEqual({ kind: decision.author.kind, id: decision.author.id }, { kind: "coordinator", id: "cw" }, "no author given -> coordinator/cw default");
  assert.equal(decision.outcome, "accepted", "outcome passes through");
  assert.equal(decision.reason, "resolved", "reason passes through");
}

// buildDecision: conflicting outcome -> conflicting status; subjectIds/evidenceRefs/artifactRefIds/messageIds unique()'d.
{
  const decision = buildDecision(
    "run-1",
    board,
    { kind: "conflict-resolution", outcome: "conflicting", reason: "still disputed", subjectIds: ["ctx-2", "ctx-1", "ctx-1"], evidenceRefs: ["e2", "e1"], artifactRefIds: ["a1"], messageIds: ["m1", "m1"] },
    "decision-0001",
    NOW
  );
  assert.equal(decision.status, "conflicting", "conflicting outcome maps to conflicting status");
  assert.deepEqual(decision.subjectIds, ["ctx-1", "ctx-2"], "subjectIds deduped and sorted");
  assert.deepEqual(decision.evidenceRefs, ["e1", "e2"], "evidenceRefs deduped and sorted");
  assert.deepEqual(decision.messageIds, ["m1"], "messageIds deduped");
}

process.stdout.write("macollab-artifact-snapshot-decision-build: ok\n");
