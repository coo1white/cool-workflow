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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-coordinator-blackboard-"));
const evidencePath = path.join(tmp, "blackboard-evidence.md");
fs.writeFileSync(evidencePath, "blackboard evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

(async () => {
  const plan = runJson(["plan", "end-to-end-golden-path", "--repo", tmp, "--question", "Prove coordinator blackboard smoke."]);
  assert.ok(fs.existsSync(plan.statePath));

  const board = runJson([
    "blackboard",
    "resolve",
    plan.runId,
    "--id",
    "bb-smoke",
    "--title",
    "Coordinator Blackboard Smoke"
  ]);
  assert.equal(board.id, "bb-smoke");
  assert.ok(fs.existsSync(path.join(tmp, ".cw", "runs", plan.runId, "blackboard", "index.json")));

  const topic = runJson([
    "blackboard",
    "topic",
    "create",
    plan.runId,
    "--id",
    "topic-synthesis",
    "--title",
    "Synthesis",
    "--description",
    "Shared synthesis evidence"
  ]);
  assert.equal(topic.id, "topic-synthesis");

  const fact = runJson([
    "blackboard",
    "context",
    "put",
    plan.runId,
    "--topic",
    "topic-synthesis",
    "--kind",
    "fact",
    "--key",
    "release",
    "--value",
    "Coordinator Blackboard is first-class.",
    "--evidence",
    evidenceLocator
  ]);
  assert.equal(fact.status, "active");
  const conflict = runJson([
    "blackboard",
    "context",
    "put",
    plan.runId,
    "--topic",
    "topic-synthesis",
    "--kind",
    "fact",
    "--key",
    "release",
    "--value",
    "Conflicting value is explicit."
  ]);
  assert.equal(conflict.status, "conflicting");
  assert.deepEqual(conflict.conflictingContextIds, [fact.id]);

  const artifact = runJson([
    "blackboard",
    "artifact",
    "add",
    plan.runId,
    "--topic",
    "topic-synthesis",
    "--path",
    evidencePath,
    "--kind",
    "evidence-file",
    "--evidence",
    evidenceLocator
  ]);
  assert.equal(artifact.kind, "evidence-file");
  assert.match(artifact.checksum, /^sha256:/);

  const message = runJson([
    "blackboard",
    "message",
    "post",
    plan.runId,
    "--topic",
    "topic-synthesis",
    "--body",
    "Evidence is indexed for fanin.",
    "--artifact",
    artifact.id,
    "--evidence",
    evidenceLocator
  ]);
  assert.equal(message.linkedArtifactRefIds[0], artifact.id);
  assert.equal(runJson(["blackboard", "message", "list", plan.runId, "--topic", "topic-synthesis"]).length, 1);
  assert.equal(runJson(["blackboard", "artifact", "list", plan.runId]).length, 1);

  const decision = runJson([
    "coordinator",
    "decision",
    plan.runId,
    "--kind",
    "conflict-resolution",
    "--outcome",
    "accepted",
    "--subject",
    conflict.id,
    "--reason",
    "Conflict represented explicitly for smoke coverage.",
    "--message",
    message.id,
    "--artifact",
    artifact.id
  ]);
  assert.equal(decision.kind, "conflict-resolution");

  const snapshot = runJson(["blackboard", "snapshot", plan.runId]);
  assert.ok(fs.existsSync(snapshot.snapshotPath));
  let summary = runJson(["blackboard", "summary", plan.runId]);
  assert.equal(summary.blackboardId, "bb-smoke");
  assert.equal(summary.topics, 1);
  assert.equal(summary.messages, 1);
  assert.equal(summary.contexts, 2);
  assert.equal(summary.artifacts, 1);
  assert.equal(summary.conflicts.length, 2);
  assert.equal(summary.readyForFanin, false);

  runJson([
    "multi-agent",
    "run",
    plan.runId,
    "--id",
    "ma-bb",
    "--objective",
    "prove blackboard linked fanin",
    "--blackboard",
    "bb-smoke",
    "--topic",
    "topic-synthesis"
  ]);
  runJson([
    "multi-agent",
    "role",
    plan.runId,
    "role-bb",
    "--multi-agent-run",
    "ma-bb",
    "--required-evidence",
    evidenceLocator,
    "--blackboard",
    "bb-smoke",
    "--topic",
    "topic-synthesis"
  ]);
  runJson([
    "multi-agent",
    "group",
    plan.runId,
    "group-bb",
    "--multi-agent-run",
    "ma-bb",
    "--task",
    "golden:path",
    "--blackboard",
    "bb-smoke",
    "--topic",
    "topic-synthesis"
  ]);
  const fanout = runJson([
    "multi-agent",
    "fanout",
    plan.runId,
    "fanout-bb",
    "--group",
    "group-bb",
    "--role",
    "role-bb",
    "--task",
    "golden:path",
    "--reason",
    "blackboard worker evidence",
    "--blackboard",
    "bb-smoke",
    "--topic",
    "topic-synthesis"
  ]);
  assert.equal(fanout.blackboardId, "bb-smoke");

  const dispatch = runJson([
    "dispatch",
    plan.runId,
    "--limit",
    "1",
    "--sandbox",
    "readonly",
    "--multi-agent-run",
    "ma-bb",
    "--multi-agent-group",
    "group-bb",
    "--multi-agent-role",
    "role-bb",
    "--multi-agent-fanout",
    "fanout-bb"
  ]);
  const workerId = dispatch.tasks[0].workerId;
  let manifest = runJson(["worker", "manifest", plan.runId, workerId]);
  assert.equal(manifest.blackboard.id, "bb-smoke");
  assert.deepEqual(manifest.blackboard.topicIds, ["topic-synthesis"]);

  writeWorkerResult(manifest.resultPath, evidenceLocator);
  runJson(["worker", "output", plan.runId, workerId, manifest.resultPath]);
  manifest = runJson(["worker", "manifest", plan.runId, workerId]);
  assert.equal(manifest.status, "verified");
  const membership = runJson(["multi-agent", "membership", plan.runId, dispatch.multiAgent.membershipIds[0]]);
  assert.equal(membership.blackboardId, "bb-smoke");
  assert.equal(membership.blackboardArtifactRefIds.length, 1);
  assert.equal(membership.blackboardMessageIds.length, 1);

  const fanin = runJson([
    "multi-agent",
    "fanin",
    plan.runId,
    "fanin-bb",
    "--group",
    "group-bb",
    "--fanout",
    "fanout-bb",
    "--required-role",
    "role-bb",
    "--blackboard",
    "bb-smoke"
  ]);
  assert.equal(fanin.status, "ready");
  assert.equal(fanin.blackboardArtifactRefIds.length, 1);

  runJson(["multi-agent", "run", plan.runId, "--id", "ma-blocked", "--blackboard", "bb-smoke"]);
  runJson(["multi-agent", "role", plan.runId, "role-blocked", "--multi-agent-run", "ma-blocked", "--blackboard", "bb-smoke"]);
  runJson(["multi-agent", "group", plan.runId, "group-blocked", "--multi-agent-run", "ma-blocked", "--task", "golden:path", "--blackboard", "bb-smoke"]);
  runJson(["multi-agent", "membership", plan.runId, "membership-blocked", "--group", "group-blocked", "--role", "role-blocked", "--task", "golden:path", "--blackboard", "bb-smoke"]);
  const blocked = runJson(["multi-agent", "fanin", plan.runId, "fanin-blocked", "--group", "group-blocked", "--required-role", "role-blocked", "--blackboard", "bb-smoke"]);
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.blockedReasons.join("\n"), /no indexed blackboard evidence/);

  summary = runJson(["coordinator", "summary", plan.runId]);
  assert.ok(summary.artifacts >= 2);
  const status = runText(["status", plan.runId]);
  assert.match(status, /Blackboard \/ Coordinator/);
  assert.match(status, /conflict/);
  const report = runText(["report", plan.runId, "--show"]);
  assert.match(report, /blackboard summary/);
  const graph = runText(["graph", plan.runId]);
  assert.match(graph, /blackboard-topic/);
  assert.match(graph, /coordinator-decision/);
  const graphJson = runJson(["graph", plan.runId, "--json"]);
  assert.ok(graphJson.nodes.some((node) => node.kind === "blackboard-artifact"));

  const audit = runJson(["audit", "summary", plan.runId]);
  assert.ok(audit.blackboard.events >= 8);
  assert.ok(audit.byKind["blackboard.artifact"] >= 2);
  const provenance = runJson(["audit", "provenance", plan.runId, "--worker", workerId]);
  assert.ok(provenance.events.some((event) => event.blackboardArtifactRefId));

  const mcp = await readMcp(plan.runId);
  assert.equal(mcp.summary.blackboardId, "bb-smoke");
  assert.ok(mcp.tools.has("cw_blackboard_context_put"));
  assert.ok(mcp.tools.has("cw_coordinator_decision"));

  const state = JSON.parse(fs.readFileSync(plan.statePath, "utf8"));
  assert.equal(state.blackboard.schemaVersion, 1);
  assert.ok(state.blackboard.artifacts.length >= 2);
  assert.ok(fs.existsSync(path.join(tmp, ".cw", "runs", plan.runId, "blackboard", "messages.jsonl")));
  assert.ok(fs.existsSync(path.join(tmp, ".cw", "runs", plan.runId, "blackboard", "artifacts", `${artifact.id}.json`)));

  process.stdout.write("coordinator-blackboard-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function writeWorkerResult(resultPath, locator) {
  fs.writeFileSync(
    resultPath,
    [
      "# Blackboard Worker Result",
      "",
      "The worker result exists to exercise blackboard publication.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: "Blackboard worker result accepted with indexed evidence.",
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
      return tool("cw_blackboard_summary", { cwd: tmp, runId }).then((summary) => ({ tools, summary }));
    })
    .finally(() => server.kill());
}
