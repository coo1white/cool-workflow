#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-multi-agent-runtime-"));
const evidencePath = path.join(tmp, "multi-agent-evidence.md");
fs.writeFileSync(evidencePath, "multi-agent runtime evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

(async () => {
  const plan = runJson([
    "plan",
    "end-to-end-golden-path",
    "--repo",
    tmp,
    "--question",
    "Prove the v0.1.17 multi-agent runtime core."
  ]);
  assert.ok(fs.existsSync(plan.statePath));

  const multiRun = runJson([
    "multi-agent",
    "run",
    plan.runId,
    "--id",
    "ma-smoke",
    "--title",
    "Multi-Agent Smoke",
    "--objective",
    "prove explicit roles, groups, fanout, fanin, and lifecycle"
  ]);
  assert.equal(multiRun.id, "ma-smoke");
  assert.equal(multiRun.status, "planned");

  const role = runJson([
    "multi-agent",
    "role",
    plan.runId,
    "runtime-role",
    "--multi-agent-run",
    "ma-smoke",
    "--title",
    "Runtime Evidence",
    "--responsibility",
    "produce worker evidence",
    "--required-evidence",
    evidenceLocator,
    "--sandbox",
    "readonly",
    "--expected-artifact",
    "result.md",
    "--fanin-obligation",
    "cw:result evidence"
  ]);
  assert.equal(role.id, "runtime-role");
  assert.deepEqual(role.requiredEvidence, [evidenceLocator]);

  const group = runJson([
    "multi-agent",
    "group",
    plan.runId,
    "runtime-group",
    "--multi-agent-run",
    "ma-smoke",
    "--phase",
    "Golden Path",
    "--task",
    "golden:path"
  ]);
  assert.equal(group.id, "runtime-group");

  const fanout = runJson([
    "multi-agent",
    "fanout",
    plan.runId,
    "runtime-fanout",
    "--group",
    "runtime-group",
    "--reason",
    "split golden path into explicit runtime role",
    "--role",
    "runtime-role",
    "--task",
    "golden:path",
    "--limit",
    "1",
    "--sandbox-choice",
    "runtime-role=readonly"
  ]);
  assert.equal(fanout.status, "planned");
  assert.equal(fanout.reason, "split golden path into explicit runtime role");

  const dispatch = runJson([
    "dispatch",
    plan.runId,
    "--limit",
    "1",
    "--sandbox",
    "readonly",
    "--multi-agent-run",
    "ma-smoke",
    "--multi-agent-group",
    "runtime-group",
    "--multi-agent-role",
    "runtime-role",
    "--multi-agent-fanout",
    "runtime-fanout"
  ]);
  assert.equal(dispatch.multiAgent.runId, "ma-smoke");
  assert.equal(dispatch.multiAgent.groupId, "runtime-group");
  assert.equal(dispatch.multiAgent.roleId, "runtime-role");
  assert.equal(dispatch.multiAgent.fanoutId, "runtime-fanout");
  assert.equal(dispatch.multiAgent.membershipIds.length, 1);
  const workerId = dispatch.tasks[0].workerId;
  assert.ok(workerId);
  assert.equal(dispatch.tasks[0].multiAgent.membershipId, dispatch.multiAgent.membershipIds[0]);

  const duplicate = runFail([
    "multi-agent",
    "membership",
    plan.runId,
    "--group",
    "runtime-group",
    "--role",
    "runtime-role",
    "--task",
    "golden:path",
    "--worker",
    workerId
  ]);
  assert.match(duplicate.stderr, /Duplicate AgentMembership/);

  let manifest = runJson(["worker", "manifest", plan.runId, workerId]);
  assert.equal(manifest.multiAgent.runId, "ma-smoke");
  assert.equal(manifest.multiAgent.groupId, "runtime-group");
  assert.equal(manifest.multiAgent.roleId, "runtime-role");
  assert.equal(manifest.multiAgent.fanoutId, "runtime-fanout");
  assert.equal(manifest.multiAgent.membershipId, dispatch.multiAgent.membershipIds[0]);

  writeWorkerResult(manifest.resultPath, evidenceLocator);
  runJson(["worker", "output", plan.runId, workerId, manifest.resultPath]);
  manifest = runJson(["worker", "manifest", plan.runId, workerId]);
  assert.equal(manifest.status, "verified");

  const readyFanin = runJson([
    "multi-agent",
    "fanin",
    plan.runId,
    "runtime-fanin",
    "--group",
    "runtime-group",
    "--fanout",
    "runtime-fanout",
    "--required-role",
    "runtime-role"
  ]);
  assert.equal(readyFanin.status, "ready");
  assert.equal(readyFanin.verifierReady, true);
  assert.deepEqual(readyFanin.missingMembershipIds, []);
  assert.deepEqual(readyFanin.missingRoleIds, []);
  assert.equal(readyFanin.evidenceCoverage[0].complete, true);

  const completedRun = runJson(["multi-agent", "run", plan.runId, "ma-smoke", "--status", "completed", "--reason", "ready fanin verified"]);
  assert.equal(completedRun.status, "completed");
  assert.equal(runJson(["multi-agent", "role", plan.runId, "runtime-role"]).status, "completed");
  assert.equal(runJson(["multi-agent", "group", plan.runId, "runtime-group"]).status, "completed");
  assert.equal(runJson(["multi-agent", "fanout", plan.runId, "runtime-fanout"]).status, "completed");
  assert.equal(runJson(["multi-agent", "fanin", plan.runId, "runtime-fanin"]).status, "completed");

  runJson(["multi-agent", "run", plan.runId, "--id", "ma-missing", "--objective", "prove blocked fanin completion fails closed"]);
  runJson(["multi-agent", "role", plan.runId, "missing-role", "--multi-agent-run", "ma-missing", "--required-evidence", "missing:evidence"]);
  runJson(["multi-agent", "group", plan.runId, "missing-group", "--multi-agent-run", "ma-missing", "--task", "golden:path"]);
  runJson(["multi-agent", "membership", plan.runId, "missing-membership", "--group", "missing-group", "--role", "missing-role", "--task", "golden:path"]);
  const blockedFanin = runJson([
    "multi-agent",
    "fanin",
    plan.runId,
    "missing-fanin",
    "--group",
    "missing-group",
    "--required-role",
    "missing-role"
  ]);
  assert.equal(blockedFanin.status, "blocked");
  assert.equal(blockedFanin.verifierReady, false);
  assert.deepEqual(blockedFanin.missingMembershipIds, ["missing-membership"]);
  assert.match(blockedFanin.blockedReasons.join("\n"), /has not reported required evidence/);
  const blockedCompletion = runFail(["multi-agent", "run", plan.runId, "ma-missing", "--status", "completed"]);
  assert.match(blockedCompletion.stderr, /Cannot complete MultiAgentRun ma-missing/);

  const summary = runJson(["multi-agent", "summary", plan.runId, "--json"]);
  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.roles, 2);
  assert.equal(summary.groups, 2);
  assert.equal(summary.fanouts, 1);
  assert.equal(summary.fanins, 2);
  assert.ok(summary.blockedReasons.some((reason) => reason.includes("missing-membership")));

  const status = runText(["status", plan.runId]);
  assert.match(status, /Multi-Agent/);
  assert.match(status, /runtime-group/);
  assert.match(status, /missing-membership/);
  const report = runText(["report", plan.runId, "--show"]);
  assert.match(report, /Multi-Agent/);
  assert.match(report, /Resource Commands/);
  assert.match(report, /multi-agent summary/);
  const graph = runText(["graph", plan.runId]);
  assert.match(graph, /multi-agent-run/);
  assert.match(graph, /agent-group/);
  assert.match(graph, /agent-fanin/);
  const graphJson = runJson(["graph", plan.runId, "--json"]);
  assert.ok(graphJson.nodes.some((node) => node.kind === "agent-membership"));

  const audit = runJson(["audit", "summary", plan.runId]);
  assert.ok(audit.multiAgent.events >= 8);
  assert.equal(audit.multiAgent.runs, 2);
  assert.ok(audit.byKind["multi-agent.fanin"] >= 2);
  const provenance = runJson(["audit", "provenance", plan.runId, "--worker", workerId]);
  assert.ok(provenance.events.some((event) => event.kind === "multi-agent.membership.output"));

  const mcpSummary = await readMcpSummary(plan.runId);
  assert.equal(mcpSummary.totalRuns, summary.totalRuns);
  assert.equal(mcpSummary.memberships, summary.memberships);

  const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
  assert.equal(state.multiAgent.schemaVersion, 1);
  assert.equal(state.multiAgent.memberships.length, 2);
  assert.ok(fs.existsSync(path.join(tmp, ".cw", "runs", plan.runId, "multi-agent", "index.json")));
  assert.ok(fs.existsSync(path.join(tmp, ".cw", "runs", plan.runId, "multi-agent", "fanins", "runtime-fanin.json")));

  process.stdout.write("multi-agent-runtime-core-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function writeWorkerResult(resultPath, locator) {
  fs.writeFileSync(
    resultPath,
    [
      "# Multi-Agent Worker Result",
      "",
      "The worker result proves multi-agent runtime evidence collection.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: "Multi-agent runtime worker output accepted with durable evidence.",
        findings: [],
        evidence: [locator]
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
  const result = require("node:child_process").spawnSync(node, [cli, ...args], {
    cwd: tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.notEqual(result.status, 0);
  return result;
}

async function readMcpSummary(runId) {
  const server = spawn(node, [path.join(pluginRoot, "dist", "mcp-server.js")], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lines = readline.createInterface({ input: server.stdout });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  function rpc(method, params) {
    const id = nextId++;
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "multi-agent-runtime-core-smoke", version: "1.0.0" }
    });
    const tools = await rpc("tools/list", {});
    assert.ok(tools.tools.some((entry) => entry.name === "cw_multi_agent_summary"));
    assert.ok(tools.tools.some((entry) => entry.name === "cw_multi_agent_fanin_collect"));
    const result = await rpc("tools/call", {
      name: "cw_multi_agent_summary",
      arguments: { cwd: tmp, runId }
    });
    assert.equal(result.content[0].type, "text");
    return JSON.parse(result.content[0].text);
  } finally {
    server.stdin.end();
    server.kill();
    if (stderr) process.stderr.write(stderr);
  }
}
