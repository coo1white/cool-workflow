#!/usr/bin/env node
// maruntime-fanout-create (multiagent-core bucket) — pins
// createAgentFanout: default id/status, role/task id defaults to the
// group's, default expectedReturnShape (exact byte string from SPEC),
// policy shape, group/run linkage.
//
// Evidence: SPEC/multi-agent.md section A (createAgentFanout row),
// "Fanout default expectedReturnShape" exact-outputs block.

const assert = require("node:assert/strict");
const { createMultiAgentRun, createAgentRole, createAgentGroup, createAgentFanout } = require("../dist/core/multi-agent/runtime");
const { policyForRole, policyForGroup } = require("../dist/core/multi-agent/trust-policy");

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

// Default id fanout-0001, status "planned"; role/task ids default to the
// group's own roleIds/taskIds.
{
  const run = makeRun("run-1", [makeTask("task-1")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id, taskIds: ["task-1"] }, NOW, policyForGroup);
  group.roleIds = [role.id]; // simulate roles already attached to the group
  const fanout = createAgentFanout(run, { groupId: group.id, reason: "spread work" }, NOW);
  assert.equal(fanout.id, "fanout-0001");
  assert.equal(fanout.status, "planned");
  assert.deepEqual(fanout.roleIds, [role.id], "roleIds default to the group's roleIds");
  assert.deepEqual(fanout.taskIds, ["task-1"], "taskIds default to the group's taskIds");
  assert.equal(fanout.reason, "spread work");
}

// Default expectedReturnShape is the exact byte string from SPEC.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const fanout = createAgentFanout(run, { groupId: group.id, reason: "r" }, NOW);
  assert.equal(
    fanout.expectedReturnShape,
    "Each member writes a Markdown result with a cw:result JSON fence containing summary, findings, and evidence.",
    "default expectedReturnShape is the exact SPEC string"
  );
}

// Explicit expectedReturnShape overrides the default.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const fanout = createAgentFanout(run, { groupId: group.id, reason: "r", expectedReturnShape: "custom shape" }, NOW);
  assert.equal(fanout.expectedReturnShape, "custom shape");
}

// Unknown roleIds/taskIds throw before the fanout is created.
{
  const run = makeRun("run-1", [makeTask("task-1")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assert.throws(
    () => createAgentFanout(run, { groupId: group.id, reason: "r", roleIds: ["no-such-role"] }, NOW),
    /Unknown AgentRole id: no-such-role/
  );
  assert.throws(
    () => createAgentFanout(run, { groupId: group.id, reason: "r", taskIds: ["no-such-task"] }, NOW),
    /Unknown task id for multi-agent record: no-such-task/
  );
}

// Policy shape: candidate ops limited to ["register"], no judge ops,
// policyRef format exact, sandboxProfileHints derived from
// sandboxProfileChoices values.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const fanout = createAgentFanout(run, { groupId: group.id, reason: "r", sandboxProfileChoices: { w1: "readonly", w2: "readonly" } }, NOW);
  assert.equal(fanout.policy.policyRef, `multiAgent.fanouts.${fanout.id}.policy`);
  assert.equal(fanout.policy.subjectKind, "fanout");
  assert.deepEqual(fanout.policy.allowedCandidateOperations, ["register"]);
  assert.deepEqual(fanout.policy.allowedJudgeOperations, []);
  assert.deepEqual(fanout.policy.sandboxProfileHints, ["readonly"], "duplicate profile choices collapse via unique()");
}

// Group/run linkage: group gains fanoutIds + roleIds + taskIds from the
// fanout; run gains fanoutIds; both are touched.
{
  const run = makeRun("run-1", [makeTask("task-1")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const fanout = createAgentFanout(run, { groupId: group.id, reason: "r", roleIds: [role.id], taskIds: ["task-1"] }, NOW);
  assert.deepEqual(group.fanoutIds, [fanout.id]);
  assert.deepEqual(group.roleIds, [role.id]);
  assert.deepEqual(group.taskIds, ["task-1"]);
  assert.deepEqual(mar.fanoutIds, [fanout.id]);
}

// Cross-run mismatch: group not belonging to the given multiAgentRunId throws.
{
  const run = makeRun("run-1");
  const marA = createMultiAgentRun(run, { id: "mar-a" }, NOW);
  const marB = createMultiAgentRun(run, { id: "mar-b" }, NOW);
  const groupInA = createAgentGroup(run, { multiAgentRunId: "mar-a" }, NOW, policyForGroup);
  assert.throws(
    () => createAgentFanout(run, { groupId: groupInA.id, multiAgentRunId: "mar-b", reason: "r" }, NOW),
    new RegExp(`AgentGroup ${groupInA.id} does not belong to mar-b`)
  );
}

process.stdout.write("maruntime-fanout-create: ok\n");
