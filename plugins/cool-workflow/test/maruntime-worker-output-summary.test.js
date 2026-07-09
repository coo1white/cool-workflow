#!/usr/bin/env node
// maruntime-worker-output-summary (multiagent-core bucket) — pins
// recordMultiAgentWorkerOutput (evidence merge, no-match no-write) and
// summarizeMultiAgent (derived counts, groupsDetail, nextAction ladder).
//
// Evidence: SPEC/multi-agent.md section A (recordMultiAgentWorkerOutput,
// summarizeMultiAgent rows), "summarizeMultiAgent().nextAction (in order)"
// exact-outputs block, Edge cases ("no matching membership returns []").

const assert = require("node:assert/strict");
const {
  createMultiAgentRun,
  createAgentRole,
  createAgentGroup,
  assignAgentMembership,
  recordMultiAgentWorkerOutput,
  summarizeMultiAgent,
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

// No matching membership returns [] without writing anything.
{
  const run = makeRun("run-1");
  const result = recordMultiAgentWorkerOutput(run, { workerId: "ghost", taskId: "task-1", evidence: [] }, NOW);
  assert.deepEqual(result, []);
}

// Matching membership: status -> "reported", evidence refs merged
// (locator/path/summary/id fallback chain, falsy filtered out).
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const membership = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  const updated = recordMultiAgentWorkerOutput(
    run,
    {
      workerId: "w1",
      taskId: "task-1",
      resultNodeId: "node-result-1",
      verifierNodeId: "node-verify-1",
      evidence: [{ id: "ev-1", locator: "loc-1" }, { id: "ev-2", path: "path-2" }, { id: "ev-3" }],
      artifactPaths: ["artifact.md"],
      blackboardMessageIds: ["msg-0001"],
    },
    NOW
  );
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, membership.id);
  assert.equal(updated[0].status, "reported");
  assert.equal(updated[0].resultNodeId, "node-result-1");
  assert.equal(updated[0].verifierNodeId, "node-verify-1");
  assert.deepEqual(updated[0].evidenceRefs, ["ev-3", "loc-1", "path-2"], "evidence ref falls back locator -> path -> summary -> id, then kernel unique() sorts them");
  assert.deepEqual(updated[0].artifactPaths, ["artifact.md"]);
  assert.deepEqual(updated[0].blackboardMessageIds, ["msg-0001"]);
}

// Calling twice merges (does not duplicate) evidence refs via unique().
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  recordMultiAgentWorkerOutput(run, { workerId: "w1", taskId: "task-1", evidence: [{ id: "ev-1", locator: "loc-1" }] }, NOW);
  const second = recordMultiAgentWorkerOutput(run, { workerId: "w1", taskId: "task-1", evidence: [{ id: "ev-1", locator: "loc-1" }, { id: "ev-2", locator: "loc-2" }] }, NOW);
  assert.deepEqual(second[0].evidenceRefs.sort(), ["loc-1", "loc-2"], "repeat calls merge evidence without duplicating");
}

// summarizeMultiAgent: totals, per-group role coverage rows, blocked
// reasons collected from failed memberships.
{
  const run = makeRun("run-1", [makeTask("task-1"), makeTask("task-2")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id, requiredEvidence: ["some evidence"] }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  const m1 = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  const m2 = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-2", workerId: "w2" }, NOW, policyForMembership, workerExists);
  m2.status = "failed";
  recordMultiAgentWorkerOutput(run, { workerId: "w1", taskId: "task-1", evidence: [{ id: "ev-1", locator: "loc-1" }] }, NOW);

  const summary = summarizeMultiAgent(run);
  assert.equal(summary.totalRuns, 1);
  assert.equal(summary.roles, 1);
  assert.equal(summary.groups, 1);
  assert.equal(summary.memberships, 2);
  assert.deepEqual(summary.runsByStatus, { planned: 1 });
  assert.deepEqual(summary.blockedReasons, [`${m2.id}: failed membership`], "a failed membership contributes a blocked reason");
  assert.equal(summary.groupsDetail.length, 1);
  const roleDetail = summary.groupsDetail[0].roles.find((r) => r.roleId === role.id);
  assert.equal(roleDetail.requiredEvidence, 1);
  assert.equal(roleDetail.memberships, 2);
  assert.equal(roleDetail.reported, 1, "only m1 counts as reported (status+evidence)");
  assert.equal(roleDetail.missing, 1);
}

// nextAction ladder: no runs at all.
{
  const run = makeRun("run-1");
  const summary = summarizeMultiAgent(run);
  assert.equal(summary.nextAction, "cw multi-agent run run-1 --id <multi-agent-run-id>");
}

// nextAction ladder: a group with memberships and no fanin -> fanin command.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id }, NOW, policyForGroup);
  assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);
  const summary = summarizeMultiAgent(run);
  // No blocked reasons and no running-with-worker membership (worker just
  // ran once, status is "running" here so the running-membership branch
  // fires before the no-fanin branch — assert whichever the ladder picks,
  // matching the SPEC's own stated priority order.
  assert.equal(summary.nextAction, `cw worker manifest run-1 w1`, "a running membership with a worker takes priority over the no-fanin branch");
}

process.stdout.write("maruntime-worker-output-summary: ok\n");
