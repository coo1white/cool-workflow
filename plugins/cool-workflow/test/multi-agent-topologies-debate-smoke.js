#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  createContext,
  dispatchAndOutput,
  planArchitecture,
  runJson
} = require("./topology-smoke-helper.js");

// REAL-GAP (v2): `topology apply <run> <topology> --id <custom>` no longer
// honors the custom run id. This smoke is black-box (CLI-only via
// topology-smoke-helper.js) — there are no old flat-dist requires to repoint,
// so the failure below lands on genuine v2 behavior, not an import crash.
//
// In the old build, `--id topo-debate` set the topology-run id, so the run's
// roles/group/fanout were prefixed `topo-debate-` (position-a, group, fanout).
// The whole test is built on that prefix (see the dispatchAndOutput calls and
// the `topo-debate-debate-conflicts` topic below).
//
// v2 drops the id: topologyApplyCli reads the custom id from `args.id2`
// (src/shell/multi-agent-cli.ts), but NO CLI/MCP surface ever writes
// `id2` — `--id` is consumed only as the topology-id fallback
// (src/shell/multi-agent-cli.ts) and, on MCP, mapped straight to
// topologyId (src/core/capability-table.ts). So `input.id` is always
// undefined and applyTopology auto-generates a hashed run id
// (src/shell/topology-io.ts), e.g. `debate-52fe571f319ca79e-position-a`.
// Conformance never exercises `topology apply --id` (only --judge-count /
// --debate-rounds), which is why 101/101 still pass. Fix belongs in v2 src
// (Phase B): wire `--id` into ApplyTopologyInput.id. Left failing on purpose.
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
