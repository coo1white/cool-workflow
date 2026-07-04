#!/usr/bin/env node
// maruntime-topology-official (multiagent-core bucket) — pins
// OFFICIAL_TOPOLOGIES's exact content (the 3 built-in topologies) and
// validateTopologyDefinition's structural checks + issue codes.
//
// Evidence: SPEC/multi-agent.md section B ("Built-in topology content
// (exact)"), "Topology error strings and outputs" exact-outputs block.

const assert = require("node:assert/strict");
const {
  OFFICIAL_TOPOLOGIES,
  getTopologyDefinition,
  listTopologyDefinitions,
  validateTopologyDefinition,
  registerTopology,
} = require("../dist/core/multi-agent/topology");

// Exactly 3 official topologies, in this exact order: map-reduce, debate,
// judge-panel.
{
  assert.equal(OFFICIAL_TOPOLOGIES.length, 3);
  assert.deepEqual(OFFICIAL_TOPOLOGIES.map((t) => t.id), ["map-reduce", "debate", "judge-panel"]);
}

// map-reduce exact content.
{
  const def = OFFICIAL_TOPOLOGIES[0];
  assert.equal(def.title, "Map-Reduce");
  assert.deepEqual(def.roles.map((r) => r.id), ["mapper", "reducer"]);
  const mapper = def.roles.find((r) => r.id === "mapper");
  assert.equal(mapper.title, "Mapper");
  assert.equal(mapper.count, 2, "mapper role has a default count of 2");
  const reducer = def.roles.find((r) => r.id === "reducer");
  assert.equal(reducer.title, "Reducer");
  assert.equal(reducer.count, undefined, "reducer has no default count (implicit 1)");
  assert.deepEqual(def.groups, [{ id: "map-reduce", title: "Map-Reduce Group", roleIds: ["mapper", "reducer"] }]);
  assert.deepEqual(def.blackboardTopics.map((t) => t.id), ["mapper-outputs", "reducer-synthesis"]);
  assert.deepEqual(def.phases.map((p) => p.id), ["map", "reduce"]);
  assert.deepEqual(def.requiredEvidence, ["mapper output artifact", "blackboard artifact ref", "reducer synthesis"]);
  assert.deepEqual(def.coordinatorDecisions, ["artifact-index", "fanin-readiness", "candidate-synthesis"]);
}

// debate exact content.
{
  const def = OFFICIAL_TOPOLOGIES[1];
  assert.equal(def.title, "Debate");
  assert.deepEqual(def.roles.map((r) => r.id), ["position-a", "position-b", "synthesizer"]);
  assert.deepEqual(def.groups, [{ id: "debate", title: "Debate Group", roleIds: ["position-a", "position-b", "synthesizer"] }]);
  assert.deepEqual(def.blackboardTopics.map((t) => t.id), ["debate-rounds", "debate-conflicts", "debate-synthesis"]);
  assert.deepEqual(def.phases.map((p) => p.id), ["opening", "rebuttal", "synthesis"]);
  assert.deepEqual(def.requiredEvidence, ["debate message", "conflict context", "coordinator decision", "final synthesis"]);
}

// judge-panel exact content.
{
  const def = OFFICIAL_TOPOLOGIES[2];
  assert.equal(def.title, "Judge Panel");
  assert.deepEqual(def.roles.map((r) => r.id), ["judge", "panel-chair"]);
  const judge = def.roles.find((r) => r.id === "judge");
  assert.equal(judge.count, 3, "judge role has a default count of 3");
  assert.deepEqual(def.groups, [{ id: "judge-panel", title: "Judge Panel Group", roleIds: ["judge", "panel-chair"] }]);
  assert.deepEqual(def.blackboardTopics.map((t) => t.id), ["judge-verdicts", "panel-decision"]);
  assert.deepEqual(def.requiredEvidence, ["judge output", "score record", "panel decision", "candidate selection rationale"]);
}

// getTopologyDefinition: official lookup by id, unregistered id is undefined.
{
  assert.equal(getTopologyDefinition("map-reduce").id, "map-reduce");
  assert.equal(getTopologyDefinition("no-such-topology"), undefined);
}

// registerTopology / listTopologyDefinitions: registered wins on id clash
// (overwrites the official one), unregistered entries are appended.
{
  registerTopology({ ...OFFICIAL_TOPOLOGIES[0], title: "Custom Map-Reduce" });
  const list = listTopologyDefinitions();
  const mapReduce = list.find((t) => t.id === "map-reduce");
  assert.equal(mapReduce.title, "Custom Map-Reduce", "a registered definition overrides the official one with the same id");
  assert.equal(list.length, 3, "overwriting an existing id does not grow the list");

  registerTopology({ ...OFFICIAL_TOPOLOGIES[0], id: "custom-topology", title: "Brand New" });
  const list2 = listTopologyDefinitions();
  assert.equal(list2.length, 4, "a genuinely new id is appended");
  assert.ok(list2.some((t) => t.id === "custom-topology"));
}

// listTopologyDefinitions returns deep clones (mutating the result does
// not corrupt OFFICIAL_TOPOLOGIES).
{
  const list = listTopologyDefinitions();
  const debate = list.find((t) => t.id === "debate");
  debate.roles.push({ id: "mutated", title: "x", responsibilities: [], requiredEvidence: [], expectedArtifacts: [], faninObligations: [] });
  const officialDebate = OFFICIAL_TOPOLOGIES.find((t) => t.id === "debate");
  assert.equal(officialDebate.roles.length, 3, "mutating a listed definition must not affect OFFICIAL_TOPOLOGIES");
}

// validateTopologyDefinition: unknown id.
{
  const result = validateTopologyDefinition("no-such-topology");
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [{ code: "unknown-topology", message: "Unknown topology id: no-such-topology" }]);
}

// validateTopologyDefinition: the 3 official topologies are all valid.
{
  for (const def of OFFICIAL_TOPOLOGIES) {
    const result = validateTopologyDefinition(def.id);
    assert.equal(result.valid, true, `${def.id} must validate clean`);
    assert.deepEqual(result.issues, []);
  }
}

// validateTopologyDefinition: a phase referencing an unknown role id is
// flagged, but does not throw.
{
  registerTopology({
    schemaVersion: 1,
    id: "broken-topology",
    title: "Broken",
    summary: "s",
    roles: [{ id: "only-role", title: "Only", responsibilities: [], requiredEvidence: [], expectedArtifacts: [], faninObligations: [] }],
    groups: [{ id: "g", title: "G", roleIds: ["only-role"] }],
    blackboardTopics: [{ id: "t", title: "T", description: "d" }],
    phases: [{ id: "phase-1", title: "P1", roleIds: ["only-role", "ghost-role"], fanout: true, fanin: false, requiredEvidence: [], coordinatorDecisionKinds: [] }],
    fanoutStrategy: "s",
    faninStrategy: "s",
    requiredEvidence: ["e"],
    coordinatorDecisions: [],
    candidateExpectations: [],
    verifierGates: [],
  });
  const result = validateTopologyDefinition("broken-topology");
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [{ code: "unknown-phase-role", message: "Phase phase-1 references unknown role ghost-role.", path: "phases.phase-1" }]);
}

process.stdout.write("maruntime-topology-official: ok\n");
