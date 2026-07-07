#!/usr/bin/env node
// maruntime-group-create (multiagent-core bucket) — pins createAgentGroup:
// default id/status "forming", task-id existence check, topicIds merge,
// parent-group linking, duplicate-id fail-closed.
//
// Evidence: SPEC/multi-agent.md section A (createAgentGroup row),
// Invariant 1 (fail closed on identity).

const assert = require("node:assert/strict");
const { createMultiAgentRun, createAgentGroup, requireAgentGroup } = require("../dist/core/multi-agent/runtime");
const { policyForGroup } = require("../dist/core/multi-agent/trust-policy");

function makeRun(id, tasks) {
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
    tasks: tasks || [],
    dispatches: [],
    commits: [],
    paths: { runDir: "/tmp/x/.cw/runs/" + id, state: "s", report: "r", tasksDir: "t", resultsDir: "r", dispatchesDir: "d", artifactsDir: "a", commitsDir: "c", stateNodesDir: "n", feedbackDir: "f" },
  };
}

function makeTask(id) {
  return { id, kind: "generic", phase: "p1", status: "pending", requiresEvidence: false, prompt: "p", taskPath: "t", resultPath: "r", loopStage: "interpret" };
}

const NOW = "2020-01-01T00:00:00.000Z";

// Default id group-0001, status "forming" (NOT "planned" like a role/run).
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assert.equal(group.id, "group-0001");
  assert.equal(group.status, "forming", "a fresh group starts in forming, not planned");
  assert.equal(group.title, "group-0001");
  assert.deepEqual(group.membershipIds, []);
  assert.deepEqual(group.workerIds, []);
}

// taskIds must all exist on the run's tasks; an unknown task id throws
// before the group is created.
{
  const run = makeRun("run-1", [makeTask("task-1")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  assert.throws(
    () => createAgentGroup(run, { multiAgentRunId: mar.id, taskIds: ["task-1", "no-such-task"] }, NOW, policyForGroup),
    /Unknown task id for multi-agent record: no-such-task/
  );
}

{
  const run = makeRun("run-1", [makeTask("task-1"), makeTask("task-2")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id, taskIds: ["task-2", "task-1"] }, NOW, policyForGroup);
  assert.deepEqual(group.taskIds, ["task-1", "task-2"], "taskIds pass through the sorting kernel unique()");
}

// Duplicate explicit group id throws.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  createAgentGroup(run, { multiAgentRunId: mar.id, id: "group-a" }, NOW, policyForGroup);
  assert.throws(
    () => createAgentGroup(run, { multiAgentRunId: mar.id, id: "group-a" }, NOW, policyForGroup),
    /Duplicate AgentGroup id: group-a/
  );
}

// Parent-group linking: parentGroupId must exist; parent gains the child
// id in childGroupIds.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const parentGroup = createAgentGroup(run, { multiAgentRunId: mar.id, title: "Parent" }, NOW, policyForGroup);
  const childGroup = createAgentGroup(run, { multiAgentRunId: mar.id, title: "Child", parentGroupId: parentGroup.id }, NOW, policyForGroup);
  const reloaded = requireAgentGroup(run, parentGroup.id);
  assert.deepEqual(reloaded.childGroupIds, [childGroup.id]);
}

{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  assert.throws(
    () => createAgentGroup(run, { multiAgentRunId: mar.id, parentGroupId: "no-such-group" }, NOW, policyForGroup),
    /Unknown AgentGroup id: no-such-group/
  );
}

// run.groupIds gains the new group and the run is touched.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assert.deepEqual(mar.groupIds, [group.id]);
}

process.stdout.write("maruntime-group-create: ok\n");
