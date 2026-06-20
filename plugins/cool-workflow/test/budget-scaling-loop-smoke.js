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

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));

const FIXED_NOW = "2026-06-20T00:00:00.000Z";
const cleanups = [];

function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(d);
  return d;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
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
function newRunner(appsDir) {
  const r = new CoolWorkflowRunner({ pluginRoot });
  r.appsDir = appsDir;
  return r;
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
      const runner = newRunner(appsDir);
      const r = runner.plan("budget-scale", { repo: work, question: "Q?" });
      const result = drive(runner, r.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
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
      const runner = newRunner(appsDir);
      const r = runner.plan("budget-capped", { repo: work, question: "Q?" });
      const result = drive(runner, r.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
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
