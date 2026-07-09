#!/usr/bin/env node
// maruntime-topology-id-graph (multiagent-core bucket) — pins
// topologyRunId's deterministic content-hash format, selectedTaskIds,
// buildTopologyGraphFromRuns, nextActionsFor, statusToNodeStatus
// (topology-side table), and topology.ts's own NON-SORTING `unique()` —
// the byte-compat item 3 counter-case this bucket must specifically
// cover (insertion order preserved, opposite of runtime.ts's sorting one).
//
// Evidence: SPEC/multi-agent.md section B ("Deterministic default
// topology-run id", "nextActions (exact)"), Edge cases (the two unique()
// families), rebuild risk 1/2.

const assert = require("node:assert/strict");
const {
  unique,
  topologyRunId,
  selectedTaskIds,
  nextActionsFor,
  statusToNodeStatus,
  buildTopologyGraphFromRuns,
  OFFICIAL_TOPOLOGIES,
} = require("../dist/core/multi-agent/topology");
const { stableHash } = require("../dist/core/hash");

// topology.ts's unique(): dedup only, does NOT sort, drops null/undefined
// but KEEPS empty string / 0 / false (only null/undefined are filtered,
// unlike runtime.ts's unique() which filters ALL falsy values).
{
  assert.deepEqual(unique(["z", "a", "z", "b"]), ["z", "a", "b"], "topology unique() preserves insertion order, does NOT sort");
  assert.deepEqual(unique([1, 2, 1, 3]), [1, 2, 3], "topology unique() dedupes non-string values too");
  assert.deepEqual(unique(["", "a", ""]), ["", "a"], "topology unique() KEEPS empty string (only null/undefined filtered)");
  assert.deepEqual(unique([null, undefined, "a"]), ["a"], "topology unique() drops null and undefined");
  assert.deepEqual(unique([]), []);
}

// This is the direct byte-compat item 3 counter-case check: the same
// unsorted input produces a DIFFERENT result from runtime.ts's sorting
// unique() (verified against the sibling maruntime-shared-primitives.test.js
// coverage of runtime.ts's unique — asserted independently here so this
// file alone catches a regression that makes topology.ts start sorting).
{
  const input = ["z", "a", "m"];
  const result = unique(input);
  assert.deepEqual(result, ["z", "a", "m"], "topology.ts unique() must NOT sort — if this fails, someone merged it with the sorting kernel variant");
  assert.notDeepEqual(result, [...input].sort(), "a sorted result here would mean the two unique() implementations were wrongly collapsed");
}

// topologyRunId: `${definitionId}-${first16HexCharsOfHash}`; hash is
// injected (this file's caller supplies core/hash.ts's stableHash), over
// {definitionId, roleIds sorted, taskIds sorted, runId, sequence}.
{
  const definition = OFFICIAL_TOPOLOGIES.find((t) => t.id === "map-reduce");
  const id = topologyRunId(definition, ["task-2", "task-1"], "run-1", 0, stableHash);
  assert.ok(id.startsWith("map-reduce-"), "topology-run id is prefixed with the definition id");
  const suffix = id.slice("map-reduce-".length);
  assert.equal(suffix.length, 16, "the hash suffix is exactly 16 hex chars");
  assert.ok(/^[0-9a-f]{16}$/.test(suffix), "the hash suffix is lowercase hex");
}

// topologyRunId is deterministic: same inputs (in any taskId order) give
// the same id, because taskIds are sorted before hashing.
{
  const definition = OFFICIAL_TOPOLOGIES.find((t) => t.id === "debate");
  const a = topologyRunId(definition, ["task-1", "task-2"], "run-1", 0, stableHash);
  const b = topologyRunId(definition, ["task-2", "task-1"], "run-1", 0, stableHash);
  assert.equal(a, b, "task id order does not affect the topology-run id (taskIds are sorted before hashing)");
}

// Different sequence numbers (representing successive topology runs on
// the same WorkflowRun) mint different ids.
{
  const definition = OFFICIAL_TOPOLOGIES.find((t) => t.id === "judge-panel");
  const first = topologyRunId(definition, ["task-1"], "run-1", 0, stableHash);
  const second = topologyRunId(definition, ["task-1"], "run-1", 1, stableHash);
  assert.notEqual(first, second, "sequence number is part of the hash input, so repeated applies to the same run mint distinct ids");
}

