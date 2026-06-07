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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ma-eval-replay-"));
const evidencePath = path.join(tmp, "eval-evidence.md");
fs.writeFileSync(evidencePath, "eval replay evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

(async () => {
  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Prove v0.1.23 multi-agent eval replay."]);
  runJson([
    "multi-agent",
    "run",
    plan.runId,
    "--topology",
    "judge-panel",
    "--topology-run",
    "eval-panel",
    "--judge-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ]);

  const rationale = runJson([
    "blackboard",
    "message",
    "post",
    plan.runId,
    "--topic",
    "eval-panel-judge-verdicts",
    "--blackboard",
    "eval-panel-blackboard",
    "--body",
    "Judge rationale for eval replay with explicit evidence.",
    "--authorKind",
    "role",
    "--authorId",
    "eval-panel-judge-1",
    "--multi-agent-run",
    "eval-panel-ma",
    "--role",
    "eval-panel-judge-1",
    "--evidence",
    evidenceLocator,
    "--tag",
    "judge-rationale"
  ]);
  assert.equal(rationale.provenance.agentRoleId, "eval-panel-judge-1");

  for (const label of ["judge one", "judge two"]) {
    const dispatch = runJson(["multi-agent", "step", plan.runId, "--sandbox", "readonly"]);
    const workerId = dispatch.data.tasks[0].workerId;
    const manifest = runJson(["worker", "manifest", plan.runId, workerId]);
    writeWorkerResult(manifest.resultPath, label);
    runJson(["worker", "output", plan.runId, workerId, manifest.resultPath]);
  }

  assert.equal(runJson(["multi-agent", "step", plan.runId]).performed, "collected-fanin");
  assert.equal(runJson(["multi-agent", "step", plan.runId]).performed, "created-blackboard-snapshot");
  assert.equal(runJson(["multi-agent", "step", plan.runId, "--candidate", "eval-candidate"]).performed, "registered-candidate");

  const score = runJson([
    "multi-agent",
    "score",
    plan.runId,
    "eval-candidate",
    "--role",
    "eval-panel-judge-1",
    "--multi-agent-run",
    "eval-panel-ma",
    "--criterion",
    "correctness=1",
    "--criterion",
    "evidence=1",
    "--evidence",
    evidenceLocator,
    "--rationale",
    "Judge accepts the replay candidate because worker evidence and verifier evidence agree."
  ]);
  const selection = runJson([
    "multi-agent",
    "select",
    plan.runId,
    "eval-candidate",
    "--role",
    "eval-panel-panel-chair",
    "--multi-agent-run",
    "eval-panel-ma",
    "--score",
    score.data.id,
    "--evidence",
    evidenceLocator,
    "--reason",
    "Panel selected the score-backed candidate with cited judge rationale."
  ]);
  const commit = runJson(["commit", plan.runId, "--selection", selection.data.id, "--reason", "Eval replay verifier-gated commit."]);
  assert.equal(commit.commit.verifierGated, true);
  runText(["report", plan.runId]);

  const snapshot = runJson(["eval", "snapshot", plan.runId, "--id", "eval-suite", "--json"]);
  assert.equal(snapshot.id, "eval-suite");
  assert.equal(snapshot.runId, plan.runId);
  assert.ok(fs.existsSync(snapshot.paths.snapshotPath));
  assert.ok(snapshot.normalized.judgeRationales.length >= 1);
  assert.ok(snapshot.normalized.verifierCommitGate.some((line) => line.includes("\"verifierGated\":true")));

  const replay = runJson(["eval", "replay", snapshot.paths.snapshotPath, "--id", "eval-suite-replay", "--json"]);
  assert.equal(replay.status, "completed");
  assert.ok(fs.existsSync(replay.paths.replayRunPath));
  assert.notEqual(replay.paths.replayDir, path.dirname(snapshot.paths.snapshotPath));

  const comparison = runJson(["eval", "compare", snapshot.paths.snapshotPath, replay.paths.replayRunPath, "--json"]);
  assert.equal(comparison.status, "pass");
  assert.equal(comparison.findings.length, 0);

  const scoreResult = runJson(["eval", "score", replay.paths.replayRunPath, "--json"]);
  assert.equal(scoreResult.status, "pass");
  assert.equal(scoreResult.score, scoreResult.maxScore);
  for (const metric of [
    "replay_completed",
    "graph_parity",
    "role_parity",
    "group_parity",
    "membership_parity",
    "fanout_parity",
    "fanin_parity",
    "dependency_parity",
    "failure_parity",
    "blackboard_record_parity",
    "evidence_adoption_parity",
    "trust_audit_parity",
    "role_policy_parity",
    "permission_decision_parity",
    "policy_violation_parity",
    "blackboard_provenance_parity",
    "judge_rationale_parity",
    "panel_decision_parity",
    "candidate_score_parity",
    "selection_parity",
    "verifier_commit_gate_parity",
    "report_parity"
  ]) assert.ok(scoreResult.metrics.some((entry) => entry.id === metric && entry.status === "pass"), metric);

  const report = runJson(["eval", "report", replay.paths.replayRunPath, "--json"]);
  assert.ok(fs.existsSync(report.reportPath));
  const reportText = fs.readFileSync(report.reportPath, "utf8");
  for (const heading of [
    "Eval Suite",
    "Replay Status",
    "Graph Comparison",
    "Evidence Comparison",
    "Trust / Policy / Audit Comparison",
    "Candidate Score Comparison",
    "Selection / Commit Gate",
    "Regression Findings",
    "Final Verdict",
    "Next Action"
  ]) assert.match(reportText, new RegExp(heading));

  const gate = runJson(["eval", "gate", path.dirname(snapshot.paths.snapshotPath), "--json"]);
  assert.equal(gate.status, "pass");
  assert.equal(gate.verdict, "ship");

  const human = runText(["eval", "score", replay.paths.replayRunPath]);
  for (const heading of [
    "Eval Suite",
    "Replay Status",
    "Graph Comparison",
    "Evidence Comparison",
    "Trust / Policy / Audit Comparison",
    "Candidate Score Comparison",
    "Selection / Commit Gate",
    "Regression Findings",
    "Final Verdict",
    "Next Action"
  ]) assert.match(human, new RegExp(heading));

  const regressionPath = path.join(path.dirname(snapshot.paths.snapshotPath), "regressed-replay-run.json");
  const regressed = JSON.parse(fs.readFileSync(replay.paths.replayRunPath, "utf8"));
  regressed.id = "eval-suite-regressed";
  regressed.status = "failed";
  regressed.errors = ["simulated replay failure"];
  regressed.paths.replayRunPath = regressionPath;
  regressed.replay.judgeRationales = [];
  fs.writeFileSync(regressionPath, `${JSON.stringify(regressed, null, 2)}\n`, "utf8");
  const regressedComparison = runJson(["eval", "compare", snapshot.paths.snapshotPath, regressionPath, "--json"]);
  assert.equal(regressedComparison.status, "fail");
  assert.ok(regressedComparison.findings.some((entry) => entry.category === "workflow"));
  assert.ok(regressedComparison.findings.some((entry) => entry.category === "judgeRationales"));
  const staleGate = runFail(["eval", "gate", path.dirname(snapshot.paths.snapshotPath)]);
  assert.notEqual(staleGate.status, 0);
  assert.match(staleGate.stderr, /stale score artifact/);
  const regressedScore = runJson(["eval", "score", regressionPath, "--json"]);
  assert.equal(regressedScore.status, "fail");
  const failedGate = runFail(["eval", "gate", path.dirname(snapshot.paths.snapshotPath)]);
  assert.notEqual(failedGate.status, 0);
  assert.match(failedGate.stdout, /Final Verdict/);
  runJson(["eval", "compare", snapshot.paths.snapshotPath, replay.paths.replayRunPath, "--json"]);
  runJson(["eval", "score", replay.paths.replayRunPath, "--json"]);
  runJson(["eval", "gate", path.dirname(snapshot.paths.snapshotPath), "--json"]);

  const mcp = await readMcp(plan.runId, snapshot.paths.snapshotPath, replay.paths.replayRunPath);
  for (const name of [
    "cw_eval_snapshot",
    "cw_eval_replay",
    "cw_eval_compare",
    "cw_eval_score",
    "cw_eval_gate",
    "cw_eval_report"
  ]) assert.ok(mcp.tools.has(name), `missing MCP tool ${name}`);
  assert.equal(mcp.compare.status, "pass");
  assert.equal(mcp.score.status, "pass");
  assert.equal(mcp.gate.status, "pass");
  assert.ok(fs.existsSync(mcp.report.reportPath));

  process.stdout.write("multi-agent-eval-replay-smoke: ok\n");
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
      "Eval replay worker output.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: `${label} completed with evidence.`,
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
  return spawnSync(node, [cli, ...args], {
    cwd: tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function readMcp(runId, snapshotPath, replayPath) {
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
      tool("cw_eval_snapshot", { cwd: tmp, runId, id: "eval-suite-mcp" }),
      tool("cw_eval_replay", { cwd: tmp, snapshot: snapshotPath, id: "eval-suite-mcp-replay" }),
      tool("cw_eval_compare", { cwd: tmp, baseline: snapshotPath, replay: replayPath }),
      tool("cw_eval_score", { cwd: tmp, replay: replayPath }),
      tool("cw_eval_gate", { cwd: tmp, suite: path.dirname(snapshotPath) }),
      tool("cw_eval_report", { cwd: tmp, replay: replayPath })
    ]).then(([snapshot, replay, compare, score, gate, report]) => ({
      tools: new Set(listed.tools.map((entry) => entry.name)),
      snapshot,
      replay,
      compare,
      score,
      gate,
      report
    })))
    .finally(() => server.kill());
}
