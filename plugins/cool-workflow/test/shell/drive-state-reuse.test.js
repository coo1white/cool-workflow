#!/usr/bin/env node
// drive-state-reuse — state-reads program, PR 2
// (project/docs/intent/2026-09-26-state-reads.md). A new drive round starts
// from the run the last round saved, instead of reading state.json back,
// but only while the file is still exactly the one that save wrote. Any
// other write between two rounds must be seen, and
// CW_STATE_REUSE_VERIFY=1 must catch a reused run that is not what the
// file holds.
//
// The hook between two rounds is the phase progress line: drive prints it
// on stderr after a round has saved and before the next round starts.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..", "..");
const { drive } = require(path.join(pluginRoot, "dist/shell/drive"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline"));
const { savedRunIfCurrent } = require(path.join(pluginRoot, "dist/shell/run-store"));

function writeStub(file) {
  const fence = String.fromCharCode(96).repeat(3);
  const lines = [
    'const fs = require("fs");',
    "const rp = process.argv[2];",
    `const body = "# R\\n\\n" + ${JSON.stringify(fence)} + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + ${JSON.stringify(fence)} + "\\n";`,
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 1, output_tokens: 1 } }));',
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

// Plans a golden-path run in a temp dir and drives it to the end with
// `betweenRounds(statePath)` called once, at the first phase progress line.
// Returns the drive result (or the error it threw), the state path, and how
// many times state.json was read.
function driveWithHook(betweenRounds, env = {}) {
  const cwd0 = process.cwd();
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-state-reuse-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const saved = { write: process.stderr.write, read: fs.readFileSync, env: { ...process.env } };
  let reads = 0;
  let hooked = false;
  try {
    process.chdir(work);
    const p = plan(loadWorkflowApp("end-to-end-golden-path"), { repo: work, question: "state reuse" });
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [writeStub(path.join(work, "stub.js")), "{{result}}"], source: "flag" };
    Object.assign(process.env, { CW_DRIVE_PROGRESS: "1" }, env);
    process.stderr.write = function (chunk, ...rest) {
      if (!hooked && String(chunk).includes("==>")) {
        hooked = true;
        betweenRounds(p.paths.state);
      }
      return true;
    };
    fs.readFileSync = function (file, ...rest) {
      if (file === p.paths.state) reads += 1;
      return saved.read.call(fs, file, ...rest);
    };
    let result;
    let error;
    try {
      result = drive(p.id, work, { now: "2026-07-01T00:00:00.000Z", agentConfig });
    } catch (e) {
      error = e;
    }
    fs.readFileSync = saved.read;
    const finalState = JSON.parse(fs.readFileSync(p.paths.state, "utf8"));
    return { result, error, finalState, reads, hooked, tasks: p.tasks.length };
  } finally {
    process.stderr.write = saved.write;
    fs.readFileSync = saved.read;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 1. Nothing else writes: the drive finishes, and later rounds start from
//    the saved run, so it reads state.json far fewer times than it has
//    rounds.
const plain = driveWithHook(() => {});
assert.ok(plain.hooked, "the drive printed a phase line between two rounds");
assert.ok(plain.result && !plain.error, "the drive finishes");
assert.equal(plain.finalState.tasks.filter((t) => t.status === "completed").length, plain.tasks, "every task completed");
assert.ok(plain.reads <= 3, `a whole drive read state.json ${plain.reads} times; later rounds should reuse the saved run`);

// 1b. The same drive with CW_STATE_REUSE_VERIFY=1: every reused run is
//     deep-equal (strict: no undefined-valued keys a load would not have)
//     to a fresh load of state.json.
const checked = driveWithHook(() => {}, { CW_STATE_REUSE_VERIFY: "1" });
assert.ok(checked.result && !checked.error, `every reuse matches state.json: ${checked.error && checked.error.message}`);

// 2. Another writer between two rounds (tmp + rename, as every CW writer
//    does): the next round must read it, and the change must still be in
//    the file at the end.
const renamed = driveWithHook((statePath) => {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.question = "edited by another writer";
  fs.writeFileSync(`${statePath}.other`, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(`${statePath}.other`, statePath);
});
assert.ok(renamed.result && !renamed.error, "the drive finishes after another writer's change");
assert.equal(renamed.finalState.question, "edited by another writer", "a write by another process between rounds is kept, not overwritten by a reused run");

// 3. A hand edit in place with the same size (same inode, same length): the
//    stamp's mtime/ctime still move, so the next round reads it.
const inPlace = driveWithHook((statePath) => {
  const text = fs.readFileSync(statePath, "utf8");
  assert.ok(text.includes('"question": "state reuse"'));
  fs.writeFileSync(statePath, text.replace('"question": "state reuse"', '"question": "state REUSE"'));
});
assert.ok(inPlace.result && !inPlace.error, "the drive finishes after an in-place edit");
assert.ok(JSON.stringify(inPlace.finalState).includes('"state REUSE"'), "an in-place edit of the same size between rounds is kept, not written over by a reused run");

// 4. Teeth for CW_STATE_REUSE_VERIFY: change the saved run in memory only,
//    so the file's stamp does not move. The next round reuses that object
//    (it is the very object savedRunIfCurrent hands back), and the verify
//    switch must refuse it; without the switch the drive goes on.
const diverge = (statePath) => {
  const run = savedRunIfCurrent(statePath);
  assert.ok(run, "after a round, the saved run is current and reusable");
  run.question = "changed in memory only";
};
const verified = driveWithHook(diverge, { CW_STATE_REUSE_VERIFY: "1" });
assert.ok(verified.error, "the verify switch throws on a reused run that differs from state.json");
assert.match(verified.error.message, /state reuse differs from state\.json/);
const unverified = driveWithHook(diverge);
assert.ok(unverified.result && !unverified.error, "without the verify switch the drive does not re-read to check");

process.stdout.write("drive-state-reuse: ok\n");