// selectedTaskIds: explicit taskIds pass through (after existence check);
// with none given, defaults to the first pending task, else the first
// task overall.
{
  const tasks = [{ id: "t1", status: "completed" }, { id: "t2", status: "pending" }, { id: "t3", status: "pending" }];
  assert.deepEqual(selectedTaskIds(tasks, ["t3"]), ["t3"], "explicit taskIds pass through");
  assert.deepEqual(selectedTaskIds(tasks), ["t2"], "defaults to the first pending task");
  assert.deepEqual(selectedTaskIds([{ id: "only", status: "completed" }]), ["only"], "no pending task falls back to the first task overall");
  assert.deepEqual(selectedTaskIds([]), [], "no tasks at all yields an empty list");
}

{
  assert.throws(
    () => selectedTaskIds([{ id: "t1", status: "pending" }], ["no-such-task"]),
    /Unknown task id for topology: no-such-task/
  );
}

// nextActionsFor: the exact 3-line SPEC command list.
{
  const actions = nextActionsFor("run-1", "map-reduce-abc123", "fanout-0001");
  assert.deepEqual(actions, [
    "cw dispatch run-1 --multi-agent-fanout fanout-0001",
    "cw multi-agent fanin run-1 map-reduce-abc123-fanin --fanout fanout-0001",
    "cw topology summary run-1",
  ]);
}

// statusToNodeStatus (topology-side table): completed/ready -> completed;
// blocked/failed/running pass through; else pending.
{
  assert.equal(statusToNodeStatus("completed"), "completed");
  assert.equal(statusToNodeStatus("ready"), "completed");
  assert.equal(statusToNodeStatus("blocked"), "blocked");
  assert.equal(statusToNodeStatus("failed"), "failed");
  assert.equal(statusToNodeStatus("running"), "running");
  assert.equal(statusToNodeStatus("planned"), "pending", "unknown/other status defaults to pending");
}

// buildTopologyGraphFromRuns: node id pattern, edges to multi-agent run +
// blackboard, per-topic/role/group/fanout/fanin/decision edges, dedup.
{
  const records = [
    {
      id: "topo-run-1",
      topologyId: "map-reduce",
      status: "planned",
      multiAgentRunId: "mar-0001",
      blackboardId: "bb-0001",
      topicIds: ["topic-1"],
      roleIds: ["role-1"],
      groupIds: ["group-1"],
      fanoutIds: ["fanout-1"],
      faninIds: ["fanin-1"],
      coordinatorDecisionIds: ["decision-1"],
    },
  ];
  const graph = buildTopologyGraphFromRuns("run-1", records, (id) => `/path/${id}.json`);
  const nodeIds = graph.nodes.map((n) => n.id);
  assert.deepEqual(nodeIds, ["run-1:topology:topo-run-1"]);
  assert.equal(graph.nodes[0].label, "map-reduce:topo-run-1");
  assert.equal(graph.nodes[0].path, "/path/topo-run-1.json");
  const edgePairs = graph.edges.map((e) => `${e.from}->${e.to}:${e.label || ""}`);
  assert.ok(edgePairs.includes("run-1:run->run-1:topology:topo-run-1:"));
  assert.ok(edgePairs.includes("run-1:topology:topo-run-1->run-1:multi-agent:mar-0001:multi-agent"));
  assert.ok(edgePairs.includes("run-1:topology:topo-run-1->run-1:blackboard:bb-0001:blackboard"));
  assert.ok(edgePairs.includes("run-1:topology:topo-run-1->run-1:blackboard:topic:topic-1:topic"));
  assert.ok(edgePairs.includes("run-1:topology:topo-run-1->run-1:multi-agent:role:role-1:role"));
  assert.ok(edgePairs.includes("run-1:topology:topo-run-1->run-1:multi-agent:fanin:fanin-1:fanin"));
  assert.ok(edgePairs.includes("run-1:topology:topo-run-1->run-1:blackboard:decision:decision-1:decision"));
}

process.stdout.write("maruntime-topology-id-graph: ok\n");
