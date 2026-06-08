#!/usr/bin/env node
"use strict";

// v0.1.25 State Explosion Management smoke test.
//
// Synthesizes a large topology-backed multi-agent run (many blackboard messages,
// multiple topics, many graph nodes/edges, failures/blockers, adopted + missing
// evidence, trust/audit records, judge rationale, candidate score + selection)
// and asserts that the derived summary/compaction layer makes the run readable
// without ever hiding raw source records, failures, missing evidence, policy
// violations, or judge rationale.

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-state-explosion-"));
const evidencePath = path.join(tmp, "explosion-evidence.md");
fs.writeFileSync(evidencePath, "state explosion evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;
const artifactPath = path.join(tmp, "explosion-artifact.md");
fs.writeFileSync(artifactPath, "# adopted artifact\n", "utf8");

(async () => {
  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Prove v0.1.25 state explosion management."]);
  const runId = plan.runId;
  runJson([
    "multi-agent",
    "run",
    runId,
    "--topology",
    "judge-panel",
    "--topology-run",
    "sem",
    "--judge-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ]);

  // Multiple topics.
  const topics = ["sem-judge-verdicts"];
  for (const id of ["sem-design", "sem-risks", "sem-evidence"]) {
    runJson(["blackboard", "topic", "create", runId, "--id", id, "--title", `Topic ${id}`]);
    topics.push(id);
  }

  // Many blackboard messages across topics (drives graph node explosion).
  for (let i = 0; i < 40; i += 1) {
    const topic = topics[i % topics.length];
    runJson(["blackboard", "message", "post", runId, "--topic", topic, "--body", `Bulk discussion message ${i} on ${topic}.`]);
  }

  // Judge rationale message with evidence (must never be hidden).
  const rationale = runJson([
    "blackboard",
    "message",
    "post",
    runId,
    "--topic",
    "sem-judge-verdicts",
    "--blackboard",
    "sem-blackboard",
    "--body",
    "Judge rationale: candidate is acceptable with explicit cited evidence.",
    "--authorKind",
    "role",
    "--authorId",
    "sem-judge-1",
    "--multi-agent-run",
    "sem-ma",
    "--role",
    "sem-judge-1",
    "--evidence",
    evidenceLocator,
    "--tag",
    "judge-rationale"
  ]);
  assert.equal(rationale.provenance.agentRoleId, "sem-judge-1");

  // Unresolved question (missing evidence) + conflicting context (policy/conflict).
  runJson(["blackboard", "context", "put", runId, "--topic", "sem-risks", "--kind", "question", "--key", "open-risk", "--value", "Is the compaction layer lossless?"]);
  runJson(["blackboard", "context", "put", runId, "--topic", "sem-design", "--kind", "decision", "--key", "store", "--value", "files"]);
  runJson(["blackboard", "context", "put", runId, "--topic", "sem-design", "--kind", "decision", "--key", "store", "--value", "database"]);

  // Adopted evidence artifact.
  runJson(["blackboard", "artifact", "add", runId, "--topic", "sem-evidence", "--path", artifactPath, "--kind", "doc"]);

  // Workers report output with evidence.
  for (const label of ["judge one", "judge two"]) {
    const dispatch = runJson(["multi-agent", "step", runId, "--sandbox", "readonly"]);
    const workerId = dispatch.data.tasks[0].workerId;
    const manifest = runJson(["worker", "manifest", runId, workerId]);
    writeWorkerResult(manifest.resultPath, label);
    runJson(["worker", "output", runId, workerId, manifest.resultPath]);
  }
  assert.equal(runJson(["multi-agent", "step", runId]).performed, "collected-fanin");
  assert.equal(runJson(["multi-agent", "step", runId]).performed, "created-blackboard-snapshot");
  assert.equal(runJson(["multi-agent", "step", runId, "--candidate", "sem-candidate"]).performed, "registered-candidate");

  const score = runJson([
    "multi-agent",
    "score",
    runId,
    "sem-candidate",
    "--role",
    "sem-judge-1",
    "--multi-agent-run",
    "sem-ma",
    "--criterion",
    "correctness=1",
    "--criterion",
    "evidence=1",
    "--evidence",
    evidenceLocator,
    "--rationale",
    "Judge accepts the candidate; worker and verifier evidence agree."
  ]);
  const selection = runJson([
    "multi-agent",
    "select",
    runId,
    "sem-candidate",
    "--role",
    "sem-panel-chair",
    "--multi-agent-run",
    "sem-ma",
    "--score",
    score.data.id,
    "--evidence",
    evidenceLocator,
    "--reason",
    "Panel selected the score-backed candidate with cited judge rationale."
  ]);
  const commit = runJson(["commit", runId, "--selection", selection.data.id, "--reason", "State explosion verifier-gated commit."]);
  assert.equal(commit.commit.verifierGated, true);

  // --- Summary refresh + show -------------------------------------------------
  const index = runJson(["summary", "refresh", runId, "--json"]);
  assert.equal(index.id, "multi-agent-summary-index");
  assert.equal(index.deterministic, true);
  assert.ok(index.entries.length >= 5, "summary index should hold multiple records");
  for (const entry of index.entries) assert.ok(fs.existsSync(entry.path), `summary record file missing: ${entry.path}`);
  const summariesDir = index.paths.summariesDir;
  assert.ok(fs.existsSync(path.join(summariesDir, "index.json")));
  assert.ok(fs.existsSync(path.join(summariesDir, "state-explosion-report.json")));

  const report = runJson(["summary", "show", runId, "--json"]);
  assert.equal(report.freshness.status, "valid");
  assert.equal(report.stateSize.compactionRecommended, true, "large run must recommend compaction");
  assert.ok(report.stateSize.graphNodes > 40, `expected >40 graph nodes, got ${report.stateSize.graphNodes}`);

  // --- Compact graph is smaller than full; critical path preserved ------------
  const full = runJson(["multi-agent", "graph", runId, "--view", "full", "--json"]);
  const compact = runJson(["multi-agent", "graph", runId, "--view", "compact", "--json"]);
  assert.equal(full.view, "full");
  assert.equal(compact.view, "compact");
  assert.ok(compact.compactNodeCount < compact.fullNodeCount, "compact graph must be smaller than full graph");
  assert.ok(compact.syntheticNodes.length >= 1, "compact graph must contain synthetic summary nodes");
  for (const syn of compact.syntheticNodes) {
    assert.equal(syn.kind, "summary");
    assert.ok(syn.collapsedNodeCount >= 1);
    assert.ok(Array.isArray(syn.sourceIds) && syn.sourceIds.length >= 1, "synthetic node must expose source ids");
    assert.ok(typeof syn.dominantStatus === "string");
    assert.ok(syn.expansionCommand.includes("cw.js"), "synthetic node must expose an expansion command");
  }
  // Critical path preserved across compact and critical-path views.
  const criticalView = runJson(["multi-agent", "graph", runId, "--view", "critical-path", "--json"]);
  for (const required of [`${runId}:run`, `${runId}:multi-agent:sem-ma`, `${runId}:multi-agent:group:sem-group`]) {
    assert.ok(compact.criticalPath.includes(required), `compact critical path missing ${required}`);
    assert.ok(criticalView.criticalPath.includes(required), `critical-path view missing ${required}`);
  }
  const compactNodeIds = new Set(compact.nodes.map((n) => n.id));
  for (const required of [`${runId}:run`, `${runId}:multi-agent:group:sem-group`]) {
    assert.ok(compactNodeIds.has(required), `compact graph dropped critical node ${required}`);
  }

  // --- Failures and missing evidence are NOT hidden ---------------------------
  assert.ok(report.operatorDigest.evidenceDigest.missing >= 1, "missing evidence must surface");
  assert.ok(report.operatorDigest.evidenceDigest.adopted >= 1, "adopted evidence must surface");
  assert.ok(report.blackboardDigest.unresolvedQuestions.length >= 1, "unresolved question must surface");
  assert.ok(report.blackboardDigest.conflicts.length >= 1, "conflict must surface");
  assert.ok(report.blackboardDigest.judgeRationale.length >= 1, "judge rationale must surface");
  assert.ok(report.blackboardDigest.policyViolations.length >= 1, "policy/conflict violation must surface");
  assert.ok(report.hiddenSourceRecords.length >= 1, "compacted run must report hidden source records");

  // --- Full source records remain available + expand back ---------------------
  const allMessages = runJson(["blackboard", "message", "list", runId, "--json"]);
  assert.ok(allMessages.length >= 41, `raw messages must remain available, got ${allMessages.length}`);
  const messagesJsonl = path.join(tmp, ".cw", "runs", runId, "blackboard", "messages.jsonl");
  assert.ok(fs.existsSync(messagesJsonl), "raw blackboard messages.jsonl must persist");
  const messageSynthetic = compact.syntheticNodes.find((syn) => syn.id.includes(":summary:messages"));
  assert.ok(messageSynthetic, "messages should collapse into a synthetic node");
  const fullNodeIds = new Set(full.nodes.map((n) => n.id));
  for (const sourceId of messageSynthetic.sourceIds.slice(0, 5)) {
    assert.ok(fullNodeIds.has(sourceId), `collapsed source ${sourceId} must expand back to a raw full-graph node`);
  }

  // --- CLI human output is readable (stable panels) ---------------------------
  const human = runText(["summary", "show", runId]);
  for (const panel of [
    "State Size",
    "Compact Graph",
    "Blackboard Digest",
    "Critical Path",
    "Failures / Blockers",
    "Evidence Digest",
    "Trust / Policy Digest",
    "Hidden Source Records",
    "Expansion Commands",
    "Next Action"
  ]) assert.match(human, new RegExp(panel.replace(/[/]/g, "\\/")), `missing panel ${panel}`);
  assert.match(human, /Graph compacted: \d+ nodes collapsed into \d+ summary nodes/);
  assert.match(human, /node scripts\/cw\.js multi-agent graph .* --view full/);

  // --- CLI JSON is deterministic ----------------------------------------------
  const showA = stripVolatile(runJson(["summary", "show", runId, "--json"]));
  const showB = stripVolatile(runJson(["summary", "show", runId, "--json"]));
  assert.deepEqual(showA, showB, "summary show JSON must be deterministic");
  const graphA = stripVolatile(runJson(["multi-agent", "graph", runId, "--view", "compact", "--json"]));
  const graphB = stripVolatile(runJson(["multi-agent", "graph", runId, "--view", "compact", "--json"]));
  assert.deepEqual(graphA, graphB, "compact graph JSON must be deterministic");

  // --- report --show integrates state-size panels -----------------------------
  const reportShow = runText(["report", runId, "--show"]);
  assert.match(reportShow, /State Explosion Report/);
  const reportMd = fs.readFileSync(path.join(tmp, ".cw", "runs", runId, "report.md"), "utf8");
  assert.match(reportMd, /## State Size & Compaction/);
  assert.match(reportMd, /Graph compacted/);

  // --- Stale detection (fail closed) ------------------------------------------
  runJson(["blackboard", "message", "post", runId, "--topic", "sem-design", "--body", "Late-breaking message after refresh."]);
  const staleReport = runJson(["summary", "show", runId, "--json"]);
  assert.equal(staleReport.freshness.status, "stale", "summary must fail closed when source changed");
  assert.ok(staleReport.freshness.staleScopes.length >= 1, "stale scopes must be reported");
  // Refresh restores freshness.
  runJson(["summary", "refresh", runId, "--json"]);
  assert.equal(runJson(["summary", "show", runId, "--json"]).freshness.status, "valid");

  // --- Eval / replay captures and compares summary artifacts ------------------
  const snapshot = runJson(["eval", "snapshot", runId, "--id", "sem-suite", "--json"]);
  for (const section of ["compactGraphShape", "blackboardDigest", "criticalPath", "evidenceDigest", "expansionRefs", "summaryFreshness"]) {
    assert.ok(Array.isArray(snapshot.normalized[section]), `snapshot normalized missing ${section}`);
  }
  assert.ok(snapshot.normalized.criticalPath.length >= 1);

  const replay = runJson(["eval", "replay", snapshot.paths.snapshotPath, "--id", "sem-suite-replay", "--json"]);
  const comparison = runJson(["eval", "compare", snapshot.paths.snapshotPath, replay.paths.replayRunPath, "--json"]);
  assert.equal(comparison.status, "pass");
  const scoreResult = runJson(["eval", "score", replay.paths.replayRunPath, "--json"]);
  assert.equal(scoreResult.status, "pass");
  for (const metric of [
    "summary_freshness",
    "compact_graph_parity",
    "blackboard_digest_parity",
    "critical_path_parity",
    "evidence_digest_parity",
    "expansion_ref_integrity"
  ]) assert.ok(scoreResult.metrics.some((entry) => entry.id === metric && entry.status === "pass"), `metric ${metric} must pass`);

  const reportEval = runJson(["eval", "report", replay.paths.replayRunPath, "--json"]);
  const reportEvalText = fs.readFileSync(reportEval.reportPath, "utf8");
  assert.match(reportEvalText, /State Explosion Summaries/);
  const gate = runJson(["eval", "gate", path.dirname(snapshot.paths.snapshotPath), "--json"]);
  assert.equal(gate.status, "pass");

  // --- Release gate fails on broken/lost summary artifacts --------------------
  const regress = (name, mutate) => {
    const regressionPath = path.join(path.dirname(snapshot.paths.snapshotPath), `regressed-${name}.json`);
    const regressed = JSON.parse(fs.readFileSync(replay.paths.replayRunPath, "utf8"));
    regressed.id = `sem-suite-${name}`;
    regressed.paths.replayRunPath = regressionPath;
    mutate(regressed.replay);
    fs.writeFileSync(regressionPath, `${JSON.stringify(regressed, null, 2)}\n`, "utf8");
    return regressionPath;
  };

  const lostCriticalPath = regress("critical", (normalized) => {
    normalized.criticalPath = [];
  });
  const lostCriticalComparison = runJson(["eval", "compare", snapshot.paths.snapshotPath, lostCriticalPath, "--json"]);
  assert.equal(lostCriticalComparison.status, "fail");
  assert.ok(lostCriticalComparison.findings.some((f) => f.category === "criticalPath"), "changed critical path must be flagged");

  const brokenGraph = regress("graph", (normalized) => {
    normalized.compactGraphShape = ["{\"tampered\":true}"];
    normalized.expansionRefs = [];
  });
  const brokenGraphScore = runJson(["eval", "score", brokenGraph, "--json"]);
  assert.equal(brokenGraphScore.status, "fail");
  assert.ok(brokenGraphScore.metrics.some((m) => m.id === "compact_graph_parity" && m.status === "fail"));
  assert.ok(brokenGraphScore.metrics.some((m) => m.id === "expansion_ref_integrity" && m.status === "fail"));
  const failedGate = runFail(["eval", "gate", path.dirname(snapshot.paths.snapshotPath)]);
  assert.notEqual(failedGate.status, 0, "release gate must fail on broken summaries");

  // Restore a clean, passing comparison/score/gate so the suite ends green.
  runJson(["eval", "compare", snapshot.paths.snapshotPath, replay.paths.replayRunPath, "--json"]);
  runJson(["eval", "score", replay.paths.replayRunPath, "--json"]);
  runJson(["eval", "gate", path.dirname(snapshot.paths.snapshotPath), "--json"]);

  // --- MCP parity -------------------------------------------------------------
  const mcp = await readMcp(runId, snapshot.paths.snapshotPath);
  for (const name of [
    "cw_summary_refresh",
    "cw_summary_show",
    "cw_blackboard_summarize",
    "cw_multi_agent_summarize",
    "cw_multi_agent_graph_compact"
  ]) assert.ok(mcp.tools.has(name), `missing MCP tool ${name}`);
  assert.equal(mcp.summaryShow.runId, runId);
  assert.ok(Array.isArray(mcp.summaryShow.compactGraph.syntheticNodes));
  assert.ok(mcp.blackboardDigest.topicRollups.length >= 1, "MCP blackboard digest must include source-linked rollups");
  assert.ok(mcp.blackboardDigest.topicRollups[0].expansionCommand.includes("cw.js"), "MCP digest must include expansion hints");
  assert.ok(mcp.graphCompact.compactNodeCount < mcp.graphCompact.fullNodeCount);
  assert.ok(mcp.graphCompact.syntheticNodes.every((syn) => syn.sourceIds.length >= 1), "MCP compact graph must keep source refs");

  process.stdout.write("state-explosion-management-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key === "generatedAt") continue;
      out[key] = stripVolatile(value[key]);
    }
    return out;
  }
  return value;
}

function writeWorkerResult(resultPath, label) {
  fs.writeFileSync(
    resultPath,
    [
      `# ${label}`,
      "",
      "State explosion worker output.",
      "",
      "```cw:result",
      JSON.stringify({ summary: `${label} completed with evidence.`, findings: [], evidence: [evidenceLocator] }),
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
  return execFileSync(node, [cli, ...args], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runFail(args) {
  return spawnSync(node, [cli, ...args], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function readMcp(runId, snapshotPath) {
  void snapshotPath;
  const server = spawn(node, [mcpServer], { cwd: pluginRoot, stdio: ["pipe", "pipe", "pipe"] });
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
  const tool = (name, args) => rpc("tools/call", { name, arguments: args }).then((result) => JSON.parse(result.content[0].text));
  return Promise.resolve()
    .then(() => rpc("initialize", {}))
    .then(() => rpc("tools/list", {}))
    .then((listed) =>
      Promise.all([
        tool("cw_summary_refresh", { cwd: tmp, runId }),
        tool("cw_summary_show", { cwd: tmp, runId }),
        tool("cw_blackboard_summarize", { cwd: tmp, runId }),
        tool("cw_multi_agent_summarize", { cwd: tmp, runId }),
        tool("cw_multi_agent_graph_compact", { cwd: tmp, runId, view: "compact" })
      ]).then(([summaryRefresh, summaryShow, blackboardDigest, multiAgentSummarize, graphCompact]) => ({
        tools: new Set(listed.tools.map((entry) => entry.name)),
        summaryRefresh,
        summaryShow,
        blackboardDigest,
        multiAgentSummarize,
        graphCompact
      }))
    )
    .finally(() => server.kill());
}
