#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  createContext,
  dispatchAndOutput,
  planArchitecture,
  runJson
} = require("./topology-smoke-helper.js");

// `topology apply <run> <topology> --id <custom>` must honor the custom run
// id, so the run's roles/group/fanout are prefixed `topo-debate-`
// (position-a, group, fanout). The whole test is built on that prefix (see
// the dispatchAndOutput calls and the `topo-debate-debate-conflicts` topic
// below).
const ctx = createContext("cw-topologies-debate-");
const plan = planArchitecture(ctx, "Prove v0.1.19 debate topology.");

const debateRun = runJson(ctx, [
  "topology",
  "apply",
  plan.runId,
  "debate",
  "--id",
  "topo-debate",
  "--task",
  "map:db-security",
  "--task",
  "map:deploy-config"
]);
assert.equal(debateRun.roleIds.includes("topo-debate-position-a"), true);

dispatchAndOutput(ctx, plan.runId, "topo-debate-ma", "topo-debate-group", "topo-debate-position-a", "topo-debate-fanout", "position a");
dispatchAndOutput(ctx, plan.runId, "topo-debate-ma", "topo-debate-group", "topo-debate-position-b", "topo-debate-fanout", "position b");

// v2 CLI grammar change (same as coordinator-blackboard-smoke): the
// blackboard family dropped the per-verb action word, so the run id is the
// FIRST positional — `blackboard context <run-id>`, NOT
// `blackboard context put <run-id>`. Adapted to the v2 spelling; every
// result assertion below is unchanged.
const claimA = runJson(ctx, [
  "blackboard",
  "context",
  plan.runId,
  "--blackboard",
  debateRun.blackboardId,
  "--topic",
  "topo-debate-debate-conflicts",
  "--kind",
  "fact",
  "--key",
  "claim",
  "--value",
  "Position A accepts the change.",
  "--evidence",
  ctx.evidenceLocator
]);
const claimB = runJson(ctx, [
  "blackboard",
  "context",
  plan.runId,
  "--blackboard",
  debateRun.blackboardId,
  "--topic",
  "topo-debate-debate-conflicts",
  "--kind",
  "fact",
  "--key",
  "claim",
  "--value",
  "Position B rejects the change."
]);
assert.equal(claimB.status, "conflicting");

const debateDecision = runJson(ctx, [
  "coordinator",
  "decision",
  plan.runId,
  "--blackboard",
  debateRun.blackboardId,
  "--kind",
  "conflict-resolution",
  "--outcome",
  "conflicting",
  "--subject",
  claimA.id,
  "--subject",
  claimB.id,
  "--reason",
  "Debate records accepted and conflicting claims for synthesis."
]);
assert.equal(debateDecision.outcome, "conflicting");

const summary = runJson(ctx, ["topology", "summary", plan.runId, "--json"]);
assert.equal(summary.totalRuns, 1);
assert.ok(summary.active.some((entry) => entry.topologyId === "debate"));

const audit = runJson(ctx, ["audit", "summary", plan.runId]);
assert.ok(audit.topologies.events >= 1);
assert.ok(audit.byKind["topology.create"] >= 1);

process.stdout.write("multi-agent-topologies-debate-smoke: ok\n");
