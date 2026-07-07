#!/usr/bin/env node
"use strict";

// run-state-lock-concurrency-smoke — regression guard for the last
// #339-class read-modify-write race, on state.json itself:
//
//   recordResultRun / dispatchRun did load -> change -> saveCheckpoint,
//   but the lock in saveCheckpoint covered ONLY the write. Two processes
//   recording results for two tasks of the SAME run at the same time
//   could both load the same state, and the second save then silently
//   dropped the first task's completion.
//
// The fix: withRunStateLock (run-store) holds the state.json lock over
// the WHOLE load -> change -> save cycle, and withFileLock (fs-atomic)
// is re-entrant inside one process so the nested saveCheckpoint /
// recordWorkerFailure save paths keep working unchanged.
//
// Part A checks the re-entrant lock primitive by itself.
// Part B spawns one real child process per map task of an
// architecture-review run, holds them at a start line, lets them record
// results at the same time, and asserts no completion is lost — the
// same pattern as scheduling-routine-lock-concurrency-smoke.js.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const { withFileLock } = require(path.join(pluginRoot, "dist", "shell", "fs-atomic.js"));

function spawnAllAndWait(procs) {
  return Promise.all(procs.map((p) => new Promise((res, rej) => {
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`child exited ${code}`))));
    p.on("error", rej);
  })));
}

// ---- A. withFileLock is re-entrant inside one process ---------------------
function reentrantLock() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-relock-"));
  const target = path.join(tmp, "state.json");
  const events = [];
  const result = withFileLock(target, () => {
    events.push("outer");
    // Before the fix this nested take of the SAME lock had to wait the
    // full 240 tries and then threw "could not acquire file lock".
    return withFileLock(target, () => {
      events.push("inner");
      assert.ok(fs.existsSync(`${target}.lock`), "lock file held during nested section");
      return 42;
    });
  });
  assert.equal(result, 42, "nested section returns through both levels");
  assert.deepEqual(events, ["outer", "inner"], "both sections ran, in order");
  assert.ok(!fs.existsSync(`${target}.lock`), "lock released once at the outer exit");
  // The lock still works as a lock after a re-entrant use.
  withFileLock(target, () => {
    assert.ok(fs.existsSync(`${target}.lock`), "lock can be taken again after release");
  });
}

// ---- B. concurrent `cw result` recordings lose no completion --------------
async function concurrentRecordResult() {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-staterace-")));
  const plan = JSON.parse(
    execFileSync(node, [cli, "plan", "architecture-review", "--repo", workspace, "--question", "lock race smoke"], {
      cwd: workspace,
      encoding: "utf8",
    })
  );
  const runId = plan.runId;
  const dispatch = JSON.parse(execFileSync(node, [cli, "dispatch", runId], { cwd: workspace, encoding: "utf8" }));
  const tasks = dispatch.tasks.map((t) => t.id);
  assert.ok(tasks.length >= 2, `need at least 2 dispatched tasks to race (got ${tasks.length})`);

  // One accepted-shape result file per task (grounded evidence included).
  const resultFiles = tasks.map((taskId, i) => {
    const file = path.join(workspace, `result-${i}.md`);
    fs.writeFileSync(
      file,
      `# r${i}\n\n\`\`\`cw:result\n{"summary":"mapped ${taskId}","findings":[],"evidence":["src/index.ts:1"]}\n\`\`\`\n`,
      "utf8"
    );
    return file;
  });

  // Each child readies up, then busy-waits for one shared "go" file so all
  // recordings hit the load -> save window at the same time.
  const child = path.join(workspace, "record-one.js");
  fs.writeFileSync(
    child,
    `
    const fs = require("node:fs");
    const { recordResultRun } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "pipeline-cli.js"))});
    const [taskId, resultPath, readyFile, goFile] = process.argv.slice(2);
    fs.writeFileSync(readyFile, "ready", "utf8");
    while (!fs.existsSync(goFile)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    recordResultRun({ runId: ${JSON.stringify(runId)}, taskId, resultPath, cwd: ${JSON.stringify(workspace)} });
    `,
    "utf8"
  );

  const goFile = path.join(workspace, "go");
  const procs = tasks.map((taskId, i) => {
    const readyFile = path.join(workspace, `ready-${i}`);
    return { readyFile, proc: spawn(node, [child, taskId, resultFiles[i], readyFile, goFile], { stdio: "ignore" }) };
  });
  const deadline = Date.now() + 30_000;
  while (procs.some((p) => !fs.existsSync(p.readyFile))) {
    if (Date.now() > deadline) throw new Error("children never readied up");
    await new Promise((res) => setTimeout(res, 10));
  }
  fs.writeFileSync(goFile, "go", "utf8");
  await spawnAllAndWait(procs.map((p) => p.proc));

  const state = JSON.parse(fs.readFileSync(path.join(workspace, ".cw", "runs", runId, "state.json"), "utf8"));
  const completed = state.tasks.filter((t) => tasks.includes(t.id) && t.status === "completed");
  assert.equal(
    completed.length,
    tasks.length,
    `all ${tasks.length} concurrent result recordings kept (got ${completed.length}) — lost update in recordResultRun`
  );
}

(async () => {
  reentrantLock();
  await concurrentRecordResult();
  process.stdout.write("run-state-lock-concurrency-smoke: ok (re-entrant lock + concurrent result recordings lose nothing)\n");
})().catch((error) => {
  process.stderr.write(`run-state-lock-concurrency-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
