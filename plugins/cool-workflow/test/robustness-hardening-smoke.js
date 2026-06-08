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
const { migrateRunState } = require("../dist/state-migrations");

(async () => {
  verifyStateMigration();

  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Robustness hardening smoke."]);
  assert.ok(fs.existsSync(plan.statePath));

  const invalidCli = runFail(["blackboard", "message", "post", plan.runId, "--topic", "missing-topic"]);
  assert.match(invalidCli.stderr, /Unknown BlackboardTopic id|Missing message body|body is required/);

  runJson(["multi-agent", "run", plan.runId, "--id", "safe/id"]);
  const multiAgentCollision = runFail(["multi-agent", "run", plan.runId, "--id", "safe_id"]);
  assert.match(multiAgentCollision.stderr, /collide on safe file name safe_id/);

  const firstTopic = runJson(["blackboard", "topic", "create", plan.runId, "--id", "topic/a", "--title", "Topic A"]);
  assert.equal(firstTopic.id, "topic/a");
  const blackboardCollision = runFail(["blackboard", "topic", "create", plan.runId, "--id", "topic_a", "--title", "Topic A2"]);
  assert.match(blackboardCollision.stderr, /collide on safe file name topic_a/);

  const hostRun = runJson([
    "multi-agent",
    "run",
    plan.runId,
    "--topology",
    "judge-panel",
    "--topology-run",
    "robust-panel",
    "--judge-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ]);
  assert.equal(hostRun.ids.topologyRunIds[0], "robust-panel");

  const deniedTopic = runJson([
    "blackboard",
    "topic",
    "create",
    plan.runId,
    "--blackboard",
    "robust-panel-blackboard",
    "--id",
    "robust-panel-outside",
    "--title",
    "Outside"
  ]);
  assert.equal(deniedTopic.id, "robust-panel-outside");
  const deniedWrite = runFail([
    "blackboard",
    "message",
    "post",
    plan.runId,
    "--topic",
    "robust-panel-outside",
    "--blackboard",
    "robust-panel-blackboard",
    "--body",
    "This role write must be denied before mutation.",
    "--authorKind",
    "role",
    "--authorId",
    "robust-panel-judge-1",
    "--multi-agent-run",
    "robust-panel-ma",
    "--role",
    "robust-panel-judge-1"
  ]);
  assert.match(deniedWrite.stderr, /outside policy|policy/);
  const trust = runJson(["audit", "multi-agent", plan.runId, "--json"]);
  assert.ok(trust.policyViolations.length >= 1);

  const blocked = runJson([
    "multi-agent",
    "fanin",
    plan.runId,
    "robust-blocked-fanin",
    "--group",
    hostRun.ids.groupIds[0],
    "--fanout",
    hostRun.ids.fanoutIds[0]
  ]);
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockedReasons.some((reason) => /has no membership|has not reported|required evidence|indexed blackboard evidence/.test(reason)));

  const snapshot = runJson(["eval", "snapshot", plan.runId, "--id", "robustness-suite", "--json"]);
  const replay = runJson(["eval", "replay", snapshot.paths.snapshotPath, "--id", "robustness-suite-replay", "--json"]);
  const malformedReplayPath = path.join(path.dirname(replay.paths.replayRunPath), "malformed-replay-run.json");
  const malformedReplay = JSON.parse(fs.readFileSync(replay.paths.replayRunPath, "utf8"));
  delete malformedReplay.replay;
  malformedReplay.paths.replayRunPath = malformedReplayPath;
  fs.writeFileSync(malformedReplayPath, `${JSON.stringify(malformedReplay, null, 2)}\n`, "utf8");
  const malformedCompare = runFail(["eval", "compare", snapshot.paths.snapshotPath, malformedReplayPath]);
  assert.match(malformedCompare.stderr, /Replay run missing replay section/);

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
  const tool = (name, args) =>
    rpc("tools/call", { name, arguments: args }).then((result) => JSON.parse(result.content[0].text));
  return Promise.resolve()
    .then(() => rpc("initialize", {}))
    .then(() => Promise.all([
      tool("cw_status", {}).catch((error) => error.message),
      rpc("tools/call", { name: "cw_status", arguments: [] }).catch((error) => error.message),
      tool("cw_status", { cwd: tmp, runId })
    ]))
    .then(([missingRunId, badArguments, status]) => ({ missingRunId, badArguments, status }))
    .finally(() => server.kill());
}
