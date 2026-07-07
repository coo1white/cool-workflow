#!/usr/bin/env node
// maruntime-fanin-collect (multiagent-core bucket) — pins
// collectAgentFanin: coverage derivation, missing-role/missing-membership
// detection, blocked-reason strings (exact SPEC text), verifierReady gate,
// group/run status side effects, isMembershipReported's evidence rule.
//
// Evidence: SPEC/multi-agent.md section A (collectAgentFanin row),
// Invariant 4 (fanin never assumes), "Fanin blocked-reason strings" exact
// output block, rebuild risk 6 (evidence-of-report rule).

const assert = require("node:assert/strict");
const {
  createMultiAgentRun,
  createAgentRole,
  createAgentGroup,
  assignAgentMembership,
  createAgentFanout,
  collectAgentFanin,
  recordMultiAgentWorkerOutput,
  isMembershipReported,
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
function makeTask(id) {
  return { id, kind: "generic", phase: "p1", status: "pending", requiresEvidence: false, prompt: "p", taskPath: "t", resultPath: "r", loopStage: "interpret" };
}
const NOW = "2020-01-01T00:00:00.000Z";
const workerExists = () => true;

// isMembershipReported: needs BOTH a reported/verified status AND a
// non-empty evidenceRefs array.
{
  assert.equal(isMembershipReported({ status: "reported", evidenceRefs: ["ev-1"] }), true);
  assert.equal(isMembershipReported({ status: "reported", evidenceRefs: [] }), false, "reported status alone is not enough without evidence");
  assert.equal(isMembershipReported({ status: "verified", evidenceRefs: ["ev-1"] }), true);
  assert.equal(isMembershipReported({ status: "running", evidenceRefs: ["ev-1"] }), false, "evidence alone is not enough without reported/verified status");
}

// Missing role: a required role with no membership at all blocks with the
// exact SPEC string.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const fanin = collectAgentFanin(run, { groupId: group.id, requiredRoleIds: [role.id] }, NOW);
  assert.equal(fanin.status, "blocked");
  assert.equal(fanin.verifierReady, false);
  assert.deepEqual(fanin.blockedReasons, [`required role ${role.id} has no membership`]);
}

// Missing evidence: a membership exists but has not reported required
// evidence -> blocked with the exact SPEC string.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const membership = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  const fanin = collectAgentFanin(run, { groupId: group.id, requiredRoleIds: [role.id] }, NOW);
  assert.equal(fanin.status, "blocked");
  assert.deepEqual(fanin.blockedReasons, [`membership ${membership.id} has not reported required evidence`]);
  assert.deepEqual(fanin.missingMembershipIds, [membership.id]);
}

// Ready path: membership reports evidence via recordMultiAgentWorkerOutput,
// no blackboard scope in play -> fanin becomes "ready", verifierReady true,
// blockedReasons empty, group+run status become "verifying".
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const membership = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  recordMultiAgentWorkerOutput(run, { workerId: "w1", taskId: "task-1", evidence: [{ id: "ev-1", locator: "loc-1" }] }, NOW);
  const fanin = collectAgentFanin(run, { groupId: group.id, requiredRoleIds: [role.id] }, NOW);
  assert.equal(fanin.status, "ready");
  assert.equal(fanin.verifierReady, true);
  assert.deepEqual(fanin.blockedReasons, []);
  assert.deepEqual(fanin.reportedMembershipIds, [membership.id]);
  assert.equal(group.status, "verifying", "group status becomes verifying when fanin is ready");
  assert.equal(mar.status, "verifying", "run status becomes verifying when fanin is ready");
}

// Blackboard evidence requirement: when a blackboardId is in scope, each
// required membership must ALSO carry at least one indexed blackboard
// message or artifact ref, even if it already reported plain evidence.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, { blackboardId: "bb-0001" }, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const membership = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  recordMultiAgentWorkerOutput(run, { workerId: "w1", taskId: "task-1", evidence: [{ id: "ev-1", locator: "loc-1" }] }, NOW);
  const fanin = collectAgentFanin(run, { groupId: group.id, requiredRoleIds: [role.id] }, NOW);
  assert.equal(fanin.status, "blocked", "blackboard is in scope but no indexed evidence was reported");
  assert.deepEqual(fanin.blockedReasons, [`membership ${membership.id} has no indexed blackboard evidence`]);
}

{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, { blackboardId: "bb-0001" }, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  recordMultiAgentWorkerOutput(run, { workerId: "w1", taskId: "task-1", evidence: [{ id: "ev-1", locator: "loc-1" }], blackboardArtifactRefIds: ["artifact-0001"] }, NOW);
  const fanin = collectAgentFanin(run, { groupId: group.id, requiredRoleIds: [role.id] }, NOW);
  assert.equal(fanin.status, "ready", "an indexed blackboard artifact satisfies the blackboard-scope evidence rule");
}

// Duplicate explicit fanin id throws.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  collectAgentFanin(run, { groupId: group.id, id: "fanin-a", requiredRoleIds: [] }, NOW);
  assert.throws(
    () => collectAgentFanin(run, { groupId: group.id, id: "fanin-a", requiredRoleIds: [] }, NOW),
    /Duplicate AgentFanin id: fanin-a/
  );
}

// requiredRoleIds defaults to the group's own roleIds when not given.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  group.roleIds = [role.id];
  const fanin = collectAgentFanin(run, { groupId: group.id }, NOW);
  assert.deepEqual(fanin.requiredRoleIds, [role.id], "requiredRoleIds defaults to group.roleIds when omitted");
}

// Empty requiredRoleIds with no memberships -> immediately ready (no roles
// to satisfy, nothing missing).
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const fanin = collectAgentFanin(run, { groupId: group.id, requiredRoleIds: [] }, NOW);
  assert.equal(fanin.status, "ready");
  assert.deepEqual(fanin.blockedReasons, []);
}

process.stdout.write("maruntime-fanin-collect: ok\n");
