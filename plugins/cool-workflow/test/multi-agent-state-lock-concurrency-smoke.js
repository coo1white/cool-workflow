#!/usr/bin/env node
"use strict";

// multi-agent-state-lock-concurrency-smoke — regression guard for the
// state.json lost-update across the multi-agent / worker / audit CLI
// mutators, the sibling of run-state-lock-concurrency-smoke.js (which
// only covered dispatchRun / recordResultRun).
//
// The bug: every persist()-calling verb in multi-agent-cli.ts (and the
// worker/audit/orchestrator entry points) did a bare load -> change ->
// saveCheckpoint. saveCheckpoint's lock covered ONLY the write, so two
// processes mutating the SAME run at the same time both loaded the same
// state and the later save silently dropped the earlier change.
// Reproduced: 6 concurrent `blackboard topic create` on one run kept 1.
//
// The fix: those verbs now run their whole load -> change -> persist
// cycle through withRunStateLock (run-store), which holds the state.json
// lock across the whole cycle; the nested saveCheckpoint re-enters the
// same re-entrant lock.
//
// This test spawns N real child processes, each calling
// blackboardTopicCreateCli on one shared run, holds them at a start
// line, releases them together, and asserts all N topics survive in
// state.json — before the fix this kept far fewer than N.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const dist = path.join(pluginRoot, "dist");
const { createRun } = require(path.join(dist, "shell", "run-store.js"));

const N = 6;

function spawnAllAndWait(procs) {
  return Promise.all(procs.map((p) => new Promise((res, rej) => {
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`child exited ${code}`))));
    p.on("error", rej);
  })));
}

async function concurrentTopicCreate() {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-marace-")));
  const runId = "race-run";
  const runDir = path.join(workspace, ".cw", "runs", runId);
  createRun(runDir, runId, "wf-demo", workspace);

  // Each child readies up, then busy-waits for one shared "go" file so all
  // topic creations hit the load -> save window at the same time.
  const child = path.join(workspace, "create-one-topic.js");
  fs.writeFileSync(
    child,
    `
    const fs = require("node:fs");
    const { blackboardTopicCreateCli } = require(${JSON.stringify(path.join(dist, "shell", "multi-agent-cli.js"))});
    const [runId, cwd, title, readyFile, goFile] = process.argv.slice(2);
    fs.writeFileSync(readyFile, "ready", "utf8");
    while (!fs.existsSync(goFile)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    const topic = blackboardTopicCreateCli({ runId, cwd, title });
    process.stdout.write(topic.id + "\\n");
    `,
    "utf8"
  );

  const goFile = path.join(workspace, "go");
  const procs = Array.from({ length: N }, (_, i) => {
    const readyFile = path.join(workspace, `ready-${i}`);
    return { readyFile, proc: spawn(node, [child, runId, workspace, `topic-${i}`, readyFile, goFile], { stdio: "ignore" }) };
  });

  const deadline = Date.now() + 30_000;
  while (procs.some((p) => !fs.existsSync(p.readyFile))) {
    if (Date.now() > deadline) throw new Error("children never readied up");
    await new Promise((res) => setTimeout(res, 10));
  }
  fs.writeFileSync(goFile, "go", "utf8");
  await spawnAllAndWait(procs.map((p) => p.proc));

  const state = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
  const board = (state.blackboard && state.blackboard.boards && state.blackboard.boards[0]) || {};
  const topicIds = board.topicIds || [];
  assert.equal(
    topicIds.length,
    N,
    `all ${N} concurrent topic creations kept (got ${topicIds.length}) — lost update in a multi-agent CLI mutator`
  );
  // Ids must be distinct — a shared-id collision would also read as a loss.
  assert.equal(new Set(topicIds).size, N, "the persisted topic ids are all distinct");
}

(async () => {
  await concurrentTopicCreate();
  process.stdout.write(`multi-agent-state-lock-concurrency-smoke: ok (${N} concurrent topic creations lose nothing)\n`);
})().catch((error) => {
  process.stderr.write(`multi-agent-state-lock-concurrency-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
