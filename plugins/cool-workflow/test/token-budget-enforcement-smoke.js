#!/usr/bin/env node
"use strict";

// @cw-smoke: tags slow
// token-budget-enforcement-smoke (Track 3) — `limits.tokenBudget` is ENFORCED by
// the drive loop against RECORDED usage (the same deriveUsageTotals aggregation
// MetricsReport shows; CW never measures usage itself). Proves:
//   1. a run whose recorded spend reaches the budget BLOCKS before the next
//      agent spawn (action "blocked", reason names the spend and the budget) —
//      it does NOT park (the task isn't bad; the run is out of budget) and the
//      already-accepted hop's result stays recorded;
//   2. an ample budget changes nothing — the same workflow drives to completion
//      (the gate blocks overspend, never real work);
//   3. no budget declared ⇒ no gate (backward compatible, opt-in by declaration).
//
// Hermetic: the stub agent reports usage (4 in + 2 out = 6 tokens/hop) on stdout
// exactly like a real `claude -p` hop; no live agent, no network.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const cwd0 = process.cwd();
const cleanups = [];

function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-budget-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}

// A stub agent that writes a valid result.md and reports usage: 6 tokens/hop.
function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub-m", usage: { input_tokens: 4, output_tokens: 2 } }));'
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function setTokenBudget(run, budget) {
  const state = JSON.parse(fs.readFileSync(run.paths.state, "utf8"));
  state.workflow.limits.tokenBudget = budget;
  // Budget tests rely on sequential execution to observe mid-run blocking.
  // With parallel phases, concurrent dispatch would complete all Map tasks
  // before the budget gate fires — collapse to 1-wide for this test.
  state.workflow.limits.maxConcurrentAgents = 1;
  fs.writeFileSync(run.paths.state, JSON.stringify(state, null, 2), "utf8");
}

function agentConfig(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag" };
}

function main() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];

  // ---- 1. budget exhausts mid-run -> blocked before the NEXT spawn ----------
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"));
    process.chdir(work);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: work, question: "q" });
      assert.ok(run.tasks.length >= 2, `needs >=2 planned tasks to observe the mid-run gate (got ${run.tasks.length})`);
      // Budget 1: hop 1 proceeds (spent 0 < 1), records 6 tokens; the gate must
      // then refuse hop 2 (6 >= 1).
      setTokenBudget(run, 1);
      const result = drive(runner, run.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });

      assert.equal(result.status, "blocked", "budget exhaustion blocks the drive");
      assert.equal(result.completedWorkers, 1, "exactly the pre-budget hop completed");
      assert.equal(result.parkedWorkers, 0, "budget exhaustion parks NOTHING (blocked, not parked)");
      const last = result.steps[result.steps.length - 1];
      assert.equal(last.action, "blocked", "last step action is blocked");
      assert.match(last.reason || "", /token budget exhausted: 6 recorded tokens >= budget 1/, "reason names spend and budget");
      assert.ok(last.taskId, "blocked step names the task it refused to spawn");

      // The accepted hop's result stays recorded (the gate never claws back work).
      const reloaded = runner.loadRun(run.id);
      const completed = reloaded.tasks.filter((t) => t.status === "completed");
      assert.equal(completed.length, 1, "the accepted result is still recorded");
      console.log("token-budget: exhaustion blocks before the next spawn ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 2. ample budget -> drives to completion (gate never blocks real work) -
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"));
    process.chdir(work);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: work, question: "q" });
      setTokenBudget(run, 1_000_000);
      const result = drive(runner, run.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "complete", "ample budget completes");
      assert.equal(result.completedWorkers, result.plannedWorkers, "every planned worker driven under ample budget");
      console.log("token-budget: ample budget never blocks real work ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 3. no budget declared -> no gate (backward compatible) ---------------
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"));
    process.chdir(work);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: work, question: "q" });
      assert.equal(run.workflow.limits.tokenBudget, undefined, "bundled app declares no tokenBudget (precondition)");
      const result = drive(runner, run.id, { now: FIXED_NOW, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "complete", "no declared budget ⇒ no enforcement");
      console.log("token-budget: absent budget is a no-op ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  console.log("token-budget-enforcement-smoke: ok (exhaustion blocks pre-spawn; ample/absent budgets unaffected)");
}

main();
