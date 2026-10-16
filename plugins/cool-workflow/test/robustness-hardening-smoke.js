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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-robustness-"));
// v2: flat dist/state-migrations moved to core/state/migrations; same signature
// migrateRunState(input, { statePath?, dryRun? }).
const { migrateRunState } = require("../dist/core/state/migrations");

(async () => {
  verifyStateMigration();

  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Robustness hardening smoke."]);
  assert.ok(fs.existsSync(plan.statePath));

  // The blackboard / multi-agent / eval robustness cases that lived here went
  // with the multi-agent family (slim-and-esm step 2); the state-migration
  // fail-closed checks above still cover old multiAgent/blackboard/topologies
  // records, and the MCP checks below cover argument hardening.

  const mcp = await readMcp(plan.runId);
  assert.match(mcp.missingRunId, /missing required argument: runId/);
  assert.match(mcp.badArguments, /arguments must be an object/);
  assert.equal(mcp.status.runId, plan.runId);

  process.stdout.write("robustness-hardening-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function verifyStateMigration() {
  const legacy = migrateRunState({
    id: "legacy-run",
    workflow: { id: "legacy-workflow", title: "Legacy Workflow" },
    tasks: [],
    dispatches: [],
    commits: []
  }, { statePath: path.join(tmp, ".cw", "runs", "legacy-run", "state.json"), dryRun: true });
  assert.notEqual(legacy.report.status, "unsupported");
  assert.equal(legacy.run.schemaVersion, 1);

  const malformed = migrateRunState({
    schemaVersion: 1,
    id: "bad-run",
    workflow: { id: "bad-workflow", title: "Bad Workflow" },
    paths: {},
    tasks: {},
    dispatches: [],
    commits: [],
    phases: [],
    multiAgent: { runs: {} },
    blackboard: { topics: {} },
    topologies: { runs: {} }
  }, { statePath: path.join(tmp, ".cw", "runs", "bad-run", "state.json"), dryRun: true });
  assert.equal(malformed.report.status, "unsupported");
  assert.ok(malformed.report.errors.some((entry) => entry === "tasks must be an array when present."));
  assert.ok(malformed.report.errors.some((entry) => entry === "multiAgent.runs must be an array when present."));
  assert.ok(malformed.report.errors.some((entry) => entry === "blackboard.topics must be an array when present."));
  assert.ok(malformed.report.errors.some((entry) => entry === "topologies.runs must be an array when present."));
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
  // A failed tools/call now comes back as a normal result shaped
  // { content: [...], isError: true } (mcp/server.ts), not a JSON-RPC
  // protocol error — so `result.error` above never fires for a tool-call
  // failure any more. Turn an isError result back into a rejection here,
  // so the `.catch((error) => error.message)` call sites below still see
  // the same failure-message shape they always have.
  const tool = (name, args) =>
    rpc("tools/call", { name, arguments: args }).then((result) => {
      if (result.isError) throw new Error(result.content[0].text);
      return JSON.parse(result.content[0].text);
    });
  return Promise.resolve()
    .then(() => rpc("initialize", {}))
    .then(() => Promise.all([
      tool("cw_status", {}).catch((error) => error.message),
      tool("cw_status", []).catch((error) => error.message),
      tool("cw_status", { cwd: tmp, runId })
    ]))
    .then(([missingRunId, badArguments, status]) => ({ missingRunId, badArguments, status }))
    .finally(() => server.kill());
}
