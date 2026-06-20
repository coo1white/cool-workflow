#!/usr/bin/env node
"use strict";

// incremental-resume-smoke — the CI gate for `cw run --drive --incremental` (#4).
//
// Hermetic: a STUB agent (a tiny node child that APPENDS to a spawn-count file on
// every invocation) stands in for `claude -p`. No live agent, no network, no model
// SDK. The stub's result bytes are deterministic given the same cwd, so a cached
// result replays byte-identically.
//
// Proves the incremental-resume guarantee end to end:
//   1. REUSE across runs — drive a workflow twice with --incremental + identical
//      inputs: run 1 spawns N agents and populates the content-addressed cache; run
//      2 spawns ZERO (every accept is a `result-cache` hit) and completes.
//   2. BYTE-IDENTITY — run 2's reused result bytes equal run 1's.
//   3. POLA — a NON-incremental drive of the same inputs re-runs every task (the
//      opt-in cache is inert for these tasks), so default behavior is unchanged.
//   4. PER-TASK granularity — delete ONE task's cache entry; an incremental re-run
//      re-runs exactly that task and reuses the rest.
//   5. DOWNSTREAM INVALIDATION (the "longest unchanged prefix" property) — change a
//      first-phase (Map) result; an incremental re-run still REUSES every Map task
//      (their key has no upstream) but RE-RUNS every later-phase task (their key
//      folds the upstream result digest, which moved). This is why the key folds
//      upstream RESULT bytes, not just prompts.
//   6. DETERMINISM — the cache key is built from prompt + run.inputs + upstream
//      result digests only (no clock/random), so the same inputs hit on replay.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const { safeFileName } = require(path.join(pluginRoot, "dist/state.js"));

const FIXED_NOW = "2026-06-20T00:00:00.000Z";
const cleanups = [];

function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-incr-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}

// Stub agent: argv[2] = resultPath. Appends one byte to countFile per spawn, then
// writes a deterministic, valid cw:result envelope (evidence grounds in README).
function writeCountingStub(file, countFile) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    `fs.appendFileSync(${JSON.stringify(countFile)}, "x");`,
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub section", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 4, output_tokens: 2 } }));'
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}
function spawnCount(countFile) {
  return fs.existsSync(countFile) ? fs.readFileSync(countFile, "utf8").length : 0;
}
function agentConfig(stub, model) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: model || "op", source: "flag" };
}
function cacheDir(work) {
  const root = path.join(work, ".cw", "cache", "worker-results");
  if (!fs.existsSync(root)) return undefined;
  const sub = fs.readdirSync(root)[0];
  return sub ? path.join(root, sub) : undefined;
}
function cacheHits(result) {
  return result.steps.filter((s) => s.action === "accept" && s.handleKind === "result-cache");
}

