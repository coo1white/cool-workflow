#!/usr/bin/env node
"use strict";

// v0.1.26 Evidence Adoption Reasoning Chain smoke test.
//
// Builds a judge-panel multi-agent run (worker output, blackboard, judge
// rationale, fanin, candidate score, selection, verifier-gated commit) and
// asserts the derived reasoning chain answers WHY each adoption happened:
// decision, basis, authority, rationale, and counterfactual per gate. It proves
// reasoning-chain freshness (valid|stale|absent), evidence/reasoning parity
// under compaction, fail-closed `unexplained` on missing rationale, backward
// compatibility, eval/replay regression gates, and CLI/MCP/JSON determinism.

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-evidence-reasoning-"));
const evidencePath = path.join(tmp, "reasoning-evidence.md");
fs.writeFileSync(evidencePath, "reasoning evidence\n", "utf8");
const evidenceLocator = `${evidencePath}:1`;
const artifactPath = path.join(tmp, "reasoning-artifact.md");
fs.writeFileSync(artifactPath, "# adopted artifact\n", "utf8");

(async () => {
  const plan = runJson(["plan", "architecture-review", "--repo", tmp, "--question", "Prove v0.1.26 evidence adoption reasoning chain."]);
  const runId = plan.runId;
  runJson(["multi-agent", "run", runId, "--topology", "judge-panel", "--topology-run", "rc", "--judge-count", "2", "--task", "map:server-api", "--task", "map:web-client"]);

  // Judge rationale message with evidence (becomes an accepted judge.rationale).
  runJson([
    "blackboard", "message", "post", runId,
    "--topic", "rc-judge-verdicts",
    "--blackboard", "rc-blackboard",
    "--body", "Judge rationale: candidate is acceptable with explicit cited evidence.",
    "--authorKind", "role", "--authorId", "rc-judge-1",
    "--multi-agent-run", "rc-ma", "--role", "rc-judge-1",
    "--evidence", evidenceLocator, "--tag", "judge-rationale"
  ]);
  runJson(["blackboard", "artifact", "add", runId, "--topic", "rc-judge-verdicts", "--path", artifactPath, "--kind", "doc"]);

  // Workers report output (verified worker results become adopted evidence).
  for (const label of ["judge one", "judge two"]) {
    const dispatch = runJson(["multi-agent", "step", runId, "--sandbox", "readonly"]);
    const workerId = dispatch.data.tasks[0].workerId;
    const manifest = runJson(["worker", "manifest", runId, workerId]);
    writeWorkerResult(manifest.resultPath, label);
    runJson(["worker", "output", runId, workerId, manifest.resultPath]);
  }
  assert.equal(runJson(["multi-agent", "step", runId]).performed, "collected-fanin");
  assert.equal(runJson(["multi-agent", "step", runId]).performed, "created-blackboard-snapshot");
  assert.equal(runJson(["multi-agent", "step", runId, "--candidate", "rc-candidate"]).performed, "registered-candidate");

  const score = runJson([
    "multi-agent", "score", runId, "rc-candidate",
    "--role", "rc-judge-1", "--multi-agent-run", "rc-ma",
    "--criterion", "correctness=1", "--criterion", "evidence=1",
    "--evidence", evidenceLocator,
    "--rationale", "Judge accepts: worker and verifier evidence agree."
  ]);
  const selection = runJson([
    "multi-agent", "select", runId, "rc-candidate",
    "--role", "rc-panel-chair", "--multi-agent-run", "rc-ma",
    "--score", score.data.id, "--evidence", evidenceLocator,
    "--reason", "Panel selected the score-backed candidate with cited judge rationale."
  ]);
  const commit = runJson(["commit", runId, "--selection", selection.data.id, "--reason", "Evidence reasoning verifier-gated commit."]);
  assert.equal(commit.commit.verifierGated, true);

  // --- Reasoning report shape (the "why") ------------------------------------
  const absent = runJson(["multi-agent", "reasoning", runId, "--json"]);
  assert.equal(absent.runId, runId);
  assert.equal(absent.freshness.status, "absent", "freshness must be absent before refresh");
  assert.ok(absent.chains.length >= 1, "reasoning must produce chains");
  for (const chain of absent.chains) {
    assert.ok(["adopted", "rejected", "superseded", "conflicting", "pending", "missing", "unexplained"].includes(chain.evidenceStatus));
    assert.ok(["explained", "unexplained", "not-applicable"].includes(chain.rationaleStatus));
    for (const step of chain.steps) {
      assert.ok(["fanin", "candidate-score", "selection", "verifier", "commit"].includes(step.gate), `unexpected gate ${step.gate}`);
      assert.ok(step.basis && Array.isArray(step.basis.evidenceRefs) && Array.isArray(step.basis.auditEventIds), "step must carry basis");
      assert.ok(step.authority && typeof step.authority.actorKind === "string", "step must carry authority");
      assert.ok(step.rationale && ["explained", "unexplained", "not-applicable"].includes(step.rationale.status), "step must carry rationale status");
      // FAIL CLOSED, NEVER INFER: an unexplained step must not carry a fabricated reason.
      if (step.rationale.status === "unexplained") assert.equal(step.rationale.text, undefined, "unexplained step must not fabricate rationale text");
      assert.ok(Array.isArray(step.counterfactuals), "step must carry counterfactuals");
    }
  }

  // --- The committed path is fully explained with every gate ------------------
  const committed = absent.chains.find((chain) => chain.steps.some((step) => step.gate === "commit"));
  assert.ok(committed, "a committed reasoning chain must exist");
  assert.equal(committed.rationaleStatus, "explained", "committed chain must be explained");
  const committedGates = new Set(committed.steps.map((step) => step.gate));
  for (const gate of ["candidate-score", "selection", "commit", "verifier"]) {
    assert.ok(committedGates.has(gate), `committed chain missing ${gate} gate`);
  }
  const selectionStep = committed.steps.find((step) => step.gate === "selection");
  assert.equal(selectionStep.rationale.status, "explained");
  assert.match(selectionStep.rationale.text, /Panel selected/);
  assert.equal(selectionStep.authority.actorKind, "role");
  assert.ok(selectionStep.authority.policyRef, "selection authority must link a role policyRef");
  const scoreStep = committed.steps.find((step) => step.gate === "candidate-score");
  assert.equal(scoreStep.decision, "adopted");
  assert.match(scoreStep.rationale.text, /Judge accepts/);
  const verifierStep = committed.steps.find((step) => step.gate === "verifier");
  assert.equal(verifierStep.decision, "adopted");

  // --- Fail-closed unexplained surfaces (verified worker output, no decision) --
  assert.ok(absent.totals.unexplained >= 1, "at least one adoption must be unexplained (fail closed)");
  const unexplained = absent.chains.find((chain) => chain.rationaleStatus === "unexplained");
  assert.ok(unexplained.unexplainedReasons.length >= 1, "unexplained chain must record why it is unexplained");
  assert.equal(unexplained.evidenceStatus, "adopted", "this fail-closed case is an adopted-but-unexplained item");

  // --- evidence command carries additive rationaleStatus ----------------------
  const evidenceRows = runJson(["multi-agent", "evidence", runId, "--json"]);
  assert.ok(evidenceRows.every((row) => typeof row.rationaleStatus === "string"), "every evidence row must carry rationaleStatus");
  const evidenceText = runText(["multi-agent", "evidence", runId]);
  assert.match(evidenceText, /rationale=(explained|unexplained|not-applicable)/);

  // --- Refresh durable index + freshness becomes valid ------------------------
  const index = runJson(["multi-agent", "reasoning", runId, "--refresh"]);
  assert.equal(index.id, "evidence-reasoning-index");
  assert.ok(index.entries.length >= 1, "reasoning index must hold per-chain records");
  for (const entry of index.entries) assert.ok(fs.existsSync(entry.path), `reasoning record file missing: ${entry.path}`);
  const reasoningDir = index.paths.reasoningDir;
  assert.ok(fs.existsSync(path.join(reasoningDir, "index.json")));
  assert.ok(fs.existsSync(path.join(reasoningDir, "report.json")));
  const valid = runJson(["multi-agent", "reasoning", runId, "--json"]);
  assert.equal(valid.freshness.status, "valid", "freshness must be valid after refresh");
  assert.equal(valid.freshness.persistedFingerprint, valid.freshness.currentFingerprint);

  // --- Stale detection (fail closed) ------------------------------------------
  runJson(["blackboard", "message", "post", runId, "--topic", "rc-judge-verdicts", "--body", "Late-breaking message after refresh."]);
  const stale = runJson(["multi-agent", "reasoning", runId, "--json"]);
  assert.equal(stale.freshness.status, "stale", "reasoning must fail closed when source changed");
  runJson(["multi-agent", "reasoning", runId, "--refresh"]);
  assert.equal(runJson(["multi-agent", "reasoning", runId, "--json"]).freshness.status, "valid");

  // --- --evidence filter ------------------------------------------------------
  const single = runJson(["multi-agent", "reasoning", runId, "--evidence", committed.id, "--json"]);
  assert.equal(single.chains.length, 1);
  assert.equal(single.chains[0].id, committed.id);

  // --- Evidence/reasoning parity under compaction -----------------------------
  // Every decision-gate node backing an adopted chain must survive compaction.
  const compact = runJson(["multi-agent", "graph", runId, "--view", "compact", "--json"]);
  const compactIds = new Set(compact.nodes.map((n) => n.id));
  const adoptedGateNodes = [];
  for (const chain of valid.chains.filter((c) => c.evidenceStatus === "adopted")) {
    for (const recordId of chain.sourceRecordIds) {
      if (recordId.startsWith("score-")) adoptedGateNodes.push(`${runId}:score:${recordId}`);
    }
  }
  // The candidate-score node must never be collapsed into a synthetic node.
  const scoreNodeId = `${runId}:score:${score.data.id}`;
  assert.ok(compactIds.has(scoreNodeId), `reasoning score gate ${scoreNodeId} must survive compaction`);
  const selectionNodeId = `${runId}:selection:${selection.data.id}`;
  assert.ok(compactIds.has(selectionNodeId), `reasoning selection gate ${selectionNodeId} must survive compaction`);
  assert.ok(!compact.syntheticNodes.some((syn) => syn.sourceIds.includes(scoreNodeId)), "score reasoning gate must not be collapsed into a synthetic node");
  void adoptedGateNodes;

  // --- Human output stable panel ----------------------------------------------
  const human = runText(["multi-agent", "reasoning", runId]);
  assert.match(human, /Adoption Rationale/);
  assert.match(human, /Freshness: (valid|stale|absent)/);
  assert.match(human, /Next Action/);

  // --- CLI JSON determinism ---------------------------------------------------
  const a = stripVolatile(runJson(["multi-agent", "reasoning", runId, "--json"]));
  const b = stripVolatile(runJson(["multi-agent", "reasoning", runId, "--json"]));
  assert.deepEqual(a, b, "reasoning JSON must be deterministic");

  // --- Backward compatibility: a non-multi-agent run renders, no throw --------
  const plain = runJson(["plan", "end-to-end-golden-path", "--repo", tmp, "--question", "Prove backward compatibility."]);
  const plainReasoning = runJson(["multi-agent", "reasoning", plain.runId, "--json"]);
  assert.ok(Array.isArray(plainReasoning.chains), "reasoning must render for non-multi-agent runs");
  assert.equal(plainReasoning.freshness.status, "absent");

  // --- Eval / replay regression gates -----------------------------------------
  const snapshot = runJson(["eval", "snapshot", runId, "--id", "rc-suite", "--json"]);
  for (const section of ["reasoningFreshness", "reasoningChains", "reasoningUnexplained"]) {
    assert.ok(Array.isArray(snapshot.normalized[section]), `snapshot normalized missing ${section}`);
  }
  assert.ok(snapshot.normalized.reasoningUnexplained.length >= 1, "snapshot must capture unexplained chains");

  const replay = runJson(["eval", "replay", snapshot.paths.snapshotPath, "--id", "rc-suite-replay", "--json"]);
  const comparison = runJson(["eval", "compare", snapshot.paths.snapshotPath, replay.paths.replayRunPath, "--json"]);
  assert.equal(comparison.status, "pass");
  const scoreResult = runJson(["eval", "score", replay.paths.replayRunPath, "--json"]);
  assert.equal(scoreResult.status, "pass");
  for (const metric of ["reasoning_freshness", "reasoning_chain_parity", "reasoning_unexplained_parity"]) {
    assert.ok(scoreResult.metrics.some((entry) => entry.id === metric && entry.status === "pass"), `metric ${metric} must pass`);
  }
  const reportEval = runJson(["eval", "report", replay.paths.replayRunPath, "--json"]);
  assert.match(fs.readFileSync(reportEval.reportPath, "utf8"), /Evidence Adoption Reasoning Chain/);
  assert.equal(runJson(["eval", "gate", path.dirname(snapshot.paths.snapshotPath), "--json"]).status, "pass");

  // Release gate fails when a reasoning rationale is hidden/fabricated.
  const regressionPath = path.join(path.dirname(snapshot.paths.snapshotPath), "regressed-reasoning.json");
  const regressed = JSON.parse(fs.readFileSync(replay.paths.replayRunPath, "utf8"));
  regressed.id = "rc-suite-regressed";
  regressed.paths.replayRunPath = regressionPath;
  regressed.replay.reasoningUnexplained = [];
  regressed.replay.reasoningChains = ["{\"tampered\":true}"];
  fs.writeFileSync(regressionPath, `${JSON.stringify(regressed, null, 2)}\n`, "utf8");
  const regressedScore = runJson(["eval", "score", regressionPath, "--json"]);
  assert.equal(regressedScore.status, "fail", "hiding an unexplained rationale must fail the gate");
  assert.ok(regressedScore.metrics.some((m) => m.id === "reasoning_unexplained_parity" && m.status === "fail"));
  assert.ok(regressedScore.metrics.some((m) => m.id === "reasoning_chain_parity" && m.status === "fail"));
  // Restore a clean, passing gate.
  runJson(["eval", "compare", snapshot.paths.snapshotPath, replay.paths.replayRunPath, "--json"]);
  runJson(["eval", "score", replay.paths.replayRunPath, "--json"]);
  runJson(["eval", "gate", path.dirname(snapshot.paths.snapshotPath), "--json"]);

  // --- MCP parity -------------------------------------------------------------
  const mcp = await readMcp(runId);
  for (const name of ["cw_evidence_reasoning", "cw_evidence_reasoning_refresh"]) {
    assert.ok(mcp.tools.has(name), `missing MCP tool ${name}`);
  }
  assert.equal(mcp.reasoning.runId, runId);
  assert.ok(Array.isArray(mcp.reasoning.chains) && mcp.reasoning.chains.length >= 1);
  assert.equal(mcp.refresh.id, "evidence-reasoning-index");
  const cliNow = runJson(["multi-agent", "reasoning", runId, "--json"]);
  assert.deepEqual(
    stripVolatile(mcp.reasoning.totals),
    stripVolatile(cliNow.totals),
    "MCP reasoning totals must match CLI"
  );

  process.stdout.write("evidence-adoption-reasoning-smoke: ok\n");
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
      "Evidence reasoning worker output.",
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

function readMcp(runId) {
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
        tool("cw_evidence_reasoning", { cwd: tmp, runId }),
        tool("cw_evidence_reasoning_refresh", { cwd: tmp, runId })
      ]).then(([reasoning, refresh]) => ({
        tools: new Set(listed.tools.map((entry) => entry.name)),
        reasoning,
        refresh
      }))
    )
    .finally(() => server.kill());
}

void runFail;
