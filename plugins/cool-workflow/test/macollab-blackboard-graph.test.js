#!/usr/bin/env node
// macollab-blackboard-graph — coordinator.ts's buildBlackboardGraph: exact
// node id patterns, edge derivation, message body truncation in labels,
// dedup via uniqueEdges.
//
// Evidence: SPEC/multi-agent.md "Graph node id patterns" section
// (coordinator: <run-id>:blackboard:...; <run-id>:coordinator:decision:<id>),
// "Message labels in graphs are the body truncated at 64 chars".

const assert = require("node:assert/strict");
const { emptyBlackboardState, buildBlackboardGraph } = require("../dist/core/multi-agent/coordinator");

const recordPath = (kind, id) => `/r/${kind}/${id}.json`;
const MESSAGES_PATH = "/r/messages.jsonl";

// buildBlackboardGraph: board node id pattern + run-root edge.
{
  const state = { ...emptyBlackboardState(), boards: [{ id: "bb-0000", status: "active", title: "Board", paths: { index: "/r/index.json" }, links: {}, topicIds: [] }] };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  const boardNode = graph.nodes.find((n) => n.kind === "blackboard");
  assert.equal(boardNode.id, "run-1:blackboard:bb-0000", "board node id follows <run-id>:blackboard:<id>");
  assert.ok(graph.edges.some((e) => e.from === "run-1:run" && e.to === "run-1:blackboard:bb-0000"), "run root has an edge into the board node");
}

// buildBlackboardGraph: board linked to a multi-agent run gets a "coordinates" edge.
{
  const state = { ...emptyBlackboardState(), boards: [{ id: "bb-0000", status: "active", title: "Board", paths: { index: "/r/index.json" }, links: { multiAgentRunId: "mar-0000" }, topicIds: [] }] };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  const edge = graph.edges.find((e) => e.label === "coordinates");
  assert.deepEqual(edge, { from: "run-1:multi-agent:mar-0000", to: "run-1:blackboard:bb-0000", label: "coordinates" }, "multi-agent-run-linked board gets an exact coordinates edge");
}

// buildBlackboardGraph: topic/context/artifact/message/decision/snapshot node id patterns.
{
  const state = {
    ...emptyBlackboardState(),
    topics: [{ id: "topic-0000", blackboardId: "bb-0000", status: "open", title: "T" }],
    contexts: [{ id: "ctx-0000", topicId: "topic-0000", status: "active", kind: "fact", key: "k", conflictingContextIds: [] }],
    artifacts: [{ id: "artifact-0000", topicId: "topic-0000", blackboardId: "bb-0000", status: "active", kind: "report" }],
    messages: [{ id: "msg-0000", topicId: "topic-0000", status: "active", body: "hi", linkedArtifactRefIds: [] }],
    decisions: [{ id: "decision-0000", blackboardId: "bb-0000", status: "active", kind: "context-update", outcome: "accepted", subjectIds: [] }],
    snapshots: [{ id: "snapshot-0000", blackboardId: "bb-0000", status: "active", snapshotPath: "/r/s.json" }],
  };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  const idsByKind = Object.fromEntries(graph.nodes.map((n) => [n.kind, n.id]));
  assert.equal(idsByKind["blackboard-topic"], "run-1:blackboard:topic:topic-0000", "topic node id pattern");
  assert.equal(idsByKind["blackboard-context"], "run-1:blackboard:context:ctx-0000", "context node id pattern");
  assert.equal(idsByKind["blackboard-artifact"], "run-1:blackboard:artifact:artifact-0000", "artifact node id pattern");
  assert.equal(idsByKind["blackboard-message"], "run-1:blackboard:message:msg-0000", "message node id pattern");
  assert.equal(idsByKind["coordinator-decision"], "run-1:coordinator:decision:decision-0000", "decision node id pattern (coordinator, not blackboard)");
  assert.equal(idsByKind["blackboard-snapshot"], "run-1:blackboard:snapshot:snapshot-0000", "snapshot node id pattern");
}

