#!/usr/bin/env node
"use strict";

// robustness-failclosed-smoke — regression guards for the robustness-review fixes.
// Each part pins a failure mode that previously crashed, lost data, or behaved
// incorrectly under a malformed-file or concurrent-writer condition:
//
//   A. One corrupt worker.json must NOT blank the whole worker listing; a direct
//      getWorkerScope on the corrupt worker fails closed with a clear message.
//   B. A registry overlay that is valid JSON but the wrong SHAPE (null/array/
//      scalar) fails closed with a clear "Corrupt overlay" error instead of a
//      cryptic TypeError or a silent empty read.
//   C. Concurrent scheduler writers do not lose tasks — the store's
//      read-modify-write is serialized by a file lock.
//   D. Scheduler core ops still work under the lock.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(pluginRoot, "dist", "state.js"));
const { allocateWorkerScope, listWorkerScopes, getWorkerScope } = require(path.join(pluginRoot, "dist", "worker-isolation.js"));
const { RunRegistry } = require(path.join(pluginRoot, "dist", "run-registry.js"));
const { Scheduler } = require(path.join(pluginRoot, "dist", "scheduler.js"));

function makeRun(tmp, id) {
  const paths = createRunPaths(path.join(tmp, ".cw", "runs", id));
  ensureRunDirs(paths);
  const run = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: tmp,
    workflow: { id, title: id, summary: "", limits: { maxAgents: 4, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    workers: []
  };
  saveCheckpoint(run);
  return run;
}
function addTask(run, taskId) {
  run.tasks.push({
    id: taskId, kind: "analyze", phase: "analysis", status: "pending", requiresEvidence: false,
    prompt: "test", taskPath: path.join(run.paths.tasksDir, `${taskId}.md`),
    resultPath: path.join(run.paths.resultsDir, `${taskId}.md`), loopStage: "act",
    workerId: `worker-${taskId}-0001`
  });
  return run.tasks[run.tasks.length - 1];
}

// ---- A. corrupt worker.json: skip in listing, fail closed on direct lookup ----
function corruptWorkerScope() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-rob-worker-"));
  const run = makeRun(tmp, "rob-workers");
  const scopeA = allocateWorkerScope(run, addTask(run, "task-a"), { workerId: "worker-task-a-0001" });
  const scopeB = allocateWorkerScope(run, addTask(run, "task-b"), { workerId: "worker-task-b-0001" });

  fs.writeFileSync(path.join(scopeB.workerDir, "worker.json"), "{ this is not json", "utf8");

  run.workers = []; // force a disk reload (drop the in-memory cache)
  let listed;
  assert.doesNotThrow(() => { listed = listWorkerScopes(run); }, "one corrupt worker.json must not throw the whole listing");
  assert.ok(listed.some((s) => s.id === scopeA.id), "the readable worker still surfaces");
  assert.ok(!listed.some((s) => s.id === scopeB.id), "the corrupt worker is skipped, not faked");

  run.workers = [];
  assert.throws(() => getWorkerScope(run, scopeB.id), /Corrupt worker scope/, "direct lookup of a corrupt scope fails closed");
}

// ---- B. wrong-shape registry overlay fails closed (not TypeError/silent) ------
function wrongShapeOverlay() {
  for (const bad of ["null", "[]", "42", "\"x\""]) {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-rob-home-")));
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-rob-repo-")));
    fs.mkdirSync(path.join(repo, ".cw", "runs"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".cw", "registry"), { recursive: true });
    fs.mkdirSync(path.join(home, "registry"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".cw", "registry", "archive.json"), bad);
    const reg = new RunRegistry(repo, undefined, { ...process.env, CW_HOME: home });
    assert.throws(() => reg.buildIndex("repo"), /Corrupt overlay/, `archive.json = ${bad} must fail closed, not TypeError/silent`);
  }
}

// ---- C. concurrent scheduler writers do not lose tasks ------------------------
async function concurrentSchedulerWrites() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-rob-sched-"));
  const N = 16;
  const child = path.join(tmp, "create-one.js");
  fs.writeFileSync(child, `
    const { Scheduler } = require(${JSON.stringify(path.join(pluginRoot, "dist", "scheduler.js"))});
    new Scheduler(${JSON.stringify(tmp)}).create({ prompt: "task " + process.argv[2], intervalMinutes: 5 });
  `, "utf8");

  // Start all creators truly in parallel so they race the store's read-modify-write.
  const procs = [];
  for (let i = 0; i < N; i++) procs.push(spawn(process.execPath, [child, "p" + i], { stdio: "ignore" }));
  await Promise.all(procs.map((p) => new Promise((res, rej) => {
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`creator exited ${code}`))));
    p.on("error", rej);
  })));

  const all = new Scheduler(tmp).list();
  assert.equal(all.length, N, `all concurrent creates survived (expected ${N}, got ${all.length}) — no lost read-modify-write`);
}

// ---- D. scheduler core ops still work under the lock --------------------------
function schedulerStillWorks() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-rob-sched2-"));
  const s = new Scheduler(tmp);
  const t = s.create({ prompt: "p", intervalMinutes: 1 });
  assert.equal(s.list().length, 1, "create persists");
  s.complete(t.id);
  assert.ok(s.list().find((x) => x.id === t.id), "complete keeps the task");
  assert.equal(s.delete(t.id).deleted, true, "delete removes the task");
  assert.equal(s.list().length, 0, "store is empty after delete");
}

(async () => {
  corruptWorkerScope();
  wrongShapeOverlay();
  await concurrentSchedulerWrites();
  schedulerStillWorks();
  process.stdout.write("robustness-failclosed-smoke: ok (corrupt worker skip + fail-closed lookup; wrong-shape overlay fail-closed; concurrent scheduler writers lose nothing; core ops intact)\n");
})().catch((error) => {
  process.stderr.write(`robustness-failclosed-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
