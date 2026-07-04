#!/usr/bin/env node
// maruntime-membership-assign (multiagent-core bucket) — pins
// assignAgentMembership: default id/status (running-with-worker vs
// assigned-without), cross-run checks, duplicate-membership detection,
// unknown-worker fail-closed, role activation side effect.
//
// Evidence: SPEC/multi-agent.md section A (assignAgentMembership row),
// Invariant 1 (fail closed on identity).

const assert = require("node:assert/strict");
const { createMultiAgentRun, createAgentRole, createAgentGroup, assignAgentMembership } = require("../dist/core/multi-agent/runtime");
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
function makeTask(id) {
  return { id, kind: "generic", phase: "p1", status: "pending", requiresEvidence: false, prompt: "p", taskPath: "t", resultPath: "r", loopStage: "interpret" };
}
const NOW = "2020-01-01T00:00:00.000Z";
const workerExists = () => true;

function setup(run) {
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  return { mar, role, group };
}

// No workerId -> status "assigned"; with workerId -> status "running".
{
  const run = makeRun("run-1");
  const { role, group } = setup(run);
  const noWorker = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1" }, NOW, policyForMembership, workerExists);
  assert.equal(noWorker.id, "membership-0001");
  assert.equal(noWorker.status, "assigned", "no workerId -> assigned");
}

{
  const run = makeRun("run-1", [makeTask("task-1"), makeTask("task-2")]);
  const { role, group } = setup(run);
  const withWorker = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-2", workerId: "worker-1" }, NOW, policyForMembership, workerExists);
  assert.equal(withWorker.status, "running", "workerId given -> running");
}

// Role activation side effect: assigning a membership sets the role's
// status to "active" and appends a lifecycle event.
{
  const run = makeRun("run-1");
  const { role, group } = setup(run);
  assert.equal(role.status, "planned");
  assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1" }, NOW, policyForMembership, workerExists);
  assert.equal(role.status, "active", "assigning a membership activates the role");
  assert.equal(role.lifecycle[role.lifecycle.length - 1].reason, "membership assigned");
}

// Cross-run mismatch: a role belonging to a different multi-agent run
// throws before the membership is created.
{
  const run = makeRun("run-1");
  const marA = createMultiAgentRun(run, { id: "mar-a" }, NOW);
  const marB = createMultiAgentRun(run, { id: "mar-b" }, NOW);
  const roleInA = createAgentRole(run, { multiAgentRunId: "mar-a" }, NOW, policyForRole);
  const groupInB = createAgentGroup(run, { multiAgentRunId: "mar-b" }, NOW, policyForGroup);
  assert.throws(
    () => assignAgentMembership(run, { groupId: groupInB.id, roleId: roleInA.id, taskId: "task-1" }, NOW, policyForMembership, workerExists),
    new RegExp(`AgentRole ${roleInA.id} belongs to mar-a, not group run mar-b`)
  );
}

// Unknown worker id throws (fail-closed via the injected workerExists
// predicate).
{
  const run = makeRun("run-1");
  const { role, group } = setup(run);
  assert.throws(
    () => assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "ghost" }, NOW, policyForMembership, () => false),
    /Unknown worker id for membership: ghost/
  );
}

// Duplicate membership (same group+role+task+worker) throws with the
// exact composite error string.
{
  const run = makeRun("run-1");
  const { role, group } = setup(run);
  assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1" }, NOW, policyForMembership, workerExists);
  assert.throws(
    () => assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1" }, NOW, policyForMembership, workerExists),
    new RegExp(`Duplicate AgentMembership for group=${group.id}, role=${role.id}, task=task-1, worker=none`)
  );
}

// Same group+role+task but DIFFERENT worker is NOT a duplicate (worker
// distinguishes memberships).
{
  const run = makeRun("run-1");
  const { role, group } = setup(run);
  assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "worker-a" }, NOW, policyForMembership, workerExists);
  const second = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "worker-b" }, NOW, policyForMembership, workerExists);
  assert.equal(second.id, "membership-0002", "different worker on the same group/role/task is a distinct membership");
}

// Group gains membershipIds/roleIds/taskIds/workerIds; policyForMembership
// callback receives (membership, role).
{
  const run = makeRun("run-1");
  const { role, group } = setup(run);
  let receivedRole;
  const membership = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "worker-x" }, NOW, (m, r) => {
    receivedRole = r;
    return policyForMembership(m, r);
  }, workerExists);
  assert.equal(receivedRole.id, role.id, "policyForMembership callback receives the resolved role");
  assert.deepEqual(group.membershipIds, [membership.id]);
  assert.deepEqual(group.roleIds, [role.id]);
  assert.deepEqual(group.taskIds, ["task-1"]);
  assert.deepEqual(group.workerIds, ["worker-x"]);
}

process.stdout.write("maruntime-membership-assign: ok\n");