// buildBlackboardGraph: message label is the body truncated (>64 chars -> 61 chars + "...").
{
  const longBody = "y".repeat(100);
  const state = { ...emptyBlackboardState(), messages: [{ id: "msg-0000", topicId: "topic-0000", status: "active", body: longBody, linkedArtifactRefIds: [] }] };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  const messageNode = graph.nodes.find((n) => n.kind === "blackboard-message");
  assert.equal(messageNode.label, "y".repeat(61) + "...", "long message body is truncated to 61 chars + ellipsis in the graph label");
  assert.equal(messageNode.path, MESSAGES_PATH, "message node path is always the shared messages.jsonl path, not a per-record path");
}

// buildBlackboardGraph: reply edge and "cites" edges for linked artifacts.
{
  const state = {
    ...emptyBlackboardState(),
    messages: [
      { id: "msg-0000", topicId: "topic-0000", status: "active", body: "root", linkedArtifactRefIds: [] },
      { id: "msg-0001", topicId: "topic-0000", status: "active", body: "reply", replyToId: "msg-0000", linkedArtifactRefIds: ["artifact-0000"] },
    ],
  };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  assert.ok(graph.edges.some((e) => e.from === "run-1:blackboard:message:msg-0000" && e.to === "run-1:blackboard:message:msg-0001" && e.label === "reply"), "reply edge from parent to child message with label reply");
  assert.ok(graph.edges.some((e) => e.from === "run-1:blackboard:message:msg-0001" && e.to === "run-1:blackboard:artifact:artifact-0000" && e.label === "cites"), "linked artifact ref produces a cites edge from the message");
}

// buildBlackboardGraph: decision subject edges resolve to whichever record kind actually holds the subject id.
{
  const state = {
    ...emptyBlackboardState(),
    contexts: [{ id: "ctx-0000", topicId: "topic-0000", status: "active", kind: "fact", key: "k", conflictingContextIds: [] }],
    decisions: [{ id: "decision-0000", blackboardId: "bb-0000", status: "active", kind: "conflict-resolution", outcome: "accepted", subjectIds: ["ctx-0000"] }],
  };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  assert.ok(graph.edges.some((e) => e.from === "run-1:coordinator:decision:decision-0000" && e.to === "run-1:blackboard:context:ctx-0000" && e.label === "subject"), "decision subject edge resolves the ctx id to a context node");
}

// buildBlackboardGraph: decision subject id matching nothing falls back to the raw id itself.
{
  const state = { ...emptyBlackboardState(), decisions: [{ id: "decision-0000", blackboardId: "bb-0000", status: "active", kind: "conflict-resolution", outcome: "accepted", subjectIds: ["unknown-id"] }] };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  assert.ok(graph.edges.some((e) => e.to === "unknown-id"), "an unresolvable subject id falls back to itself as the edge target, not thrown or dropped");
}

// buildBlackboardGraph: edges are deduplicated via uniqueEdges (two identical boards would double the run-root edge otherwise).
{
  const state = {
    ...emptyBlackboardState(),
    contexts: [
      { id: "ctx-0000", topicId: "topic-0000", status: "conflicting", kind: "fact", key: "k", conflictingContextIds: ["ctx-0001"] },
      { id: "ctx-0001", topicId: "topic-0000", status: "conflicting", kind: "fact", key: "k", conflictingContextIds: ["ctx-0000"] },
    ],
  };
  const graph = buildBlackboardGraph("run-1", state, recordPath, MESSAGES_PATH);
  const conflictEdges = graph.edges.filter((e) => e.label === "conflicts");
  assert.equal(conflictEdges.length, 2, "each side of a mutual conflict contributes its own distinct conflicts edge (not merged into one)");
}

process.stdout.write("macollab-blackboard-graph: ok\n");
