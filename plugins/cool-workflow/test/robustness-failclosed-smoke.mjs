#!/usr/bin/env node
// robustness-failclosed-smoke — regression guards for the robustness-review fixes.
// Each part pins a failure mode that previously crashed, lost data, or behaved
// incorrectly under a malformed-file or concurrent-writer condition:
//
//   A. One corrupt worker.json must NOT blank the whole worker listing; a direct
//      getWorkerScope on the corrupt worker fails closed with a clear message.
//   B. A registry overlay that is valid JSON but the wrong SHAPE (null/array/
//      scalar) fails closed with a clear "Corrupt overlay" error instead of a
//      cryptic TypeError or a silent empty read.
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
// v2 dist layout: old flat dist/{state,worker-isolation,run-registry}.js
// split into dist/shell/*. createRunPaths/ensureRunDirs/saveCheckpoint moved to
// the run-store shell module; RunRegistry to its *-io shell module.
import { createRunPaths, ensureRunDirs, saveCheckpoint } from "../dist/shell/run-store.js";
import { allocateWorkerScope, listWorkerScopes, getWorkerScope } from "../dist/shell/worker-isolation.js";
import { RunRegistry } from "../dist/shell/run-registry-io.js";
import { tmpDir } from "./helpers/workspace.mjs";

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
// listWorkerScopes reloads scopes from disk and skips a corrupt worker.json
// with a stderr diagnostic, while getWorkerScope wraps JSON.parse in
// try/catch and throws "Corrupt worker scope <file>: ...".
function corruptWorkerScope() {
  const tmp = tmpDir("cw-rob-worker-");
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
    const home = tmpDir("cw-rob-home-");
    const repo = tmpDir("cw-rob-repo-");
    fs.mkdirSync(path.join(repo, ".cw", "runs"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".cw", "registry"), { recursive: true });
    fs.mkdirSync(path.join(home, "registry"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".cw", "registry", "archive.json"), bad);
    const reg = new RunRegistry(repo, undefined, { ...process.env, CW_HOME: home });
    assert.throws(() => reg.buildIndex("repo"), /Corrupt overlay/, `archive.json = ${bad} must fail closed, not TypeError/silent`);
  }
}

(async () => {
  corruptWorkerScope();
  wrongShapeOverlay();
  process.stdout.write("robustness-failclosed-smoke: ok (corrupt worker skip + fail-closed lookup; wrong-shape overlay fail-closed)\n");
})().catch((error) => {
  process.stderr.write(`robustness-failclosed-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
