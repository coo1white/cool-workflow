#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createContext,
  dispatchAndOutput,
  planArchitecture,
  runJson,
  runText
} = require("./topology-smoke-helper.js");

const ctx = createContext("cw-topologies-map-");

const plan = planArchitecture(ctx, "Prove v0.1.19 map-reduce topology.");

const listed = runJson(ctx, ["topology", "list"]);
assert.deepEqual(listed.map((entry) => entry.id).sort(), ["debate", "judge-panel", "map-reduce"]);
assert.equal(runJson(ctx, ["topology", "validate", "map-reduce"]).valid, true);
assert.match(runText(ctx, ["topology", "show", "debate"]), /Debate/);

const mapRun = runJson(ctx, [
  "topology",
  "apply",
  plan.runId,
  "map-reduce",
  "--id",
  "topo-map",
  "--mapper-count",
  "2",
  "--task",
  "map:server-api",
  "--task",
  "map:web-client"
]);
assert.equal(mapRun.topologyId, "map-reduce");
assert.equal(mapRun.roleIds.filter((id) => id.includes("mapper")).length, 2);
assert.equal(mapRun.fanoutIds[0], "topo-map-fanout");

dispatchAndOutput(ctx, plan.runId, "topo-map-ma", "topo-map-group", "topo-map-mapper-1", "topo-map-fanout", "mapper one");
const missing = runJson(ctx, [
  "multi-agent",
  "fanin",
  plan.runId,
  "topo-map-fanin-missing",
  "--group",
  "topo-map-group",
  "--fanout",
  "topo-map-fanout",
  "--required-role",
  "topo-map-mapper-1",
  "--required-role",
  "topo-map-mapper-2",
  "--blackboard",
  mapRun.blackboardId
]);
assert.equal(missing.status, "blocked");
assert.ok(missing.missingRoleIds.includes("topo-map-mapper-2"));

dispatchAndOutput(ctx, plan.runId, "topo-map-ma", "topo-map-group", "topo-map-mapper-2", "topo-map-fanout", "mapper two");
const ready = runJson(ctx, [
  "multi-agent",
  "fanin",
  plan.runId,
  "topo-map-fanin-ready",
  "--group",
  "topo-map-group",
  "--fanout",
  "topo-map-fanout",
  "--required-role",
  "topo-map-mapper-1",
  "--required-role",
  "topo-map-mapper-2",
  "--blackboard",
  mapRun.blackboardId
]);
assert.equal(ready.status, "ready");
assert.equal(ready.verifierReady, true);
assert.equal(ready.blackboardArtifactRefIds.length, 2);

const reduceDecision = runJson(ctx, [
  "coordinator",
  "decision",
  plan.runId,
  "--blackboard",
  mapRun.blackboardId,
  "--kind",
  "candidate-synthesis",
  "--outcome",
  "ready",
  "--reason",
  "Reducer synthesis cites indexed mapper artifacts and fanin evidence.",
  "--artifact",
  ready.blackboardArtifactRefIds[0],
  "--artifact",
  ready.blackboardArtifactRefIds[1]
]);
assert.equal(reduceDecision.outcome, "ready");

const summary = runJson(ctx, ["topology", "summary", plan.runId, "--json"]);
assert.equal(summary.totalRuns, 1);
assert.ok(summary.active.some((entry) => entry.topologyId === "map-reduce" && entry.fanins.includes("topo-map-fanin-ready")));

const audit = runJson(ctx, ["audit", "summary", plan.runId]);
assert.ok(audit.topologies.events >= 2);
assert.ok(audit.byKind["topology.create"] >= 1);
assert.ok(audit.blackboard.artifacts >= 2);

const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
assert.equal(state.topologies.schemaVersion, 1);
assert.equal(state.topologies.runs.length, 1);
assert.ok(fs.existsSync(path.join(ctx.tmp, ".cw", "runs", plan.runId, "topologies", "runs", "topo-map.json")));

process.stdout.write("multi-agent-topologies-map-reduce-smoke: ok\n");