function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();

  // ===== 1+2+3+6: REUSE across runs, byte-identity, POLA, determinism ==========
  const workA = tmpWorkspace();
  const countA = path.join(workA, "spawns.count");
  const stubA = writeCountingStub(path.join(workA, "stub.js"), countA);
  process.chdir(workA);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });

    // --- run 1: --incremental, populates the cache ---
    const r1 = runner.plan("architecture-review", { repo: workA, question: "Sound?" });
    const planned = r1.tasks.length;
    const d1 = drive(runner, r1.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubA) });
    assert.equal(d1.status, "complete", "run 1 completes");
    assert.equal(spawnCount(countA), planned, "run 1 spawns one agent per task");
    assert.equal(cacheHits(d1).length, 0, "run 1 has no cache hits (cold cache)");
    const r1Final = runner.loadRun(r1.id);
    const r1Verdict = r1Final.tasks.find((t) => /^verdict[:/]/i.test(t.id));
    const r1VerdictBytes = fs.readFileSync(r1Verdict.resultPath, "utf8");

    // --- run 2: --incremental, identical inputs ⇒ EVERY task is a cache hit ---
    const r2 = runner.plan("architecture-review", { repo: workA, question: "Sound?" });
    const before2 = spawnCount(countA);
    const d2 = drive(runner, r2.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubA) });
    assert.equal(d2.status, "complete", "run 2 completes");
    assert.equal(spawnCount(countA), before2, "run 2 spawns ZERO new agents (full reuse)");
    assert.equal(cacheHits(d2).length, planned, "run 2: every task accepted from the result cache");
    const r2Final = runner.loadRun(r2.id);
    const r2Verdict = r2Final.tasks.find((t) => /^verdict[:/]/i.test(t.id));
    assert.equal(fs.readFileSync(r2Verdict.resultPath, "utf8"), r1VerdictBytes, "reused result bytes are byte-identical to run 1");

    // --- run 3: NO --incremental, same inputs ⇒ full re-run (POLA) ---
    const r3 = runner.plan("architecture-review", { repo: workA, question: "Sound?" });
    const before3 = spawnCount(countA);
    const d3 = drive(runner, r3.id, { now: FIXED_NOW, agentConfig: agentConfig(stubA) });
    assert.equal(d3.status, "complete", "run 3 completes");
    assert.equal(spawnCount(countA), before3 + planned, "non-incremental run re-runs every task (no reuse) — POLA");
    assert.equal(cacheHits(d3).length, 0, "non-incremental run has no cache hits");
    console.log(`incremental-resume: reuse + byte-identity + POLA ok (${planned} tasks)`);
  } finally {
    process.chdir(cwd0);
  }

  // ===== 4: PER-TASK granularity — one missing entry re-runs ONLY that task ====
  {
    const workB = tmpWorkspace();
    const countB = path.join(workB, "spawns.count");
    const stubB = writeCountingStub(path.join(workB, "stub.js"), countB);
    process.chdir(workB);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const p1 = runner.plan("architecture-review", { repo: workB, question: "Q?" });
      const planned = p1.tasks.length;
      drive(runner, p1.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubB) });
      assert.equal(spawnCount(countB), planned, "populate cache");

      // Delete ONE last-phase (Verdict) cache entry; re-run incremental.
      const dir = cacheDir(workB);
      const verdictTask = p1.tasks.find((t) => /^verdict[:/]/i.test(t.id));
      const files = fs.readdirSync(dir);
      const verdictFile = files.find((f) => f.startsWith(`${safeFileName(verdictTask.id)}-`));
      assert.ok(verdictFile, `found the verdict task's cache file: ${verdictTask.id}`);
      fs.rmSync(path.join(dir, verdictFile));

      const p2 = runner.plan("architecture-review", { repo: workB, question: "Q?" });
      const before = spawnCount(countB);
      const d = drive(runner, p2.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubB) });
      assert.equal(d.status, "complete");
      assert.equal(spawnCount(countB), before + 1, "exactly the one task whose cache entry was removed re-runs");
      assert.equal(cacheHits(d).length, planned - 1, "every other task is still a cache hit");
      console.log("incremental-resume: per-task granularity ok (1 re-run, rest reused)");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 5: DOWNSTREAM INVALIDATION — change a Map result, later phases re-run ==
  {
    const workC = tmpWorkspace();
    const countC = path.join(workC, "spawns.count");
    const stubC = writeCountingStub(path.join(workC, "stub.js"), countC);
    process.chdir(workC);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const p1 = runner.plan("architecture-review", { repo: workC, question: "Q?" });
      const planned = p1.tasks.length;
      const mapPhase = p1.phases[0];
      const mapTaskIds = new Set(mapPhase.taskIds);
      drive(runner, p1.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubC) });
      assert.equal(spawnCount(countC), planned, "populate cache");

      // Rewrite ONE Map task's cached result to DIFFERENT (still valid) bytes — i.e.
      // simulate that upstream task producing a different finding. Its own key (no
      // upstream) is unchanged, so it still HITS; but every later-phase task folds
      // the Map result digest, which now moves ⇒ they must re-run.
      const dir = cacheDir(workC);
      const aMapTask = p1.tasks.find((t) => mapTaskIds.has(t.id));
      const files = fs.readdirSync(dir);
      const mapFile = files.find((f) => f.startsWith(`${safeFileName(aMapTask.id)}-`));
      assert.ok(mapFile, `found a Map task cache file: ${aMapTask.id}`);
      const fence = "`".repeat(3);
      const edited = "# R\n\n" + fence + "cw:result\n" + JSON.stringify({ summary: "EDITED upstream finding", findings: [], evidence: [workC + "/README.md:1"] }) + "\n" + fence + "\n";
      fs.writeFileSync(path.join(dir, mapFile), edited, "utf8");

      const p2 = runner.plan("architecture-review", { repo: workC, question: "Q?" });
      const before = spawnCount(countC);
      const d = drive(runner, p2.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubC) });
      assert.equal(d.status, "complete", "downstream-invalidation run completes");
      // Every Map task is reused (key has no upstream); only Map tasks are reused.
      const hitTaskIds = new Set(cacheHits(d).map((s) => s.taskId));
      for (const id of mapTaskIds) assert.ok(hitTaskIds.has(id), `Map task reused (unchanged prefix): ${id}`);
      assert.equal(cacheHits(d).length, mapTaskIds.size, "ONLY the first-phase prefix is reused");
      assert.equal(spawnCount(countC), before + (planned - mapTaskIds.size), "every later-phase task re-runs (upstream result moved)");
      console.log(`incremental-resume: downstream invalidation ok (prefix ${mapTaskIds.size} reused, ${planned - mapTaskIds.size} re-ran)`);
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 6: MODEL SWAP — changing the resolved model invalidates (no false reuse) =
  // The result-determining delegation config (model/backend/sandbox) is NOT carried
  // by the prompt or run.inputs, so it must be folded into the key — else swapping
  // the model would replay the OLD model's output and attest the wrong model.
  {
    const workD = tmpWorkspace();
    const countD = path.join(workD, "spawns.count");
    const stubD = writeCountingStub(path.join(workD, "stub.js"), countD);
    process.chdir(workD);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const p1 = runner.plan("architecture-review", { repo: workD, question: "Q?" });
      const planned = p1.tasks.length;
      drive(runner, p1.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubD, "model-a") });
      assert.equal(spawnCount(countD), planned, "populate cache under model-a");

      // Same app + inputs, DIFFERENT resolved model ⇒ every key differs ⇒ full re-run.
      const p2 = runner.plan("architecture-review", { repo: workD, question: "Q?" });
      const before = spawnCount(countD);
      const d = drive(runner, p2.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stubD, "model-b") });
      assert.equal(d.status, "complete");
      assert.equal(cacheHits(d).length, 0, "changing the model invalidates EVERY entry (no false reuse)");
      assert.equal(spawnCount(countD), before + planned, "every task re-runs under the new model");
      console.log("incremental-resume: model swap invalidates (no false reuse) ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 7: CONCURRENT driver — reuse works through the parallel batch path ======
  {
    const workE = tmpWorkspace();
    const countE = path.join(workE, "spawns.count");
    const stubE = writeCountingStub(path.join(workE, "stub.js"), countE);
    process.chdir(workE);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const p1 = runner.plan("architecture-review", { repo: workE, question: "Q?" });
      const planned = p1.tasks.length;
      const mapTasks = p1.tasks.filter((t) => p1.phases[0].taskIds.includes(t.id));
      drive(runner, p1.id, { now: FIXED_NOW, incremental: true, concurrency: 6, agentConfig: agentConfig(stubE) });
      assert.equal(spawnCount(countE), planned, "populate cache via the concurrent driver");

      // Delete 3 Map cache entries; their re-run produces identical bytes, so only
      // those 3 re-run and every downstream task still reuses — under concurrency.
      const dir = cacheDir(workE);
      const files = fs.readdirSync(dir);
      let deleted = 0;
      for (const t of mapTasks.slice(0, 3)) {
        const f = files.find((x) => x.startsWith(`${safeFileName(t.id)}-`));
        if (f) { fs.rmSync(path.join(dir, f)); deleted++; }
      }
      assert.equal(deleted, 3, "deleted 3 Map cache entries");

      const p2 = runner.plan("architecture-review", { repo: workE, question: "Q?" });
      const before = spawnCount(countE);
      const d = drive(runner, p2.id, { now: FIXED_NOW, incremental: true, concurrency: 6, agentConfig: agentConfig(stubE) });
      assert.equal(d.status, "complete", "concurrent incremental re-run completes");
      assert.equal(spawnCount(countE), before + 3, "exactly the 3 deleted tasks re-run (concurrent path)");
      assert.equal(cacheHits(d).length, planned - 3, "the rest reuse from cache under the concurrent driver");
      const acceptIds = d.steps.filter((s) => s.action === "accept").map((s) => s.taskId);
      assert.equal(new Set(acceptIds).size, acceptIds.length, "every task accepted exactly once (no drop/double-process)");
      console.log("incremental-resume: concurrent driver reuse ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ===== 8: AGENT-IDENTITY SWAP — a different agent binary invalidates ==========
  // command/args/endpoint select WHICH agent produces the bytes; they are operator
  // flags stripped from run.inputs, so they must be in the key — else swapping the
  // agent (model held constant) would serve a different agent's cached output.
  {
    const workF = tmpWorkspace();
    const countF = path.join(workF, "spawns.count");
    const stub1 = writeCountingStub(path.join(workF, "stub1.js"), countF);
    const stub2 = writeCountingStub(path.join(workF, "stub2.js"), countF); // identical output, different path (≈ a different agent binary)
    process.chdir(workF);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const p1 = runner.plan("architecture-review", { repo: workF, question: "Q?" });
      const planned = p1.tasks.length;
      drive(runner, p1.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stub1) });
      assert.equal(spawnCount(countF), planned, "populate cache under agent stub1");

      // Same model, DIFFERENT agent identity (stub2) ⇒ every key differs ⇒ full re-run.
      const p2 = runner.plan("architecture-review", { repo: workF, question: "Q?" });
      const before = spawnCount(countF);
      const d = drive(runner, p2.id, { now: FIXED_NOW, incremental: true, agentConfig: agentConfig(stub2) });
      assert.equal(d.status, "complete");
      assert.equal(cacheHits(d).length, 0, "swapping the agent binary invalidates EVERY entry (no false reuse)");
      assert.equal(spawnCount(countF), before + planned, "every task re-runs under the new agent");
      console.log("incremental-resume: agent-identity swap invalidates (no false reuse) ok");
    } finally {
      process.chdir(cwd0);
    }
  }

  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  console.log("incremental-resume-smoke: ok");
}

main();
