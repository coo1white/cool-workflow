#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-topologies-"));
const evidencePath = path.join(tmp, "topology-evidence.md");
fs.writeFileSync(evidencePath, "topology evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

(async () => {
  const plan = runJson([
    "plan",
    "architecture-review",
    "--repo",
    tmp,
    "--question",
    "Prove v0.1.19 multi-agent topologies."
  ]);
  assert.ok(fs.existsSync(plan.statePath));

  const listed = runJson(["topology", "list"]);
  assert.deepEqual(listed.map((entry) => entry.id).sort(), ["debate", "judge-panel", "map-reduce"]);
  assert.equal(runJson(["topology", "validate", "map-reduce"]).valid, true);
  assert.match(runText(["topology", "show", "debate"]), /Debate/);

  const mapRun = runJson([
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

  const firstMap = dispatchAndOutput(plan.runId, "topo-map-ma", "topo-map-group", "topo-map-mapper-1", "topo-map-fanout", "mapper one");
  const missing = runJson([
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

  const secondMap = dispatchAndOutput(plan.runId, "topo-map-ma", "topo-map-group", "topo-map-mapper-2", "topo-map-fanout", "mapper two");
  const ready = runJson([
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
  const reduceDecision = runJson([
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

  const debateRun = runJson([
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
  dispatchAndOutput(plan.runId, "topo-debate-ma", "topo-debate-group", "topo-debate-position-a", "topo-debate-fanout", "position a");
  dispatchAndOutput(plan.runId, "topo-debate-ma", "topo-debate-group", "topo-debate-position-b", "topo-debate-fanout", "position b");
  const claimA = runJson([
    "blackboard",
    "context",
    "put",
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
    evidenceLocator
  ]);
  const claimB = runJson([
    "blackboard",
    "context",
    "put",
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
  const debateDecision = runJson([
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

  const panelRun = runJson([
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
  const judgeOne = dispatchAndOutput(plan.runId, "topo-judge-ma", "topo-judge-group", "topo-judge-judge-1", "topo-judge-fanout", "judge one");
  const judgeTwo = dispatchAndOutput(plan.runId, "topo-judge-ma", "topo-judge-group", "topo-judge-judge-2", "topo-judge-fanout", "judge two");
  const panelFanin = runJson([
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
  const candidate = runJson(["candidate", "register", plan.runId, "--id", "candidate-panel", "--worker", judgeOne.workerId]);
  const score = runJson(["candidate", "score", plan.runId, candidate.id, "--criterion", "correctness=1", "--criterion", "evidence=1", "--evidence", evidenceLocator]);
  const selection = runJson(["candidate", "select", plan.runId, candidate.id, "--score", score.id, "--reason", "Panel fanin and judge evidence support selection."]);
  assert.equal(selection.candidateId, candidate.id);
  const panelDecision = runJson([
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

  const summary = runJson(["topology", "summary", plan.runId, "--json"]);
  assert.equal(summary.totalRuns, 3);
  assert.ok(summary.active.some((entry) => entry.topologyId === "map-reduce" && entry.fanins.includes("topo-map-fanin-ready")));
  const status = runText(["status", plan.runId]);
  assert.match(status, /Topologies/);
  assert.match(status, /topo-map/);
  const report = runText(["report", plan.runId, "--show"]);
  assert.match(report, /topology summary/);
  const graph = runText(["graph", plan.runId]);
  assert.match(graph, /topology-run/);
  assert.match(graph, /topo-judge/);
  const graphJson = runJson(["graph", plan.runId, "--json"]);
  assert.ok(graphJson.nodes.some((node) => node.kind === "topology-run"));

  const audit = runJson(["audit", "summary", plan.runId]);
  assert.ok(audit.topologies.events >= 6);
  assert.ok(audit.byKind["topology.create"] >= 3);
  assert.ok(audit.blackboard.artifacts >= 6);
  const provenance = runJson(["audit", "provenance", plan.runId, "--worker", judgeTwo.workerId]);
  assert.ok(provenance.events.some((event) => event.kind === "multi-agent.membership.output"));

  const mcp = await readMcp(plan.runId);
  assert.ok(mcp.tools.has("cw_topology_list"));
  assert.ok(mcp.tools.has("cw_topology_apply"));
  assert.equal(mcp.summary.totalRuns, 3);

  const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
  assert.equal(state.topologies.schemaVersion, 1);
  assert.equal(state.topologies.runs.length, 3);
  assert.ok(fs.existsSync(path.join(tmp, ".cw", "runs", plan.runId, "topologies", "runs", "topo-map.json")));

  process.stdout.write("multi-agent-topologies-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function dispatchAndOutput(runId, multiAgentRun, group, role, fanout, label) {
  const dispatch = runJson([
    "dispatch",
    runId,
    "--limit",
    "1",
    "--sandbox",
    "readonly",
    "--multi-agent-run",
    multiAgentRun,
    "--multi-agent-group",
    group,
    "--multi-agent-role",
    role,
    "--multi-agent-fanout",
    fanout
  ]);
  const workerId = dispatch.tasks[0].workerId;
  const manifest = runJson(["worker", "manifest", runId, workerId]);
  writeWorkerResult(manifest.resultPath, label);
  runJson(["worker", "output", runId, workerId, manifest.resultPath]);
  return { workerId, manifest };
}

function writeWorkerResult(resultPath, label) {
  fs.writeFileSync(
    resultPath,
    [
      `# ${label}`,
      "",
      "Topology worker output with indexed evidence.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: `${label} completed with topology evidence.`,
        findings: [],
        evidence: [evidenceLocator]
      }),
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

function runJson(args) {
  return JSON.parse(runText(args));
}

function runText(args) {
  return execFileSync(node, [cli, ...args], {
    cwd: tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runFail(args) {
  const result = spawnSync(node, [cli, ...args], {
    cwd: tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.notEqual(result.status, 0);
  return result;
}

function readMcp(runId) {
  const server = spawn(node, [path.join(pluginRoot, "dist", "mcp-server.js")], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lines = readline.createInterface({ input: server.stdout });
  const pending = new Map();
  let nextId = 1;
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const rpc = (method, params) => {
    const id = nextId++;
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const tool = (name, args) =>
    rpc("tools/call", { name, arguments: args }).then((result) => JSON.parse(result.content[0].text));
  return Promise.resolve()
    .then(() => rpc("initialize", {}))
    .then(() => rpc("tools/list", {}))
    .then((listed) => {
      const tools = new Set(listed.tools.map((entry) => entry.name));
      return tool("cw_topology_summary", { cwd: tmp, runId }).then((summary) => ({ tools, summary }));
    })
    .finally(() => server.kill());
}
