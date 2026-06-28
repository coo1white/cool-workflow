#!/usr/bin/env node
"use strict";
// @cw-smoke: tags slow
// concurrent-workflow-dsl-smoke — Phase 0 of the Workflow-tool DSL migration.
//
// Proves three additive capabilities, each with teeth, WITHOUT crossing CW's red
// line (every agent is still an out-of-process delegation; CW imports no model SDK):
//
//   1. DSL VENEER: createWorkflowApi() exposes parallel() (a phase whose tasks the
//      concurrent driver batches) and agent() carries schema/model/agentType/label.
//      Plain phase() stays sequential (mode undefined) so existing apps are intact.
//   2. CONCURRENT DRIVER: driveConcurrentRound() fulfills MULTIPLE ready tasks of a
//      phase in ONE round (vs driveStep()'s exactly one), recording in DETERMINISTIC
//      task order; a full concurrent drive still reaches the SAME complete outcome.
//   3. TELEMETRY THREAD-BACK: the agent's self-reported token usage (parsed from its
//      stdout) is now captured on the recorded handle's metadata.reportedUsage —
//      attested, never measured by CW.
//
// Node-only, deterministic (now injected, stub agent). Mirrors the harness of
// agent-delegation-drive-smoke.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive, driveStep, driveConcurrentRound } = require(path.join(pluginRoot, "dist/drive.js"));
const { createWorkflowApi } = require(path.join(pluginRoot, "dist/workflow-api.js"));
const { DEFAULT_SCHEDULING_POLICY, normalizeSchedulingPolicy } = require(path.join(pluginRoot, "dist/scheduling.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const STUB_USAGE = { input_tokens: 4, output_tokens: 2 };
const cleanups = [];

function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-cdsl-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}
// A happy-path stub agent that writes a valid cw:result envelope and reports its
// own model + token usage on stdout (argv[2] = resultPath).
function writeStub(file, model) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    `process.stdout.write(JSON.stringify({ model: ${JSON.stringify(model)}, usage: ${JSON.stringify(STUB_USAGE)} }));`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}
function agentConfig(stub) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "operator-pick", source: "flag" };
}
function makeCtx(runner, runId, stub) {
  return {
    runner,
    runId,
    now: FIXED_NOW,
    policy: normalizeSchedulingPolicy(DEFAULT_SCHEDULING_POLICY),
    config: agentConfig(stub),
    attempts: new Map()
  };
}

function main() {
  clearAgentEnv();

  // ---- 1. DSL VENEER (pure, no I/O) ----------------------------------------
  const api = createWorkflowApi();
  assert.equal(typeof api.parallel, "function", "createWorkflowApi exposes parallel()");

  const par = api.parallel("Map", [api.agent("a", "pa"), api.agent("b", "pb"), api.agent("c", "pc")]);
  assert.equal(par.mode, "parallel", "parallel() marks the phase mode parallel");
  assert.equal(par.tasks.length, 3, "parallel() carries its tasks");

  const seq = api.phase("Solo", [api.agent("d", "pd")]);
  assert.equal(seq.mode, undefined, "plain phase() stays sequential (existing apps unaffected)");

  const ag = api.agent("x", "px", { schema: { type: "object" }, model: "claude-x", agentType: "agent", label: "Reviewer" });
  assert.deepEqual(ag.schema, { type: "object" }, "agent() carries the output schema");
  assert.equal(ag.model, "claude-x", "agent() carries model");
  assert.equal(ag.agentType, "agent", "agent() carries agentType");
  assert.equal(ag.label, "Reviewer", "agent() carries label");

  const cwd0 = process.cwd();

  // ---- 2. CONCURRENT DRIVER: one round fulfills a multi-task phase ----------
  // architecture-review's first phase (Map) has 6 ready tasks. driveConcurrentRound
  // must fulfill several in ONE round, in deterministic phase order; driveStep must
  // fulfill exactly one. That contrast IS the batching proof.
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"), "round-opus");
    process.chdir(work);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });

      // Concurrent round of width 4 on a fresh plan.
      const runC = runner.plan("architecture-review", { repo: work, question: "Sound?" });
      const firstPhaseId = runC.tasks[0].phase;
      const phaseOrder = runC.tasks.filter((t) => t.phase === firstPhaseId).map((t) => t.id);
      assert.ok(phaseOrder.length >= 4, "first phase has >=4 ready tasks (precondition for the batch test)");

      const round = driveConcurrentRound(makeCtx(runner, runC.id, stub), 4);
      const accepts = round.filter((s) => s.action === "accept" && s.status === "ok");
      assert.ok(accepts.length >= 2, `one concurrent round fulfills MULTIPLE ready tasks, got ${accepts.length}`);
      assert.equal(new Set(accepts.map((s) => s.taskId)).size, accepts.length, "each accept is a distinct task");
      assert.deepEqual(
        accepts.map((s) => s.taskId),
        phaseOrder.slice(0, accepts.length),
        "the round records tasks in DETERMINISTIC planned phase order"
      );

      // Serial contrast on its own fresh plan: exactly one task fulfilled per step.
      const runS = runner.plan("architecture-review", { repo: work, question: "Sound?" });
      const single = driveStep(makeCtx(runner, runS.id, stub));
      assert.equal(single.action, "accept", "serial driveStep fulfills a task");
      assert.equal(single.taskId, phaseOrder[0], "serial step takes the first phase task — concurrent round took several");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 3. FULL CONCURRENT DRIVE: same complete outcome + telemetry captured -
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"), "drive-opus");
    process.chdir(work);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: work, question: "Sound?" });
      const planned = run.tasks.length;

      const result = drive(runner, run.id, { now: FIXED_NOW, concurrency: 6, agentConfig: agentConfig(stub) });
      assert.equal(result.status, "complete", "concurrent drive reaches the SAME complete outcome as serial");
      assert.equal(result.completedWorkers, planned, "every planned worker driven under concurrency");
      assert.ok(result.commitId, "concurrent drive commits the audited verdict");

      const final = runner.loadRun(run.id);
      assert.ok(final.tasks.every((t) => t.status === "completed"), "all tasks completed");

      // TELEMETRY: every delegated worker's recorded handle carries the agent's own
      // attested token usage — captured now, dropped before.
      const resultNodes = final.nodes.filter((n) => n.kind === "result");
      assert.equal(resultNodes.length, planned, "one result node per worker");
      for (const n of resultNodes) {
        const handle = n.metadata && n.metadata.agentDelegation && n.metadata.agentDelegation.handle;
        assert.ok(handle, `result node carries the delegation handle: ${n.id}`);
        assert.deepEqual(
          handle.metadata && handle.metadata.reportedUsage,
          STUB_USAGE,
          `result node ${n.id} captures the agent's attested token usage`
        );
        // Red line: usage/model are PROVENANCE, never in the byte-stable evidence.
        assert.ok(!JSON.stringify(n.evidence).includes("input_tokens"), "usage absent from evidence (red line)");
      }
    } finally {
      process.chdir(cwd0);
    }
  }

  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write("concurrent-workflow-dsl-smoke: ok (DSL veneer, concurrent batch driver, deterministic order, telemetry thread-back)\n");
}

main();
