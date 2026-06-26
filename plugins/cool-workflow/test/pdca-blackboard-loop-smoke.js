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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-pdca-blackboard-"));

(async () => {
  const mcp = startMcp();
  try {
    await mcp.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pdca-blackboard-loop-smoke", version: "1.0.0" }
    });
    const listed = await mcp.rpc("tools/list", {});
    const toolNames = new Set(listed.tools.map((entry) => entry.name));
    for (const name of ["cw_blackboard_message_list", "cw_blackboard_snapshot", "cw_multi_agent_blackboard"]) {
      assert.ok(toolNames.has(name), `missing MCP tool ${name}`);
    }

    const plan = runJson([
      "plan",
      "pdca-blackboard-loop",
      "--goal",
      "prove three-agent blackboard handoff",
      "--repo",
      tmp,
      "--acceptance",
      "planner, builder, auditor, and next-action records share one board"
    ]);
    assert.equal(plan.workflowId, "pdca-blackboard-loop");

    const board = await mcp.tool("cw_blackboard_resolve", {
      cwd: tmp,
      runId: plan.runId,
      id: "pdca",
      title: "PDCA shared board"
    });
    const topic = await mcp.tool("cw_blackboard_topic_create", {
      cwd: tmp,
      runId: plan.runId,
      blackboardId: board.id,
      id: "pdca",
      title: "PDCA loop"
    });

    const planner = completeNextWorker(plan.runId, "planner:plan", {
      summary: "Planner made the smallest PDCA loop.",
      evidence: ["workflow:pdca-plan"]
    });
    const plannerMessage = await postRole(mcp, plan.runId, board.id, topic.id, "planner", "plan", "Plan: do one small build and audit it.", planner.resultPath, planner.evidence);

    const builder = completeNextWorker(plan.runId, "builder:build", {
      summary: "Builder completed the planned work.",
      evidence: [`blackboard:${plannerMessage.message.id}`, "artifact:builder-result"]
    });
    const builderMessage = await postRole(mcp, plan.runId, board.id, topic.id, "builder", "build", "Build: result follows the planner message.", builder.resultPath, builder.evidence, [`blackboard:${plannerMessage.message.id}`]);

    const auditor = completeNextWorker(plan.runId, "auditor:audit", {
      summary: "Auditor accepted the builder evidence.",
      evidence: [`blackboard:${builderMessage.message.id}`, "artifact:auditor-result"]
    });
    const auditorMessage = await postRole(mcp, plan.runId, board.id, topic.id, "auditor", "audit", "Audit: builder evidence is present.", auditor.resultPath, auditor.evidence, [`blackboard:${builderMessage.message.id}`]);
    const checkSnapshot = await mcp.tool("cw_blackboard_snapshot", { cwd: tmp, runId: plan.runId, blackboardId: board.id });

    const next = completeNextWorker(plan.runId, "planner:next", {
      summary: "Planner chose accepted as the next action.",
      evidence: [`blackboard:${auditorMessage.message.id}`, "decision:accepted"]
    });
    await postRole(mcp, plan.runId, board.id, topic.id, "planner", "next", "Act: accepted.", next.resultPath, next.evidence, [`blackboard:${auditorMessage.message.id}`]);
    const actSnapshot = await mcp.tool("cw_blackboard_snapshot", { cwd: tmp, runId: plan.runId, blackboardId: board.id });
    assert.notEqual(checkSnapshot.id, actSnapshot.id);

    const mcpMessages = await mcp.tool("cw_blackboard_message_list", { cwd: tmp, runId: plan.runId, blackboardId: board.id, topic: topic.id });
    assert.equal(mcpMessages.length, 4);
    assert.deepEqual(mcpMessages.map((message) => message.author.id), ["planner", "builder", "auditor", "planner"]);
    assert.ok(mcpMessages.every((message) => message.blackboardId === board.id));

    const cliMessages = runJson(["blackboard", "message", "list", plan.runId, "--blackboard", board.id, "--topic", topic.id]);
    assert.deepEqual(cliMessages.map((message) => message.id), mcpMessages.map((message) => message.id));
    const cliSummary = runJson(["blackboard", "summary", plan.runId, "--blackboard", board.id]);
    const mcpSummary = await mcp.tool("cw_multi_agent_blackboard", { cwd: tmp, runId: plan.runId, blackboardId: board.id, action: "summary" });
    assert.equal(mcpSummary.data.blackboardId, cliSummary.blackboardId);
    assert.equal(mcpSummary.data.messages, cliSummary.messages);
    assert.equal(cliSummary.snapshots, 2);

    const bad = runJson([
      "plan",
      "pdca-blackboard-loop",
      "--goal",
      "prove auditor fail closed",
      "--repo",
      tmp,
      "--acceptance",
      "auditor must cite builder evidence"
    ]);
    completeNextWorker(bad.runId, "planner:plan", { summary: "Planner ready.", evidence: ["workflow:pdca-plan"] });
    completeNextWorker(bad.runId, "builder:build", { summary: "Builder ready.", evidence: ["artifact:builder-result"] });
    const auditorDispatch = runJson(["dispatch", bad.runId, "--limit", "1", "--sandbox", "readonly"]);
    const auditorWorker = auditorDispatch.tasks[0];
    assert.equal(auditorWorker.id, "auditor:audit");
    const auditorManifest = runJson(["worker", "manifest", bad.runId, auditorWorker.workerId]);
    writeResult(auditorManifest.resultPath, {
      summary: "Auditor tried to pass without builder evidence.",
      evidence: []
    });
    const refused = runFail(["worker", "output", bad.runId, auditorWorker.workerId, auditorManifest.resultPath]);
    assert.match(refused.stderr, /requires grounded cw:result evidence/);

    process.stdout.write("pdca-blackboard-loop-smoke: ok\n");
  } finally {
    mcp.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function completeNextWorker(runId, taskId, result) {
  const dispatch = runJson(["dispatch", runId, "--limit", "1", "--sandbox", taskId === "builder:build" ? "workspace-write" : "readonly"]);
  assert.equal(dispatch.tasks.length, 1);
  const worker = dispatch.tasks[0];
  assert.equal(worker.id, taskId);
  const manifest = runJson(["worker", "manifest", runId, worker.workerId]);
  writeResult(manifest.resultPath, result);
  const output = runJson(["worker", "output", runId, worker.workerId, manifest.resultPath]);
  assert.ok(output.tasks.completed >= 1);
  return { workerId: worker.workerId, resultPath: manifest.resultPath, evidence: result.evidence };
}

async function postRole(mcp, runId, blackboardId, topicId, role, step, body, resultPath, evidence, parentEvidence = []) {
  const artifact = await mcp.tool("cw_blackboard_artifact_add", {
    cwd: tmp,
    runId,
    blackboardId,
    topic: topicId,
    kind: "worker-result",
    path: resultPath,
    evidence
  });
  const message = await mcp.tool("cw_blackboard_message_post", {
    cwd: tmp,
    runId,
    blackboardId,
    topic: topicId,
    body,
    authorKind: "agent",
    authorId: role,
    artifact: [artifact.id],
    evidence: [...parentEvidence, ...evidence],
    tag: ["pdca", step]
  });
  return { artifact, message };
}

function writeResult(resultPath, result) {
  fs.writeFileSync(
    resultPath,
    [
      "# PDCA result",
      "",
      result.summary,
      "",
      "```cw:result",
      JSON.stringify({ summary: result.summary, findings: [], evidence: result.evidence }, null, 2),
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

function startMcp() {
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
  return {
    rpc,
    tool(name, args) {
      return rpc("tools/call", { name, arguments: args }).then((result) => JSON.parse(result.content[0].text));
    },
    close() {
      server.kill();
    }
  };
}
