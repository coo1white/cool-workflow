#!/usr/bin/env node
"use strict";

// cw topology list|show|validate — the built-in topology catalog. Static
// data, no run/repo needed. Pins the exact three official topology ids, the
// per-topology roles/groups/topics/phases/requiredEvidence, and the
// validate success/failure shapes.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const list = run(["topology", "list"]);
  assert.equal(list.status, 0);
  const defs = JSON.parse(list.stdout);
  assert.deepEqual(
    defs.map((d) => d.id),
    ["map-reduce", "debate", "judge-panel"],
    "the three built-in topologies, in this exact order"
  );
  for (const d of defs) assert.equal(d.schemaVersion, 1);

  const mapReduce = defs[0];
  assert.equal(mapReduce.title, "Map-Reduce");
  assert.deepEqual(mapReduce.roles.map((r) => r.id), ["mapper", "reducer"]);
  assert.equal(mapReduce.roles[0].title, "Mapper");
  assert.equal(mapReduce.roles[0].count, 2);
  assert.equal(mapReduce.roles[1].title, "Reducer");
  assert.equal(mapReduce.roles[1].count, undefined);
  assert.deepEqual(mapReduce.groups.map((g) => g.id), ["map-reduce"]);
  assert.deepEqual(
    mapReduce.blackboardTopics.map((t) => t.id),
    ["mapper-outputs", "reducer-synthesis"]
  );
  assert.deepEqual(mapReduce.phases.map((p) => p.id), ["map", "reduce"]);
  assert.deepEqual(mapReduce.requiredEvidence, [
    "mapper output artifact",
    "blackboard artifact ref",
    "reducer synthesis",
  ]);
  assert.deepEqual(mapReduce.coordinatorDecisions, [
    "artifact-index",
    "fanin-readiness",
    "candidate-synthesis",
  ]);

  const debate = defs[1];
  assert.deepEqual(debate.roles.map((r) => r.id), ["position-a", "position-b", "synthesizer"]);
  assert.deepEqual(debate.phases.map((p) => p.id), ["opening", "rebuttal", "synthesis"]);
  assert.deepEqual(debate.requiredEvidence, [
    "debate message",
    "conflict context",
    "coordinator decision",
    "final synthesis",
  ]);

  const judgePanel = defs[2];
  assert.deepEqual(judgePanel.roles.map((r) => r.id), ["judge", "panel-chair"]);
  assert.equal(judgePanel.roles[0].count, 3);
  assert.deepEqual(judgePanel.phases.map((p) => p.id), ["judge", "panel"]);
  assert.deepEqual(judgePanel.requiredEvidence, [
    "judge output",
    "score record",
    "panel decision",
    "candidate selection rationale",
  ]);

  // topology show <id> gives the same shape as one list entry.
  const shown = run(["topology", "show", "map-reduce"]);
  assert.equal(shown.status, 0);
  assert.deepEqual(JSON.parse(shown.stdout), mapReduce);

  // topology validate <id> — known-good.
  const validGood = run(["topology", "validate", "debate"]);
  assert.equal(validGood.status, 0);
  const goodPayload = JSON.parse(validGood.stdout);
  assert.equal(goodPayload.valid, true);
  assert.equal(goodPayload.topologyId, "debate");
  assert.deepEqual(goodPayload.issues, []);

  // topology validate <id> — unknown id: exit 1, exact issue code+message.
  const validBad = run(["topology", "validate", "nosuchtopology"]);
  assert.equal(validBad.status, 1);
  const badPayload = JSON.parse(validBad.stdout);
  assert.equal(badPayload.valid, false);
  assert.equal(badPayload.topologyId, "nosuchtopology");
  assert.deepEqual(badPayload.issues, [
    { code: "unknown-topology", message: "Unknown topology id: nosuchtopology" },
  ]);

  // topology show <unknown-id> throws.
  const showBad = run(["topology", "show", "nosuchtopology"]);
  assert.equal(showBad.status, 1);
  assert.equal(showBad.stdout, "");
  assert.match(showBad.stderr, /Unknown topology (run )?id: nosuchtopology/);
});
