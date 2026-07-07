#!/usr/bin/env node
// macollab-blackboard-summary — coordinator.ts's summarizeBlackboard:
// readyForFanin gate, missingEvidence rows (sorted), nextAction ladder,
// listBlackboardMessages/listBlackboardArtifacts sort order.
//
// Evidence: SPEC/multi-agent.md "summarizeBlackboard fields" section,
// "nextAction (in order)" ladder.

const assert = require("node:assert/strict");
const { emptyBlackboardState, summarizeBlackboard, listBlackboardMessages, listBlackboardArtifacts } = require("../dist/core/multi-agent/coordinator");

const DEFAULT_INDEX = "/r/blackboard/index.json";

function board(id) {
  return { id, paths: { index: `/r/blackboard-${id}/index.json` } };
}

// summarizeBlackboard: no board found at all -> nextAction is "create a topic", indexPath falls back to defaultIndexPath.
{
  const state = emptyBlackboardState();
  const summary = summarizeBlackboard("run-1", state, undefined, DEFAULT_INDEX);
  assert.equal(summary.blackboardId, undefined, "no boards at all -> blackboardId undefined");
  assert.equal(summary.indexPath, DEFAULT_INDEX, "no board -> indexPath falls back to the passed default");
  assert.match(summary.nextAction, /blackboard topic create run-1/, "no board -> nextAction suggests creating a topic");
  assert.equal(summary.readyForFanin, false, "no board -> never ready for fanin");
}

// summarizeBlackboard: board with a conflict -> nextAction suggests conflict-resolution decision; readyForFanin false.
{
  const state = { ...emptyBlackboardState(), boards: [board("bb-0000")], contexts: [{ id: "ctx-0000", blackboardId: "bb-0000", topicId: "topic-0000", kind: "fact", key: "k", status: "conflicting", conflictingContextIds: ["ctx-0001"], evidenceRefs: [], artifactRefIds: [] }] };
  const summary = summarizeBlackboard("run-1", state, "bb-0000", DEFAULT_INDEX);
  assert.equal(summary.conflicts.length, 1, "one conflicting context is picked up");
  assert.match(summary.nextAction, /coordinator decision run-1 --kind conflict-resolution/, "conflict present -> nextAction suggests conflict-resolution decision");
  assert.equal(summary.readyForFanin, false, "conflicts present -> never ready for fanin");
}

// summarizeBlackboard: open question with no evidence -> counted in missingEvidence AND openQuestions; nextAction suggests answering it.
{
  const state = {
    ...emptyBlackboardState(),
    boards: [board("bb-0000")],
    contexts: [{ id: "ctx-0000", blackboardId: "bb-0000", topicId: "topic-0000", kind: "question", key: "q", status: "open", conflictingContextIds: [], evidenceRefs: [], artifactRefIds: [] }],
  };
  const summary = summarizeBlackboard("run-1", state, "bb-0000", DEFAULT_INDEX);
  assert.equal(summary.openQuestions.length, 1, "open question with no evidence is picked up");
  assert.deepEqual(summary.missingEvidence, ["question ctx-0000 has no indexed evidence"], "missing-evidence row uses the exact 'question <id> has no indexed evidence' template");
  assert.match(summary.nextAction, /blackboard message post run-1 --topic topic-0000/, "open question present -> nextAction suggests posting a message on its topic");
}

// summarizeBlackboard: non-question context missing evidence gets the "context <id> has no indexed evidence" row (different template).
{
  const state = {
    ...emptyBlackboardState(),
    boards: [board("bb-0000")],
    contexts: [{ id: "ctx-0001", blackboardId: "bb-0000", topicId: "topic-0000", kind: "fact", key: "k", status: "active", conflictingContextIds: [], evidenceRefs: [], artifactRefIds: [] }],
  };
  const summary = summarizeBlackboard("run-1", state, "bb-0000", DEFAULT_INDEX);
  assert.deepEqual(summary.missingEvidence, ["context ctx-0001 has no indexed evidence"], "non-question missing-evidence row uses 'context <id> has no indexed evidence'");
}

// summarizeBlackboard: no artifacts -> nextAction suggests adding an artifact (when no open questions/conflicts).
{
  const state = { ...emptyBlackboardState(), boards: [board("bb-0000")] };
  const summary = summarizeBlackboard("run-1", state, "bb-0000", DEFAULT_INDEX);
  assert.match(summary.nextAction, /blackboard artifact add run-1/, "no artifacts, no conflicts/questions -> nextAction suggests adding an artifact");
  assert.equal(summary.readyForFanin, false, "no artifacts -> never ready for fanin");
}

// summarizeBlackboard: clean board WITH an artifact and no missing evidence -> readyForFanin true, nextAction suggests a snapshot.
{
  const state = { ...emptyBlackboardState(), boards: [board("bb-0000")], artifacts: [{ id: "artifact-0000", blackboardId: "bb-0000", topicId: "topic-0000", kind: "report", status: "active" }] };
  const summary = summarizeBlackboard("run-1", state, "bb-0000", DEFAULT_INDEX);
  assert.equal(summary.readyForFanin, true, "board with no open questions/conflicts, at least one artifact, no missing evidence -> ready for fanin");
  assert.match(summary.nextAction, /blackboard snapshot run-1/, "clean + ready board -> nextAction suggests a snapshot");
}

// summarizeBlackboard: scoped counts only include records for the resolved board, not other boards.
{
  const state = {
    ...emptyBlackboardState(),
    boards: [board("bb-0000"), board("bb-0001")],
    topics: [{ id: "topic-a", blackboardId: "bb-0000" }, { id: "topic-b", blackboardId: "bb-0001" }],
  };
  const summary = summarizeBlackboard("run-1", state, "bb-0000", DEFAULT_INDEX);
  assert.equal(summary.topics, 1, "topics count is scoped to the resolved board only");
}

// listBlackboardMessages: sorted by createdAt then id; filtered by topicId/blackboardId.
{
  const state = {
    ...emptyBlackboardState(),
    messages: [
      { id: "msg-0002", blackboardId: "bb-0000", topicId: "topic-0000", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "msg-0000", blackboardId: "bb-0000", topicId: "topic-0000", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "msg-0001", blackboardId: "bb-0000", topicId: "topic-0001", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  };
  const all = listBlackboardMessages(state, { blackboardId: "bb-0000" });
  assert.deepEqual(all.map((m) => m.id), ["msg-0000", "msg-0001", "msg-0002"], "messages sorted by createdAt then id across topics");
  const scoped = listBlackboardMessages(state, { topicId: "topic-0000" });
  assert.deepEqual(scoped.map((m) => m.id), ["msg-0000", "msg-0002"], "topicId filter narrows the result");
}

// listBlackboardArtifacts: sorted by id only (not createdAt).
{
  const state = { ...emptyBlackboardState(), artifacts: [{ id: "artifact-0002", blackboardId: "bb-0000" }, { id: "artifact-0000", blackboardId: "bb-0000" }] };
  const result = listBlackboardArtifacts(state, { blackboardId: "bb-0000" });
  assert.deepEqual(result.map((a) => a.id), ["artifact-0000", "artifact-0002"], "artifacts sorted by id");
}

process.stdout.write("macollab-blackboard-summary: ok\n");
