#!/usr/bin/env node
// maruntime-run-create (multiagent-core bucket) — pins
// createMultiAgentRun: default id/status, policy shape, parent-linking,
// duplicate-id fail-closed.
//
// Evidence: SPEC/multi-agent.md section A (createMultiAgentRun row),
// Invariants 1 (fail closed on identity), 11 (id determinism).

const assert = require("node:assert/strict");
const { createMultiAgentRun, requireMultiAgentRun } = require("../dist/core/multi-agent/runtime");

function makeRun(id) {
  return {
    schemaVersion: 1,
    id,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    cwd: "/tmp/x",
    workflow: { id: "wf", title: "t", summary: "s", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: { runDir: "/tmp/x/.cw/runs/" + id, state: "s", report: "r", tasksDir: "t", resultsDir: "r", dispatchesDir: "d", artifactsDir: "a", commitsDir: "c", stateNodesDir: "n", feedbackDir: "f" },
  };
}

const NOW = "2020-01-01T00:00:00.000Z";

// Default id mints `mar-0001` for the first run on a fresh run; default
// status "planned"; title falls back to the id when omitted.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  assert.equal(mar.id, "mar-0001", "first run gets default id mar-0001");
  assert.equal(mar.status, "planned", "default status is planned");
  assert.equal(mar.title, "mar-0001", "title defaults to the id when omitted");
  assert.equal(mar.runId, "run-1", "runId links back to the WorkflowRun id");
  assert.equal(mar.createdAt, NOW, "createdAt is the injected clock value");
  assert.equal(mar.updatedAt, NOW, "updatedAt is the injected clock value");
  assert.deepEqual(mar.childMultiAgentRunIds, []);
  assert.deepEqual(mar.roleIds, []);
  assert.deepEqual(mar.groupIds, []);
  assert.deepEqual(mar.fanoutIds, []);
  assert.deepEqual(mar.faninIds, []);
  assert.equal(mar.lifecycle.length, 1, "exactly one lifecycle event on create");
  assert.deepEqual(mar.lifecycle[0], { at: NOW, from: undefined, to: "planned", actor: "cw", reason: "created", metadata: undefined }, "created lifecycle event shape (from/metadata present as undefined keys)");
}

// Second run on the same WorkflowRun gets mar-0002 (position-based, not
// count-of-all-records-based).
{
  const run = makeRun("run-1");
  createMultiAgentRun(run, {}, NOW);
  const second = createMultiAgentRun(run, { title: "Second" }, NOW);
  assert.equal(second.id, "mar-0002", "second run on the same WorkflowRun gets mar-0002");
  assert.equal(second.title, "Second", "explicit title is kept");
}

// Explicit id is honored; duplicate id throws before any state mutation
// (fail-closed on identity).
{
  const run = makeRun("run-1");
  createMultiAgentRun(run, { id: "custom-id" }, NOW);
  assert.throws(
    () => createMultiAgentRun(run, { id: "custom-id" }, NOW),
    /Duplicate MultiAgentRun id: custom-id/,
    "duplicate explicit id throws the exact kernel error string"
  );
}

// Policy default shape: wide-open blackboard topics ["*"] when no topicIds
// given, all write/candidate/judge ops allowed, policyRef format exact.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, { title: "T" }, NOW);
  assert.equal(mar.policy.id, `${mar.id}-policy`, "policy id is <mar-id>-policy");
  assert.equal(mar.policy.policyRef, `multiAgent.runs.${mar.id}.policy`, "policyRef format is exact");
  assert.equal(mar.policy.subjectKind, "multi-agent-run");
  assert.deepEqual(mar.policy.allowedBlackboardTopicIds, ["*"], "no topicIds given -> wildcard topic scope");
  assert.deepEqual(mar.policy.allowedWriteOperations, ["message", "context", "artifact", "snapshot", "topic", "coordinator-decision"]);
  assert.deepEqual(mar.policy.allowedCandidateOperations, ["register", "score", "select"]);
  assert.deepEqual(mar.policy.allowedJudgeOperations, ["verdict", "rationale", "panel-decision"]);
  assert.deepEqual(mar.policy.deniedOperations, []);
}

// Explicit topicIds replace the wildcard and flow into both policy scope
// and links.blackboardTopicIds (kernel unique() sorts them).
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, { topicIds: ["z-topic", "a-topic"] }, NOW);
  assert.deepEqual(mar.topicIds, ["a-topic", "z-topic"], "topicIds sorted by kernel unique()");
  assert.deepEqual(mar.policy.allowedBlackboardTopicIds, ["a-topic", "z-topic"], "explicit topics replace the wildcard");
  assert.deepEqual(mar.links.blackboardTopicIds, ["a-topic", "z-topic"]);
}

// Parent linking: parentMultiAgentRunId must already exist (requireMultiAgentRun
// throws otherwise), and creating a child appends its id to the parent's
// childMultiAgentRunIds + touches the parent's updatedAt.
{
  const run = makeRun("run-1");
  const parent = createMultiAgentRun(run, { title: "Parent" }, NOW);
  const LATER = "2020-06-01T00:00:00.000Z";
  const child = createMultiAgentRun(run, { title: "Child", parentMultiAgentRunId: parent.id }, LATER);
  const reloadedParent = requireMultiAgentRun(run, parent.id);
  assert.deepEqual(reloadedParent.childMultiAgentRunIds, [child.id], "parent gains the child id");
  assert.equal(reloadedParent.updatedAt, LATER, "parent is touched with the child-creation clock value");
  assert.equal(child.parentMultiAgentRunId, parent.id);
}

{
  const run = makeRun("run-1");
  assert.throws(
    () => createMultiAgentRun(run, { parentMultiAgentRunId: "no-such-run" }, NOW),
    /Unknown MultiAgentRun id: no-such-run/,
    "unknown parentMultiAgentRunId throws before creating the child"
  );
}

process.stdout.write("maruntime-run-create: ok\n");
