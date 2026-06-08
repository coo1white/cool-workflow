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
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ma-operator-ux-"));
const evidencePath = path.join(tmp, "operator-ux-evidence.md");
fs.writeFileSync(evidencePath, "operator ux evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

(async () => {
  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Prove v0.1.21 multi-agent operator UX."]);
  assert.ok(fs.existsSync(plan.statePath));

  runJson([
    "multi-agent",
    "run",
    plan.runId,
    "--topology",
    "judge-panel",
    "--topology-run",
    "operator-panel",
    "--judge-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ]);

  const initialStatusText = runText(["multi-agent", "status", plan.runId]);
  assert.match(initialStatusText, /Agent Graph/);
  assert.match(initialStatusText, /Dependencies/);
  assert.match(initialStatusText, /Failed \/ Blocked Agents/);
  assert.match(initialStatusText, /Adopted Evidence/);
  assert.match(initialStatusText, /Missing Evidence/);
  assert.match(initialStatusText, /Next Action/);
  const initialStatus = runJson(["multi-agent", "status", plan.runId, "--json"]);
  assert.equal(initialStatus.surface, "multi-agent-host");
  assert.ok(initialStatus.summaries.multiAgentOperator.dependencies.length > 0);
  assert.ok(initialStatus.summaries.multiAgentOperator.failures.some((entry) => entry.kind === "missing-role-coverage"));

  runJson([
    "multi-agent",
    "blackboard",
    plan.runId,
    "post",
    "--topic",
    "operator-panel-panel-decision",
    "--body",
    "Operator UX smoke records the planned evidence chain.",
    "--evidence",
    evidenceLocator
  ]);

  const firstDispatch = runJson(["multi-agent", "step", plan.runId, "--sandbox", "readonly"]);
  const firstWorkerId = firstDispatch.data.tasks[0].workerId;
  const firstManifest = runJson(["worker", "manifest", plan.runId, firstWorkerId]);
  writeWorkerResult(firstManifest.resultPath, "accepted judge output");
  runJson(["worker", "output", plan.runId, firstWorkerId, firstManifest.resultPath]);

  const secondDispatch = runJson(["multi-agent", "step", plan.runId, "--sandbox", "readonly"]);
  const secondWorkerId = secondDispatch.data.tasks[0].workerId;
  runJson(["worker", "fail", plan.runId, secondWorkerId, "--message", "simulated blocked judge path", "--code", "sandbox-policy-smoke", "--retryable", "false"]);

  const blockedFanin = runJson([
    "multi-agent",
    "fanin",
    plan.runId,
    "operator-panel-blocked-fanin",
    "--group",
    "operator-panel-group",
    "--fanout",
    "operator-panel-fanout",
    "--required-role",
    "operator-panel-judge-1",
    "--required-role",
    "operator-panel-judge-2"
  ]);
  assert.equal(blockedFanin.status, "blocked");
  assert.ok(blockedFanin.blockedReasons.some((entry) => /not reported|required evidence|blackboard evidence/.test(entry)));

  const candidate = runJson(["candidate", "register", plan.runId, "--worker", firstWorkerId, "--id", "operator-ux-candidate"]);
  assert.equal(candidate.status, "registered");
  const score = runJson([
    "multi-agent",
    "score",
    plan.runId,
    "operator-ux-candidate",
    "--criterion",
    "correctness=2",
    "--criterion",
    "evidence=1",
    "--maxTotal",
    "3",
    "--evidence",
    evidenceLocator
  ]);
  assert.equal(score.performed, "scored-candidate");
  const rejected = runFail(["candidate", "score", plan.runId, "missing-candidate", "--criterion", "correctness=1", "--evidence", evidenceLocator]);
  assert.match(rejected.stderr, /Unknown candidate/);

  const selection = runJson([
    "multi-agent",
    "select",
    plan.runId,
    "operator-ux-candidate",
    "--score",
    score.data.id,
    "--reason",
    "Operator UX smoke selected the only verifier-gated candidate with explicit score evidence."
  ]);
  const commit = runJson(["commit", plan.runId, "--selection", selection.data.id, "--reason", "Operator UX smoke verifier-gated commit."]);
  assert.equal(commit.commit.verifierGated, true);

  const dependenciesText = runText(["multi-agent", "dependencies", plan.runId]);
  assert.match(dependenciesText, /Dependencies/);
  assert.match(dependenciesText, /depends-on|adopted-by|scores|selects/);
  const dependencies = runJson(["multi-agent", "dependencies", plan.runId, "--json"]);
  assert.ok(dependencies.some((entry) => entry.label === "scores"));
  assert.ok(dependencies.some((entry) => entry.label === "commits"));

  const failuresText = runText(["multi-agent", "failures", plan.runId]);
  assert.match(failuresText, /Failed \/ Blocked Agents/);
  assert.match(failuresText, /simulated blocked judge path|sandbox-policy-smoke|fanin/);
  const failures = runJson(["multi-agent", "failures", plan.runId, "--json"]);
  assert.ok(failures.some((entry) => entry.kind === "worker"));
  assert.ok(failures.some((entry) => entry.kind === "fanin"));
  assert.ok(failures.every((entry) => entry.nextCommand));

  const evidenceText = runText(["multi-agent", "evidence", plan.runId]);
  assert.match(evidenceText, /Evidence Adoption/);
  assert.match(evidenceText, /adopted/);
  assert.match(evidenceText, /missing/);
  const evidence = runJson(["multi-agent", "evidence", plan.runId, "--json"]);
  assert.ok(evidence.some((entry) => entry.status === "adopted" && entry.commitIds.includes(commit.commit.id)));
  assert.ok(evidence.some((entry) => entry.status === "missing" || entry.status === "pending"));
  assert.ok(evidence.some((entry) => entry.scoreIds.includes(score.data.id)));
  assert.ok(evidence.some((entry) => entry.selectionIds.includes(selection.data.id)));

  // v0.1.27 (topic1): after a verifier-gated commit, missing/pending evidence
  // for undriven sibling roles is inspectable operator state, NOT a hidden
  // failure. `status` is unchanged; `disposition` reads it for the operator.
  const pendingEvidence = evidence.filter((entry) => entry.status === "missing" || entry.status === "pending");
  assert.ok(pendingEvidence.length >= 1, "judge-panel run leaves undriven-role evidence");
  assert.ok(
    pendingEvidence.every((entry) => entry.disposition === "inspectable"),
    "post verifier-gated-commit, missing/pending evidence is inspectable, not blocking"
  );
  assert.ok(
    evidence.every((entry) => ["adopted", "inspectable", "blocking"].includes(entry.disposition)),
    "every evidence row carries a derived disposition"
  );
  assert.match(evidenceText, /disposition=inspectable/);
  const maStatus = runJson(["multi-agent", "status", plan.runId, "--json"]);
  assert.ok(maStatus.summaries.multiAgentOperator.inspectableEvidence.length >= 1);
  const maStatusText = runText(["multi-agent", "status", plan.runId]);
  assert.match(maStatusText, /inspectable rows are not failures/);

  const graphText = runText(["multi-agent", "graph", plan.runId]);
  assert.match(graphText, /Run Graph:/);
  assert.match(graphText, /agent-membership/);
  assert.match(graphText, /blackboard-artifact/);
  assert.match(graphText, /score/);
  assert.match(graphText, /selection/);
  assert.match(graphText, /commit/);
  assert.match(graphText, /depends-on|adopted-by|scores|selects|commits/);
  const graph = runJson(["multi-agent", "graph", plan.runId, "--json"]);
  assert.ok(graph.nodes.some((entry) => entry.kind === "score"));
  assert.ok(graph.edges.some((entry) => entry.label === "commits"));

  const topStatus = runText(["status", plan.runId]);
  assert.match(topStatus, /Multi-Agent Operator UX/);
  assert.match(topStatus, /adoptedEvidence=/);
  assert.match(topStatus, /missingEvidence=/);
  const report = runText(["report", plan.runId, "--show"]);
  assert.match(report, /Dependencies/);
  assert.match(report, /Failed \/ Blocked Agents/);
  assert.match(report, /Evidence Adoption/);
  assert.match(report, /multi-agent evidence/);

  const mcp = await readMcp(plan.runId);
  for (const name of [
    "cw_multi_agent_status",
    "cw_multi_agent_graph",
    "cw_multi_agent_dependencies",
    "cw_multi_agent_failures",
    "cw_multi_agent_evidence"
  ]) {
    assert.ok(mcp.tools.has(name), `missing MCP tool ${name}`);
  }
  assert.ok(mcp.status.summaries.multiAgentOperator.evidence.length >= evidence.length);
  assert.ok(mcp.graph.nodes.some((entry) => entry.kind === "score"));
  assert.ok(mcp.dependencies.some((entry) => entry.label === "commits"));
  assert.ok(mcp.failures.some((entry) => entry.kind === "worker"));
  assert.ok(mcp.evidence.some((entry) => entry.status === "adopted"));

  process.stdout.write("multi-agent-operator-ux-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function writeWorkerResult(resultPath, label) {
  fs.writeFileSync(
    resultPath,
    [
      `# ${label}`,
      "",
      "Operator UX smoke worker output.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: `${label} completed.`,
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
  const server = spawn(node, [mcpServer], {
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
    .then((listed) => Promise.all([
      tool("cw_multi_agent_status", { cwd: tmp, runId }),
      tool("cw_multi_agent_graph", { cwd: tmp, runId }),
      tool("cw_multi_agent_dependencies", { cwd: tmp, runId }),
      tool("cw_multi_agent_failures", { cwd: tmp, runId }),
      tool("cw_multi_agent_evidence", { cwd: tmp, runId })
    ]).then(([status, graph, dependencies, failures, evidence]) => ({
      tools: new Set(listed.tools.map((entry) => entry.name)),
      status,
      graph,
      dependencies,
      failures,
      evidence
    })))
    .finally(() => server.kill());
}
