#!/usr/bin/env node
// maruntime-role-create (multiagent-core bucket) — pins createAgentRole:
// default id/status, topicIds inherited+merged from the parent run,
// parent-role linking, injected policyFor callback, duplicate-id fail-closed.
//
// Evidence: SPEC/multi-agent.md section A (createAgentRole row),
// Invariant 1 (fail closed on identity), 11 (id determinism).

const assert = require("node:assert/strict");
const { createMultiAgentRun, createAgentRole, requireAgentRole } = require("../dist/core/multi-agent/runtime");
const { policyForRole } = require("../dist/core/multi-agent/trust-policy");

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

// Default id role-0001, status planned, title defaults to id.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  assert.equal(role.id, "role-0001");
  assert.equal(role.status, "planned");
  assert.equal(role.title, "role-0001");
  assert.equal(role.multiAgentRunId, mar.id);
  assert.deepEqual(role.childRoleIds, []);
  assert.equal(role.lifecycle.length, 1);
}

// Unknown multiAgentRunId throws before any role is created.
{
  const run = makeRun("run-1");
  assert.throws(
    () => createAgentRole(run, { multiAgentRunId: "no-such" }, NOW, policyForRole),
    /Unknown MultiAgentRun id: no-such/
  );
}

// Duplicate explicit role id throws (fail-closed on identity).
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  createAgentRole(run, { multiAgentRunId: mar.id, id: "role-a" }, NOW, policyForRole);
  assert.throws(
    () => createAgentRole(run, { multiAgentRunId: mar.id, id: "role-a" }, NOW, policyForRole),
    /Duplicate AgentRole id: role-a/
  );
}

// topicIds: role's topicIds = unique([...run.topicIds, ...input.topicIds]);
// the sorting kernel unique() applies.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, { topicIds: ["run-topic"] }, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id, topicIds: ["role-topic"] }, NOW, policyForRole);
  assert.deepEqual(role.topicIds, ["role-topic", "run-topic"], "role topicIds merge run + role topics, sorted");
}

// blackboardId inherited from the multi-agent run when not given explicitly.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, { blackboardId: "bb-0001" }, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  assert.equal(role.blackboardId, "bb-0001", "role inherits the run's blackboardId when not given");
  const explicit = createAgentRole(run, { multiAgentRunId: mar.id, blackboardId: "bb-0002" }, NOW, policyForRole);
  assert.equal(explicit.blackboardId, "bb-0002", "explicit blackboardId overrides inheritance");
}

// policyFor callback is invoked with the constructed role and its result
// is attached; run.roleIds gains the new role id and the run is touched.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  let receivedRole;
  const role = createAgentRole(run, { multiAgentRunId: mar.id, title: "Chair" }, NOW, (r) => {
    receivedRole = r;
    return { schemaVersion: 1, id: "custom-policy", policyRef: "x", subjectKind: "role", subjectId: r.id, allowedBlackboardTopicIds: [], allowedWriteOperations: [], allowedCandidateOperations: [], allowedJudgeOperations: [], sandboxProfileHints: [], requiredEvidenceRefs: [], deniedOperations: [] };
  });
  assert.equal(receivedRole.title, "Chair", "policyFor callback receives the fully-constructed role");
  assert.equal(role.policy.id, "custom-policy", "policyFor's return value is attached as role.policy");
  const reloadedRun = mar;
  assert.deepEqual(reloadedRun.roleIds, [role.id], "run.roleIds gains the new role id");
}

// Parent-role linking: parentRoleId must already exist; the parent gains
// the child id in childRoleIds and is touched.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const parentRole = createAgentRole(run, { multiAgentRunId: mar.id, title: "Parent" }, NOW, policyForRole);
  const LATER = "2020-06-01T00:00:00.000Z";
  const childRole = createAgentRole(run, { multiAgentRunId: mar.id, title: "Child", parentRoleId: parentRole.id }, LATER, policyForRole);
  const reloadedParent = requireAgentRole(run, parentRole.id);
  assert.deepEqual(reloadedParent.childRoleIds, [childRole.id]);
  assert.equal(reloadedParent.updatedAt, LATER);
}

{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  assert.throws(
    () => createAgentRole(run, { multiAgentRunId: mar.id, parentRoleId: "no-such-role" }, NOW, policyForRole),
    /Unknown AgentRole id: no-such-role/
  );
}

process.stdout.write("maruntime-role-create: ok\n");
