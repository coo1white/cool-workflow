#!/usr/bin/env node
"use strict";

// @cw-smoke: tags slow

const assert = require("node:assert/strict");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ma-host-surface-"));
const evidencePath = path.join(tmp, "host-evidence.md");
fs.writeFileSync(evidencePath, "host evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;

(async () => {
  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Prove v0.1.20 host multi-agent surface."]);
  assert.ok(fs.existsSync(plan.statePath));

  const hostRun = runJson([
    "multi-agent",
    "run",
    plan.runId,
    "--topology",
    "judge-panel",
    "--topology-run",
    "host-panel",
    "--judge-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ]);
  assert.equal(hostRun.surface, "multi-agent-host");
  assert.equal(hostRun.command, "run");
  assert.equal(hostRun.ids.topologyRunIds[0], "host-panel");
  assert.equal(hostRun.data.dispatchCreated, false);
  assert.match(hostRun.nextAction, /multi-agent step/);

  const status = runJson(["multi-agent", "status", plan.runId, "--json"]);
  assert.equal(status.command, "status");
  assert.equal(status.state, "ready-for-dispatch");
  assert.equal(status.ids.multiAgentRunIds.includes("host-panel-ma"), true);
  assert.equal(status.ids.blackboardIds.includes("host-panel-blackboard"), true);
  assert.ok(status.paths.blackboardIndexPath);
  assert.ok(status.paths.auditSummaryPath);
  assert.ok(status.evidenceRequirements.includes("judge output"));

  const boardSummary = runJson(["multi-agent", "blackboard", plan.runId, "summary"]);
  assert.equal(boardSummary.command, "blackboard");
  assert.equal(boardSummary.data.blackboardId, "host-panel-blackboard");
  const message = runJson([
    "multi-agent",
    "blackboard",
    plan.runId,
    "post",
    "--topic",
    "host-panel-judge-verdicts",
    "--body",
    "Host loop message links implementation evidence.",
    "--evidence",
    evidenceLocator
  ]);
  assert.equal(message.performed, "posted-message");
  assert.equal(message.data.topicId, "host-panel-judge-verdicts");
  const artifact = runJson([
    "multi-agent",
    "blackboard",
    plan.runId,
    "add-artifact",
    "--topic",
    "host-panel-judge-verdicts",
    "--kind",
    "test-evidence",
    "--path",
    evidencePath,
    "--evidence",
    evidenceLocator
  ]);
  assert.equal(artifact.performed, "added-artifact");
  assert.equal(artifact.data.path, evidencePath);

  const firstDispatch = runJson(["multi-agent", "step", plan.runId, "--sandbox", "readonly"]);
  assert.equal(firstDispatch.performed, "created-dispatch-manifest");
  assert.equal(firstDispatch.data.tasks.length, 1);
  assert.equal(firstDispatch.data.multiAgent.runId, "host-panel-ma");
  const firstWorkerId = firstDispatch.data.tasks[0].workerId;
  const firstManifest = runJson(["worker", "manifest", plan.runId, firstWorkerId]);
  writeWorkerResult(firstManifest.resultPath, "host judge one result");
  const firstOutput = runJson(["worker", "output", plan.runId, firstWorkerId, firstManifest.resultPath]);
  assert.equal(firstOutput.tasks.completed, 1);

  const secondDispatch = runJson(["multi-agent", "step", plan.runId, "--sandbox", "readonly"]);
  assert.equal(secondDispatch.performed, "created-dispatch-manifest");
  assert.equal(secondDispatch.data.multiAgent.roleId, "host-panel-judge-2");
  const secondWorkerId = secondDispatch.data.tasks[0].workerId;
  const secondManifest = runJson(["worker", "manifest", plan.runId, secondWorkerId]);
  writeWorkerResult(secondManifest.resultPath, "host judge two result");
  const secondOutput = runJson(["worker", "output", plan.runId, secondWorkerId, secondManifest.resultPath]);
  assert.equal(secondOutput.tasks.completed, 2);

  const stepFanin = runJson(["multi-agent", "step", plan.runId]);
  assert.equal(stepFanin.performed, "collected-fanin");
  assert.equal(stepFanin.data.status, "ready");
  assert.ok(stepFanin.data.blackboardArtifactRefIds.length >= 1);
  const stepSnapshot = runJson(["multi-agent", "step", plan.runId]);
  assert.equal(stepSnapshot.performed, "created-blackboard-snapshot");
  const stepCandidate = runJson(["multi-agent", "step", plan.runId, "--candidate", "host-candidate"]);
  assert.equal(stepCandidate.performed, "registered-candidate");
  assert.equal(stepCandidate.data.workerId, firstWorkerId);

  const missingEvidence = runFail(["multi-agent", "score", plan.runId, stepCandidate.data.id, "--criterion", "correctness=1"]);
  assert.match(missingEvidence.stderr, /requires evidence/);

  const score = runJson([
    "multi-agent",
    "score",
    plan.runId,
    stepCandidate.data.id,
    "--criterion",
    "correctness=1",
    "--criterion",
    "evidence=1",
    "--evidence",
    evidenceLocator
  ]);
  assert.equal(score.command, "score");
  assert.equal(score.performed, "scored-candidate");
  const scoreId = score.data.id;

  const selection = runJson([
    "multi-agent",
    "select",
    plan.runId,
    stepCandidate.data.id,
    "--score",
    scoreId,
    "--reason",
    "Host smoke selected candidate with verifier and score evidence."
  ]);
  assert.equal(selection.command, "select");
  assert.equal(selection.performed, "selected-candidate");
  assert.equal(selection.data.candidateId, stepCandidate.data.id);
  assert.ok(selection.data.acceptanceRationale.auditEventIds.length >= 1);

  const ready = runJson(["multi-agent", "status", plan.runId, "--json"]);
  assert.equal(ready.state, "ready-for-commit");
  assert.match(ready.nextAction, /commit/);
  assert.equal(ready.summaries.candidates.readyForCommit.length, 1);

  const ambiguousRun = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Ambiguous host topology failure."]);
  runJson(["multi-agent", "run", ambiguousRun.runId, "--topology", "map-reduce", "--topology-run", "ambiguous-a"]);
  runJson(["multi-agent", "run", ambiguousRun.runId, "--topology", "debate", "--topology-run", "ambiguous-b"]);
  const ambiguous = runFail(["multi-agent", "step", ambiguousRun.runId]);
  assert.match(ambiguous.stderr, /Ambiguous active topology state/);

  const audit = runJson(["audit", "summary", plan.runId]);
  assert.ok(audit.byKind["candidate.score"] >= 1);
  assert.ok(audit.byKind["candidate.selection"] >= 1);
  assert.ok(audit.blackboard.artifacts >= 2);
  const provenance = runJson(["audit", "provenance", plan.runId, "--candidate", stepCandidate.data.id]);
  assert.ok(provenance.events.some((event) => event.kind === "candidate.selection"));

  const mcp = await readMcp(plan.runId, stepCandidate.data.id, scoreId);
  for (const name of [
    "cw_multi_agent_run",
    "cw_multi_agent_status",
    "cw_multi_agent_step",
    "cw_multi_agent_blackboard",
    "cw_multi_agent_score",
    "cw_multi_agent_select"
  ]) {
    assert.ok(mcp.tools.has(name), `missing MCP tool ${name}`);
  }
  assert.equal(mcp.status.surface, "multi-agent-host");
  assert.equal(mcp.board.command, "blackboard");
  assert.equal(mcp.step.performed, "none");
  assert.match(mcp.scoreError, /requires evidence/);
  assert.match(mcp.selectError, /Unknown candidate id/);

  const commit = runJson(["commit", plan.runId, "--selection", selection.data.id, "--reason", "Host smoke verifier-gated commit."]);
  assert.equal(commit.commit.verifierGated, true);
  assert.equal(commit.commit.selectionId, selection.data.id);
  const complete = runJson(["multi-agent", "status", plan.runId, "--json"]);
  assert.equal(complete.state, "complete");
  const postCommitStep = runJson(["multi-agent", "step", plan.runId]);
  assert.equal(postCommitStep.performed, "none");
  assert.match(postCommitStep.requiredHostAction, /completed run report/);

  const operatorStatus = runText(["status", plan.runId]);
  assert.match(operatorStatus, /Topologies/);
  assert.match(operatorStatus, /Multi-Agent/);
  assert.match(operatorStatus, /Next Action/);

  process.stdout.write("multi-agent-cli-mcp-surface-smoke: ok\n");
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
      "High-level multi-agent host worker output.",
      "",
      "```cw:result",
      JSON.stringify({
        summary: `${label} completed with host surface evidence.`,
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

function readMcp(runId, candidateId, scoreId) {
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
      return Promise.all([
        tool("cw_multi_agent_status", { cwd: tmp, runId }),
        tool("cw_multi_agent_blackboard", { cwd: tmp, runId, action: "summary" }),
        tool("cw_multi_agent_step", { cwd: tmp, runId }),
        tool("cw_multi_agent_score", {
          cwd: tmp,
          runId,
          candidate: candidateId,
          criterion: ["correctness=1"]
        }).catch((error) => ({ error: error.message })),
        tool("cw_multi_agent_select", {
          cwd: tmp,
          runId,
          candidate: "missing-candidate",
          score: scoreId,
          reason: "MCP host select fail-closed probe."
        }).catch((error) => ({ error: error.message }))
      ]).then(([status, board, step, scoreResult, select]) => ({ tools, status, board, step, scoreError: scoreResult.error || "", selectError: select.error || "" }));
    })
    .finally(() => server.kill());
}
