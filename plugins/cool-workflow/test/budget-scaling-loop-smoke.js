#!/usr/bin/env node
"use strict";

// @cw-smoke: timeout 120
// budget-scaling-loop-smoke — the CI gate for budget-aware scaling (#3).
//
// A loop() phase with until:{kind:"budget-target", target} keeps spawning rounds while
// RECORDED usage stays under the target — turning the fail-closed token-budget CAP into
// adaptive depth. The CAP (limits.tokenBudget) stays the absolute backstop. A hermetic
// stub reports 6 tokens/hop. Proves:
//   1. SCALE TO TARGET: target 18, 6 tokens/hop ⇒ exactly 3 rounds (6,12,18 reaches the
//      target; round 4 is not spawned), run completes.
//   2. CAP IS THE BACKSTOP: with limits.tokenBudget:12 ALSO set, the cap fires first —
//      the run BLOCKS after 2 rounds (spent 12 >= budget 12), before the loop target is
//      reached. The cap can never be overshot.
//
// ===================================================================================
// AUDIT STATUS: REAL-GAP (imports repointed to v2; behavior itself is missing).
// -----------------------------------------------------------------------------------
// The imports below are the correct v2 locations and the run drives cleanly, so the
// failure is NOT an import crash — it lands on genuine v2 behavior. But v2 never
// spawns loop rounds: test 1 gets 1 round (spawnCount 1 != 3), status "complete".
//
// Root cause: v2's imperative shell driver src/shell/drive.ts (dist/shell/drive.js)
// imports ONLY `maxLoopExpansion` from core/pipeline/loop-expansion (drive.ts:46). The
// three functions that actually re-spawn a loop round —
//   evaluateLoopStop      (src/core/pipeline/loop-expansion.ts:80)
//   cloneLoopRoundTasks   (src/core/pipeline/loop-expansion.ts:108)
//   loopControlNodeId     (src/core/pipeline/loop-expansion.ts:142)
// are fully implemented in the PURE decision core but are DEAD CODE: grep of src/
// finds ZERO callers. The module header says materializing the cloned round is
// "the caller's job in shell/", but shell/drive.ts never wired it in. So a loop()
// phase executes exactly one round and completes; budget-target scaling, the
// maxRounds cap, and loop-control nodes never fire. (Same gap fails the sibling
// loop-bounded-expansion-smoke.) The old build did this in
// orchestrator/lifecycle-operations.ts's maybeExpandLoop, called from its driver.
// Phase B must call evaluateLoopStop + cloneLoopRoundTasks from shell/drive.ts.
// ===================================================================================

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
// v2 dismantled the CoolWorkflowRunner facade. The old build's
// runner.plan(appId, inputs) + drive(runner, runId, opts) split into free
// functions: shell/workflow-app-loader.loadWorkflowApp(appId) resolves the app
// dir (via the CW_APPS_DIR env override — the v2 replacement for the old
// runner.appsDir instance field), shell/pipeline.plan(loadedApp, inputs) makes
// the run, and shell/drive.drive(runId, cwd, opts) drives it.
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));

const FIXED_NOW = "2026-06-20T00:00:00.000Z";
const cleanups = [];

function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(d);
  return d;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_APPS_DIR"]) delete process.env[v];
}
function writeStub(file, countFile) {
  fs.writeFileSync(file, [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    `fs.appendFileSync(${JSON.stringify(countFile)}, "x");`,
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 4, output_tokens: 2 } }));' // 6 tokens/hop
  ].join("\n"), "utf8");
  return file;
}
function agentConfig(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "op", source: "flag" };
}
function writeBudgetLoopApp(appsDir, id, target, tokenBudget) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify({
    schemaVersion: 1, id, title: id, summary: id, version: "0.1.0", author: "test",
    inputs: [{ name: "question", type: "string" }],
    sandboxProfiles: ["readonly"],
    compatibility: { minVersion: "0.1.9" },
    workflow: { entrypoint: "workflow.js" }
  }, null, 2));
  const limits = tokenBudget
    ? `{ maxAgents: 20, maxConcurrentAgents: 1, tokenBudget: ${tokenBudget} }`
    : `{ maxAgents: 20, maxConcurrentAgents: 1 }`;
  fs.writeFileSync(path.join(dir, "workflow.js"), `module.exports = ({ workflow, loop, agent, input }) => workflow({
  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},
  limits: ${limits},
  inputs: [input("question", { type: "string" })],
  sandboxProfiles: ["readonly"],
  phases: [
    loop("Scale", [ agent("scale:do", "Work on {{question}}", { sandboxProfileId: "readonly" }) ],
      { maxRounds: 8, until: { kind: "budget-target", target: ${target} } })
  ]
});\n`);
}
// v2: point the app loader at the fixture apps tree via CW_APPS_DIR (the
// replacement for the old runner.appsDir field), then load + plan the app.
function planApp(appsDir, id, inputs) {
  process.env.CW_APPS_DIR = appsDir;
  return plan(loadWorkflowApp(id), inputs);
}
function spawnCount(f) {
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").length : 0;
}

function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();

  // ===== 1: scale to the budget target (3 rounds for target 18, 6 tokens/hop) =======
  {
    const appsDir = tmp("cw-budget-apps-");
    const work = tmp("cw-budget-work-");
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const countFile = path.join(work, "spawns.count");
    const stub = writeStub(path.join(work, "stub.js"), countFile);
    writeBudgetLoopApp(appsDir, "budget-scale", 18, null);
    process.chdir(work);
    try {
      const r = planApp(appsDir, "budget-scale", { repo: work, question: "Q?" });
      const result = drive(r.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "complete", "budget-target loop completes");
      assert.equal(spawnCount(countFile), 3, "scaled to exactly 3 rounds (6,12,18 reaches target 18; round 4 not spawned)");
      console.log("budget-scaling: scale-to-target ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 2: the fail-closed CAP stays the absolute backstop =========================
  {
    const appsDir = tmp("cw-budgetcap-apps-");
    const work = tmp("cw-budgetcap-work-");
    fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
    const countFile = path.join(work, "spawns.count");
    const stub = writeStub(path.join(work, "stub.js"), countFile);
    // target 18 wants 3 rounds, but the cap (tokenBudget 12) fires first.
    writeBudgetLoopApp(appsDir, "budget-capped", 18, 12);
    process.chdir(work);
    try {
      const r = planApp(appsDir, "budget-capped", { repo: work, question: "Q?" });
      const result = drive(r.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "blocked", "the fail-closed token-budget cap fires before the loop target — the run blocks");
      assert.equal(spawnCount(countFile), 2, "the cap stops spawning at 2 rounds (spent 12 >= budget 12); the cap can never be overshot");
      console.log("budget-scaling: cap-is-the-backstop ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  console.log("budget-scaling-loop-smoke: ok");
}

main();
