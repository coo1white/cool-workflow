#!/usr/bin/env node
"use strict";

// parallel-onramp-smoke — parallel() works through the REAL command surface.
//
// The v0.1.77 release review rejected the previous state: parallel() set
// phase.mode, but no shipping surface ever passed options.concurrency, so a
// real `cw run --drive` user got fully SEQUENTIAL execution (a latent public
// false-green), and the task-level label/model/agentType fields had no runtime
// reader. This smoke pins the fixes, driving through capability-core's runDrive
// (the exact function `cw run --drive` / quickstart call — NOT a direct
// drive(..., {concurrency}) call):
//   1. a parallel() phase authored via the real DSL is fulfilled CONCURRENTLY
//      with no flag: wall-clock far below the serial floor, width derived from
//      phase.mode bounded by limits.maxConcurrentAgents;
//   2. task.model overrides the agent-config model for THAT task's delegation —
//      the {{model}} substitution reaches the spawned argv (observed from the
//      stub's own report), while tasks without it use the config model;
//   3. task.label and task.agentType are carried onto the run state (label
//      feeds drive progress display; agentType selects the dispatch backend —
//      asserted via the dispatched worker's backend);
//   4. a plain phase() (no mode) through the same surface stays sequential —
//      existing apps see zero behavior change.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const lifecycle = require(path.join(pluginRoot, "dist/orchestrator/lifecycle-operations.js"));
const { runDrive } = require(path.join(pluginRoot, "dist/capability-core.js"));
const api = require(path.join(pluginRoot, "dist/workflow-api.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const cwd0 = process.cwd();

const N = 6;
const STUB_MS = 2000;
// Serial floor: 6 stubs x 2s = 12s of stub time alone (plus ~0.5s/task accept
// overhead). Concurrent: max(stub) + overhead ≈ 5s. 10s splits them with CI
// headroom on both sides.
const PARALLEL_WALL_MS = 10000;

// Stub agent: argv[2] = resultPath, argv[3] = the substituted {{model}}. Sleeps
// STUB_MS, writes a valid result, and reports the model it was INVOKED with —
// so the smoke can observe which model actually reached the spawn.
function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const invokedModel = process.argv[3] || "none";',
    "setTimeout(() => {",
    '  const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "ok", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "  fs.writeFileSync(rp, body);",
    '  process.stdout.write(JSON.stringify({ model: invokedModel, usage: { input_tokens: 4, output_tokens: 2 } }));',
    "  process.exit(0);",
    `}, ${STUB_MS});`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function planParallelApp(work) {
  const tasks = [];
  for (let i = 1; i <= N; i++) {
    tasks.push(
      api.agent(`map:p${i}`, `Probe ${i}.`, {
        label: `Prober ${i}`,
        agentType: "agent",
        // Task 1 carries its OWN model; the rest inherit the config model.
        ...(i === 1 ? { model: "task-pick-m" } : {})
      })
    );
  }
  const def = api.workflow({
    id: "parallel-onramp",
    title: "parallel() on-ramp",
    limits: { maxAgents: N, maxConcurrentAgents: N },
    inputs: [{ name: "repo", type: "path", required: true }],
    phases: [api.parallel("Fan", tasks)]
  });
  return lifecycle.plan(
    { app: { schemaVersion: 1, id: def.id, title: def.title, version: "0.0.1", workflow: def }, source: { kind: "manifest", path: path.join(work, "app.json"), manifestPath: path.join(work, "app.json") } },
    { repo: work }
  );
}

function main() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-onramp-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  const agentCommand = `${process.execPath} ${stub} {{result}} {{model}}`;
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });

    // ---- 1+2+3: parallel() via the REAL runDrive surface, no concurrency flag
    {
      const run = planParallelApp(work);
      assert.equal(run.phases[0].mode, "parallel", "plan carries phase.mode onto the run state");
      assert.equal(run.tasks[0].label, "Prober 1", "plan carries task.label");
      assert.equal(run.tasks[0].model, "task-pick-m", "plan carries task.model");
      assert.equal(run.tasks[0].agentType, "agent", "plan carries task.agentType");

      const started = Date.now();
      const result = runDrive(runner, { run: run.id, now: FIXED_NOW, "agent-command": agentCommand, "agent-model": "config-m" });
      const elapsed = Date.now() - started;

      assert.equal(result.status, "complete", "parallel run drives to completion through runDrive");
      assert.equal(result.completedWorkers, N, "every parallel worker fulfilled");
      assert.ok(elapsed < PARALLEL_WALL_MS, `parallel() parallelizes through the real surface: ${elapsed}ms (< ${PARALLEL_WALL_MS}ms; serial floor ~${N * STUB_MS}ms of stub time)`);
      console.log(`parallel-onramp: runDrive fulfilled ${N} agents concurrently in ${elapsed}ms ok`);

      // {{model}} reached the spawn: task 1 was invoked with ITS model, the
      // rest with the config model (the stub reports what it received).
      const reloaded = runner.loadRun(run.id);
      const reportedModelOf = (taskId) => {
        const worker = (reloaded.workers || []).find((w) => w.taskId === taskId && w.output);
        return worker && worker.usage && worker.usage.model;
      };
      assert.equal(reportedModelOf("map:p1"), "task-pick-m", "task.model overrode the delegation for its task");
      assert.equal(reportedModelOf("map:p2"), "config-m", "tasks without task.model use the config model");
      console.log("parallel-onramp: task.model override reaches the spawned argv ok");

      // agentType selected the dispatch backend (recorded on the dispatch).
      const backendIds = (reloaded.dispatches || []).map((d) => d.backendId).filter(Boolean);
      assert.ok(backendIds.length > 0 && backendIds.every((b) => b === "agent"), "dispatch honored task.agentType");
      console.log("parallel-onramp: label/agentType carried + honored ok");
    }

    // ---- 4: plain phase() stays sequential through the same surface ---------
    {
      const tasks = [api.agent("map:s1", "One."), api.agent("map:s2", "Two.")];
      const def = api.workflow({
        id: "sequential-control",
        title: "sequential control",
        limits: { maxAgents: 2, maxConcurrentAgents: 4 },
        inputs: [{ name: "repo", type: "path", required: true }],
        phases: [api.phase("Seq", tasks)]
      });
      const run = lifecycle.plan(
        { app: { schemaVersion: 1, id: def.id, title: def.title, version: "0.0.1", workflow: def }, source: { kind: "manifest", path: path.join(work, "app2.json"), manifestPath: path.join(work, "app2.json") } },
        { repo: work }
      );
      assert.equal(run.phases[0].mode, undefined, "plain phase() carries no mode");
      const started = Date.now();
      const result = runDrive(runner, { run: run.id, now: FIXED_NOW, "agent-command": agentCommand });
      const elapsed = Date.now() - started;
      assert.equal(result.status, "complete", "sequential run completes");
      assert.ok(elapsed >= 2 * STUB_MS, `plain phase() stays sequential (${elapsed}ms >= ${2 * STUB_MS}ms)`);
      console.log(`parallel-onramp: plain phase() unchanged (sequential, ${elapsed}ms) ok`);
    }
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log("parallel-onramp-smoke: ok (parallel() parallelizes via runDrive; model/label/agentType load-bearing; sequential unchanged)");
}

main();
