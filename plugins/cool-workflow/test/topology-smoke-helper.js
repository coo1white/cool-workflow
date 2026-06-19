"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const node = process.execPath;

function createContext(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const evidencePath = path.join(tmp, "topology-evidence.md");
  fs.writeFileSync(evidencePath, "topology evidence\n", "utf8");
  return {
    tmp,
    evidencePath,
    evidenceLocator: `${evidencePath}:1`
  };
}

function planArchitecture(ctx, question) {
  const plan = runJson(ctx, [
    "plan",
    "architecture-review",
    "--repo",
    ctx.tmp,
    "--question",
    question
  ]);
  assert.ok(fs.existsSync(plan.statePath));
  return plan;
}

function dispatchAndOutput(ctx, runId, multiAgentRun, group, role, fanout, label) {
  const dispatch = runJson(ctx, [
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
  const manifest = runJson(ctx, ["worker", "manifest", runId, workerId]);
  writeWorkerResult(ctx, manifest.resultPath, label);
  runJson(ctx, ["worker", "output", runId, workerId, manifest.resultPath]);
  return { workerId, manifest };
}

function writeWorkerResult(ctx, resultPath, label) {
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
        evidence: [ctx.evidenceLocator]
      }),
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

function runJson(ctx, args) {
  return JSON.parse(runText(ctx, args));
}

function runText(ctx, args) {
  return execFileSync(node, [cli, ...args], {
    cwd: ctx.tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function readTopologyMcp(ctx, runId) {
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
    .then((listed) => {
      const tools = new Set(listed.tools.map((entry) => entry.name));
      return tool("cw_topology_summary", { cwd: ctx.tmp, runId }).then((summary) => ({ tools, summary }));
    })
    .finally(() => server.kill());
}

module.exports = {
  createContext,
  dispatchAndOutput,
  planArchitecture,
  pluginRoot,
  readTopologyMcp,
  runJson,
  runText
};
