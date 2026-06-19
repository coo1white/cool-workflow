#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createContext,
  dispatchAndOutput,
  planArchitecture,
  readTopologyMcp,
  runJson,
  runText
} = require("./topology-smoke-helper.js");

(async () => {
  const ctx = createContext("cw-topologies-judge-");
  const plan = planArchitecture(ctx, "Prove v0.1.19 judge-panel topology.");

  const panelRun = runJson(ctx, [
    "topology",
    "apply",
    plan.runId,
    "judge-panel",
    "--id",
    "topo-judge",
    "--judge-count",
    "2",
    "--task",
    "map:jobs-operators",
    "--task",
    "map:transport-core"
  ]);
  const judgeOne = dispatchAndOutput(ctx, plan.runId, "topo-judge-ma", "topo-judge-group", "topo-judge-judge-1", "topo-judge-fanout", "judge one");
  const judgeTwo = dispatchAndOutput(ctx, plan.runId, "topo-judge-ma", "topo-judge-group", "topo-judge-judge-2", "topo-judge-fanout", "judge two");
  const panelFanin = runJson(ctx, [
    "multi-agent",
    "fanin",
    plan.runId,
    "topo-judge-fanin-ready",
    "--group",
    "topo-judge-group",
    "--fanout",
    "topo-judge-fanout",
    "--required-role",
    "topo-judge-judge-1",
    "--required-role",
    "topo-judge-judge-2",
    "--blackboard",
    panelRun.blackboardId
  ]);
  assert.equal(panelFanin.status, "ready");

  const candidate = runJson(ctx, ["candidate", "register", plan.runId, "--id", "candidate-panel", "--worker", judgeOne.workerId]);
  const score = runJson(ctx, [
    "candidate",
    "score",
    plan.runId,
    candidate.id,
    "--criterion",
    "correctness=1",
    "--criterion",
    "evidence=1",
    "--evidence",
    ctx.evidenceLocator
  ]);
  const selection = runJson(ctx, ["candidate", "select", plan.runId, candidate.id, "--score", score.id, "--reason", "Panel fanin and judge evidence support selection."]);
  assert.equal(selection.candidateId, candidate.id);

  const panelDecision = runJson(ctx, [
    "coordinator",
    "decision",
    plan.runId,
    "--blackboard",
    panelRun.blackboardId,
    "--kind",
    "candidate-synthesis",
    "--outcome",
    "accepted",
    "--reason",
    "Panel decision links judge evidence, score record, and candidate selection rationale.",
    "--artifact",
    panelFanin.blackboardArtifactRefIds[0]
  ]);
  assert.equal(panelDecision.outcome, "accepted");

  const summary = runJson(ctx, ["topology", "summary", plan.runId, "--json"]);
  assert.equal(summary.totalRuns, 1);
  assert.ok(summary.active.some((entry) => entry.topologyId === "judge-panel" && entry.fanins.includes("topo-judge-fanin-ready")));

  const status = runText(ctx, ["status", plan.runId]);
  assert.match(status, /Topologies/);
  assert.match(status, /topo-judge/);
  const report = runText(ctx, ["report", plan.runId, "--show"]);
  assert.match(report, /topology summary/);
  const graph = runText(ctx, ["graph", plan.runId]);
  assert.match(graph, /topology-run/);
  assert.match(graph, /topo-judge/);
  const graphJson = runJson(ctx, ["graph", plan.runId, "--json"]);
  assert.ok(graphJson.nodes.some((node) => node.kind === "topology-run"));

  const audit = runJson(ctx, ["audit", "summary", plan.runId]);
  assert.ok(audit.topologies.events >= 2);
  assert.ok(audit.byKind["topology.create"] >= 1);
  assert.ok(audit.blackboard.artifacts >= 2);
  const provenance = runJson(ctx, ["audit", "provenance", plan.runId, "--worker", judgeTwo.workerId]);
  assert.ok(provenance.events.some((event) => event.kind === "multi-agent.membership.output"));

  const mcp = await readTopologyMcp(ctx, plan.runId);
  assert.ok(mcp.tools.has("cw_topology_list"));
  assert.ok(mcp.tools.has("cw_topology_apply"));
  assert.equal(mcp.summary.totalRuns, 1);

  const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
  assert.equal(state.topologies.schemaVersion, 1);
  assert.equal(state.topologies.runs.length, 1);
  assert.ok(fs.existsSync(path.join(ctx.tmp, ".cw", "runs", plan.runId, "topologies", "runs", "topo-judge.json")));

  process.stdout.write("multi-agent-topologies-judge-panel-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
