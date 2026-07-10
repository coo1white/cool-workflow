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
// This test spawns N real child processes on one shared run, holds them
// at a start line, releases them together, and asserts no write is lost.
// It covers TWO save paths on purpose:
//   A. blackboardTopicCreateCli — a mutator that saveCheckpoints directly
//      in its own file (multi-agent-cli.ts).
//   B. commentAddCli — a mutator whose saveCheckpoint is TRANSITIVE
//      (collaboration-io's persist()). The first pass of this fix missed
//      every transitive-save verb (feedback + collaboration) because a
//      same-file grep for saveCheckpoint could not see them; this arm
//      guards that whole class.
// Before the fix each arm kept far fewer than N.
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

// Run N children of one `childSrc` against a fresh run, all released
// together, then read the final state.json and return it.
async function raceOnOneRun(prefix, childSrc, argvFor) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const runId = "race-run";
  const runDir = path.join(workspace, ".cw", "runs", runId);
  createRun(runDir, runId, "wf-demo", workspace);

  const child = path.join(workspace, "child.js");
  fs.writeFileSync(child, childSrc, "utf8");

  const goFile = path.join(workspace, "go");
  const procs = Array.from({ length: N }, (_, i) => {
    const readyFile = path.join(workspace, `ready-${i}`);
    return { readyFile, proc: spawn(node, [child, ...argvFor(runId, workspace, i, readyFile, goFile)], { stdio: "ignore" }) };
  });

  const deadline = Date.now() + 30_000;
  while (procs.some((p) => !fs.existsSync(p.readyFile))) {
    if (Date.now() > deadline) throw new Error("children never readied up");
    await new Promise((res) => setTimeout(res, 10));
  }
  fs.writeFileSync(goFile, "go", "utf8");
  await spawnAllAndWait(procs.map((p) => p.proc));

  return JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
}

// A. direct-save mutator: blackboardTopicCreateCli.
async function concurrentTopicCreate() {
  const state = await raceOnOneRun(
    "cw-marace-topic-",
    `
    const fs = require("node:fs");
    const { blackboardTopicCreateCli } = require(${JSON.stringify(path.join(dist, "shell", "multi-agent-cli.js"))});
    const [runId, cwd, title, readyFile, goFile] = process.argv.slice(2);
    fs.writeFileSync(readyFile, "ready", "utf8");
    while (!fs.existsSync(goFile)) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
    blackboardTopicCreateCli({ runId, cwd, title });
    `,
    (runId, cwd, i, readyFile, goFile) => [runId, cwd, `topic-${i}`, readyFile, goFile]
  );
  const board = (state.blackboard && state.blackboard.boards && state.blackboard.boards[0]) || {};
  const topicIds = board.topicIds || [];
  assert.equal(topicIds.length, N, `all ${N} concurrent topic creations kept (got ${topicIds.length}) — lost update in a direct-save mutator`);
  assert.equal(new Set(topicIds).size, N, "the persisted topic ids are all distinct");
}

// B. transitive-save mutator: commentAddCli (saveCheckpoint lives in
// collaboration-io's persist(), not in multi-agent-cli.ts itself).
async function concurrentCommentAdd() {
  const state = await raceOnOneRun(
    "cw-marace-comment-",
    `
    const fs = require("node:fs");
    const { commentAddCli } = require(${JSON.stringify(path.join(dist, "shell", "multi-agent-cli.js"))});
    const [runId, cwd, body, readyFile, goFile] = process.argv.slice(2);
    fs.writeFileSync(readyFile, "ready", "utf8");
    while (!fs.existsSync(goFile)) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
    commentAddCli({ runId, cwd, body, targetKind: "run", target: runId }, "run", runId);
    `,
    (runId, cwd, i, readyFile, goFile) => [runId, cwd, `comment-${i}`, readyFile, goFile]
  );
  const comments = (state.collaboration && state.collaboration.comments) || [];
  assert.equal(comments.length, N, `all ${N} concurrent comment adds kept (got ${comments.length}) — lost update in a transitive-save mutator`);
  assert.equal(new Set(comments.map((c) => c.id)).size, N, "the persisted comment ids are all distinct");
}

(async () => {
  await concurrentTopicCreate();
  await concurrentCommentAdd();
  process.stdout.write(`multi-agent-state-lock-concurrency-smoke: ok (${N} concurrent direct-save + ${N} transitive-save mutations lose nothing)\n`);
})().catch((error) => {
  process.stderr.write(`multi-agent-state-lock-concurrency-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
