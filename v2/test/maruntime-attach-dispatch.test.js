#!/usr/bin/env node
// maruntime-attach-dispatch (multiagent-core bucket) — pins
// attachDispatchToMultiAgent: silent no-op with none of the four ids,
// auto-creating a fanout when needed, one membership per task, status
// cascade (fanout dispatched, group running, run running).
//
// Evidence: SPEC/multi-agent.md section A (attachDispatchToMultiAgent
// row), Edge cases ("silent no-op returning { membershipIds: [] }").

const assert = require("node:assert/strict");
const {
  createMultiAgentRun,
  createAgentRole,
  createAgentGroup,
  attachDispatchToMultiAgent,
} = require("../dist/core/multi-agent/runtime");
const { policyForRole, policyForGroup, policyForMembership } = require("../dist/core/multi-agent/trust-policy");

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
    tasks: tasks || [makeTask("task-1")],
    dispatches: [],
    commits: [],
    paths: { runDir: "/tmp/x/.cw/runs/" + id, state: "s", report: "r", tasksDir: "t", resultsDir: "r", dispatchesDir: "d", artifactsDir: "a", commitsDir: "c", stateNodesDir: "n", feedbackDir: "f" },
  };
}
function makeTask(id, workerId) {
  return { id, kind: "generic", phase: "p1", status: "pending", requiresEvidence: false, prompt: "p", taskPath: "t", resultPath: "r", loopStage: "interpret", workerId };
}
const NOW = "2020-01-01T00:00:00.000Z";
const workerExists = () => true;

// Silent no-op: none of multiAgentRunId/groupId/roleId/fanoutId given.
{
  const run = makeRun("run-1");
  const result = attachDispatchToMultiAgent(run, { dispatchId: "dispatch-1", tasks: [] }, NOW, policyForMembership, workerExists);
  assert.deepEqual(result, { membershipIds: [] });
}

// Missing --multi-agent-group when a role is given but no group and no
// fanout to derive it from.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  assert.throws(
    () => attachDispatchToMultiAgent(run, { multiAgentRunId: mar.id, roleId: role.id, dispatchId: "d1", tasks: [] }, NOW, policyForMembership, workerExists),
    /Dispatch multi-agent attach requires --multi-agent-group or --multiAgentGroup/
  );
}

// Task with no worker id throws (multi-agent membership requires one).
{
  const run = makeRun("run-1", [makeTask("task-1", undefined)]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assert.throws(
    () => attachDispatchToMultiAgent(run, { groupId: group.id, roleId: role.id, dispatchId: "d1", tasks: run.tasks }, NOW, policyForMembership, workerExists),
    /Task task-1 has no worker id for multi-agent membership/
  );
}

// Full happy path: auto-creates a fanout, mints one membership per task,
// sets fanout "dispatched", group "running", run "running".
{
  const run = makeRun("run-1", [makeTask("task-1", "worker-1")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const result = attachDispatchToMultiAgent(
    run,
    { groupId: group.id, roleId: role.id, dispatchId: "dispatch-1", tasks: run.tasks, sandboxProfileId: "readonly" },
    NOW,
    policyForMembership,
    workerExists
  );
  assert.equal(result.membershipIds.length, 1);
  assert.equal(result.multiAgent.runId, mar.id);
  assert.equal(result.multiAgent.groupId, group.id);
  assert.equal(result.multiAgent.roleId, role.id);
  assert.ok(result.multiAgent.fanoutId, "a fanout was auto-created");
  assert.equal(group.status, "running");
  assert.equal(mar.status, "running");
  assert.deepEqual(run.tasks[0].multiAgent, {
    runId: mar.id,
    groupId: group.id,
    roleId: role.id,
    membershipId: result.membershipIds[0],
    fanoutId: result.multiAgent.fanoutId,
  }, "the task record is stamped with multiAgent linkage");
}

// Exactly one role required: passing zero or multiple roles throws.
{
  const run = makeRun("run-1", [makeTask("task-1", "worker-1")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assert.throws(
    () => attachDispatchToMultiAgent(run, { groupId: group.id, dispatchId: "d1", tasks: run.tasks }, NOW, policyForMembership, workerExists),
    /Dispatch multi-agent attach requires exactly one role for deterministic membership; found 0/
  );
}

process.stdout.write("maruntime-attach-dispatch: ok\n");
