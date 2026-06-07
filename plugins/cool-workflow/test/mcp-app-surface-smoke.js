#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-app-surface-"));
const server = spawn(process.execPath, [path.join(pluginRoot, "dist/mcp-server.js")], {
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

function tool(name, args) {
  return rpc("tools/call", { name, arguments: args }).then((result) => {
    assert.equal(result.content[0].type, "text");
    return JSON.parse(result.content[0].text);
  });
}

(async () => {
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-app-surface-smoke", version: "1.0.0" }
    });
    assert.equal(init.serverInfo.version, "0.1.20");

    const listed = await rpc("tools/list", {});
    const toolNames = new Set(listed.tools.map((entry) => entry.name));
    for (const name of [
      "cw_app_list",
      "cw_app_show",
      "cw_app_validate",
      "cw_app_package",
      "cw_app_run",
      "cw_operator_status",
      "cw_operator_graph",
      "cw_operator_report",
      "cw_worker_list",
      "cw_worker_show",
      "cw_worker_manifest",
      "cw_worker_output",
      "cw_worker_validate",
      "cw_candidate_list",
      "cw_candidate_show",
      "cw_candidate_register",
      "cw_candidate_score",
      "cw_candidate_rank",
      "cw_candidate_select",
      "cw_candidate_reject",
      "cw_candidate_summary",
      "cw_sandbox_choose",
      "cw_commit",
      "cw_commit_summary",
      "cw_feedback_summary"
    ]) {
      assert.ok(toolNames.has(name), `missing MCP tool ${name}`);
    }

    const apps = await tool("cw_app_list", { cwd: tmp });
    assert.ok(apps.some((app) => app.id === "end-to-end-golden-path"));
    const shown = await tool("cw_app_show", { cwd: tmp, appId: "end-to-end-golden-path" });
    assert.equal(shown.app.id, "end-to-end-golden-path");
    const validation = await tool("cw_app_validate", { cwd: tmp, target: "end-to-end-golden-path" });
    assert.equal(validation.valid, true);
    const sandbox = await tool("cw_sandbox_choose", { cwd: tmp, sandboxProfileId: "readonly" });
    assert.equal(sandbox.profile.id, "readonly");

    const appRun = await tool("cw_app_run", {
      cwd: tmp,
      appId: "end-to-end-golden-path",
      inputs: { question: "prove MCP app surface smoke" },
      sandbox: "readonly"
    });
    assert.equal(appRun.appId, "end-to-end-golden-path");
    assert.equal(appRun.appVersion, "0.1.20");
    assert.equal(appRun.pendingTasks, 1);
    assert.ok(fs.existsSync(appRun.statePath));

    const dispatch = await tool("cw_dispatch", {
      cwd: tmp,
      runId: appRun.runId,
      limit: 1,
      sandboxProfileId: "readonly"
    });
    assert.equal(dispatch.sandboxProfileId, "readonly");
    assert.equal(dispatch.tasks.length, 1);
    const workerId = dispatch.tasks[0].workerId;
    const manifest = await tool("cw_worker_manifest", { cwd: tmp, runId: appRun.runId, workerId });
    assert.equal(manifest.id, workerId);
    assert.equal(manifest.sandboxProfileId, "readonly");
    assert.ok(manifest.inputPath);
    assert.ok(manifest.resultPath);
    assert.ok(manifest.artifactsDir);
    assert.ok(manifest.logsDir);

    const boundary = await tool("cw_worker_validate", {
      cwd: tmp,
      runId: appRun.runId,
      workerId,
      path: manifest.resultPath
    });
    assert.equal(boundary, null);

    fs.writeFileSync(
      manifest.resultPath,
      [
        "# MCP worker result",
        "",
        "The MCP app surface smoke completed deterministically.",
        "",
        "```cw:result",
        JSON.stringify(
          {
            summary: "MCP app surface smoke result",
            findings: [],
            evidence: ["test/mcp-app-surface-smoke.js:1"]
          },
          null,
          2
        ),
        "```",
        ""
      ].join("\n"),
      "utf8"
    );

    const output = await tool("cw_worker_output", {
      cwd: tmp,
      runId: appRun.runId,
      workerId,
      resultPath: manifest.resultPath
    });
    assert.equal(output.tasks.completed, 1);
    const worker = await tool("cw_worker_show", { cwd: tmp, runId: appRun.runId, workerId });
    assert.equal(worker.status, "verified");
    assert.ok(worker.resultNodeId);
    assert.ok(worker.output.verifierNodeId);
    const workers = await tool("cw_worker_list", { cwd: tmp, runId: appRun.runId });
    assert.equal(workers.length, 1);

    const candidate = await tool("cw_candidate_register", {
      cwd: tmp,
      runId: appRun.runId,
      id: "mcp-candidate",
      kind: "worker-output",
      worker: workerId
    });
    assert.equal(candidate.id, "mcp-candidate");
    const score = await tool("cw_candidate_score", {
      cwd: tmp,
      runId: appRun.runId,
      candidateId: candidate.id,
      criteria: { correctness: 4, evidence: 4, fit: 2 },
      maxTotal: 10,
      evidence: ["test/mcp-app-surface-smoke.js:1"],
      verdict: "pass",
      notes: "deterministic MCP smoke candidate"
    });
    assert.equal(score.normalized, 1);
    const ranking = await tool("cw_candidate_rank", {
      cwd: tmp,
      runId: appRun.runId,
      requireEvidence: true,
      requireVerifierGate: true
    });
    assert.equal(ranking.candidates[0].candidateId, candidate.id);
    const selection = await tool("cw_candidate_select", {
      cwd: tmp,
      runId: appRun.runId,
      candidateId: candidate.id,
      reason: "MCP smoke selected",
      requireVerifierGate: true
    });
    assert.equal(selection.candidateId, candidate.id);
    assert.equal(selection.verifierNodeId, worker.output.verifierNodeId);
    const candidateSummary = await tool("cw_candidate_summary", { cwd: tmp, runId: appRun.runId });
    assert.equal(candidateSummary.readyForCommit.length, 1);

    const commit = await tool("cw_commit", {
      cwd: tmp,
      runId: appRun.runId,
      selection: selection.id,
      reason: "MCP smoke verifier-gated commit"
    });
    assert.equal(commit.verifierGated, true);
    assert.equal(commit.checkpoint, false);
    assert.equal(commit.selectionId, selection.id);
    assert.equal(commit.evidenceCount, 1);
    assert.ok(fs.existsSync(commit.snapshotPath));

    const status = await tool("cw_operator_status", { cwd: tmp, runId: appRun.runId });
    assert.equal(status.runId, appRun.runId);
    assert.equal(status.tasks.completed.length, 1);
    const graph = await tool("cw_operator_graph", { cwd: tmp, runId: appRun.runId });
    assert.ok(graph.nodes.some((node) => node.kind === "worker"));
    const report = await tool("cw_operator_report", { cwd: tmp, runId: appRun.runId });
    assert.equal(report.commits.verifierGated, 1);
    const workerSummary = await tool("cw_worker_summary", { cwd: tmp, runId: appRun.runId });
    assert.equal(workerSummary.total, 1);
    const commitSummary = await tool("cw_commit_summary", { cwd: tmp, runId: appRun.runId });
    assert.equal(commitSummary.verifierGated, 1);
    const feedbackSummary = await tool("cw_feedback_summary", { cwd: tmp, runId: appRun.runId });
    assert.equal(feedbackSummary.total, 0);

    process.stdout.write("mcp-app-surface-smoke: ok\n");
  } finally {
    server.stdin.end();
    server.kill();
    if (stderr) process.stderr.write(stderr);
  }
})().catch((error) => {
  server.kill();
  console.error(error);
  process.exitCode = 1;
});
