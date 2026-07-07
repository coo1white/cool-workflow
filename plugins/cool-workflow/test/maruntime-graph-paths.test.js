#!/usr/bin/env node
// maruntime-graph-paths (multiagent-core bucket) — pins
// buildMultiAgentGraph's node-id format, edge dedup, and recordPath's/
// multiAgentRoot's path derivation.
//
// Evidence: SPEC/multi-agent.md "Graph node id patterns" exact-outputs
// block, "Files on disk" (multi-agent index/record file layout).

const assert = require("node:assert/strict");
const {
  createMultiAgentRun,
  createAgentRole,
  createAgentGroup,
  assignAgentMembership,
  buildMultiAgentGraph,
  recordPath,
  multiAgentRoot,
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

// recordPath: `<multiAgentDir>/<plural kind>/<safeFileName(id)>.json`,
// falling back to `<runDir>/multi-agent` when multiAgentDir is unset.
{
  const run = makeRun("run-1");
  assert.equal(recordPath(run, "runs", "mar-0001"), "/tmp/x/.cw/runs/run-1/multi-agent/runs/mar-0001.json", "falls back to runDir/multi-agent when paths.multiAgentDir is unset");
  run.paths.multiAgentDir = "/custom/multi-agent-dir";
  assert.equal(recordPath(run, "roles", "role-0001"), "/custom/multi-agent-dir/roles/role-0001.json");
  assert.equal(multiAgentRoot(run), "/custom/multi-agent-dir");
}

// recordPath safeFileName: chars outside [a-zA-Z0-9_.:-] become "_".
{
  const run = makeRun("run-1");
  const path = recordPath(run, "roles", "role with spaces/and*stars");
  assert.equal(path, "/tmp/x/.cw/runs/run-1/multi-agent/roles/role_with_spaces_and_stars.json");
}

// buildMultiAgentGraph: node id patterns for run/role/group/membership,
// run root edge, blackboard edges, task edges.
{
  const run = makeRun("run-1", [makeTask("task-1")]);
  const mar = createMultiAgentRun(run, { blackboardId: "bb-0001" }, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id, taskIds: ["task-1"] }, NOW, policyForGroup);
  const membership = assignAgentMembership(run, { groupId: group.id, roleId: role.id, taskId: "task-1", workerId: "w1" }, NOW, policyForMembership, workerExists);

  const graph = buildMultiAgentGraph(run);
  const nodeIds = graph.nodes.map((n) => n.id);
  assert.ok(nodeIds.includes(`run-1:multi-agent:${mar.id}`), "multi-agent run node id pattern");
  assert.ok(nodeIds.includes(`run-1:multi-agent:role:${role.id}`), "role node id pattern");
  assert.ok(nodeIds.includes(`run-1:multi-agent:group:${group.id}`), "group node id pattern");
  assert.ok(nodeIds.includes(`run-1:multi-agent:membership:${membership.id}`), "membership node id pattern");

  const edgePairs = graph.edges.map((e) => `${e.from}->${e.to}:${e.label || ""}`);
  assert.ok(edgePairs.includes(`run-1:run->run-1:multi-agent:${mar.id}:`), "run-root edge to the multi-agent run");
  assert.ok(edgePairs.includes(`run-1:multi-agent:${mar.id}->run-1:blackboard:bb-0001:blackboard`), "multi-agent run links to its blackboard");
  assert.ok(edgePairs.includes(`run-1:multi-agent:membership:${membership.id}->run-1:task:task-1:task`), "membership links to its task");
  assert.ok(edgePairs.includes(`run-1:multi-agent:membership:${membership.id}->run-1:worker:w1:worker`), "membership links to its worker");
}

// Edges are de-duplicated via uniqueEdges (from,to,label triple).
{
  const run = makeRun("run-1", [makeTask("task-1"), makeTask("task-2")]);
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id }, NOW, policyForRole);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id, taskIds: ["task-1", "task-2"] }, NOW, policyForGroup);
  const graph = buildMultiAgentGraph(run);
  const seen = new Set();
  for (const edge of graph.edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    assert.ok(!seen.has(key), `edge ${key} must not repeat`);
    seen.add(key);
  }
}

process.stdout.write("maruntime-graph-paths: ok\n");
