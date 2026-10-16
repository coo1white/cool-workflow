#!/usr/bin/env node
"use strict";

// drive-operator-write-lost-update-smoke — an operator's `cw result` or
// `cw commit` made while a drive waits on its agent must survive the drive's
// next save.
//
// Finding: a drive round holds ONE in-memory copy of the run (the round
// cache), spawns its agent(s) for minutes, then saves that copy. `cw result`
// and `cw commit` each take the state.json lock for their own load -> change
// -> save (withRunStateLock), but the drive's copy was loaded BEFORE their
// write, so its save put the old state back: the operator's task completion
// and commit record were gone (lost update), with no error anywhere.
//
// The fix: after the agent wait the drive re-reads state.json when its file
// stamp moved since this process loaded or saved it, and applies its own
// change to the fresh copy; every drive save also checks the stamp under the
// lock and refuses (fail closed) rather than overwrite a write it never saw.
//
//   Part A: a serial round (end-to-end-golden-path, one task): `cw commit`.
//   Part B: a concurrent round (architecture-review, --concurrency 2):
//     `cw dispatch` + `cw result` for a third Map task, and `cw commit`.
//   Part C: `cw result` for the SAME task the drive's agent is working: the
//     drive refuses (non-zero, "changed by another writer") and the
//     operator's writes stay as saved.
//
// In each part the stub agent writes its result, then waits on a FILE
// barrier; while it waits this test runs the operator commands from separate
// processes; then it lets the agent go. Before the fix every operator write
// is gone once the drive saves. No sleeps decide the order: the barrier
// files do.
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

const RESULT = (summary) =>
  `# r\n\n\`\`\`cw:result\n{"summary":${JSON.stringify(summary)},"findings":[],"evidence":["README.md:1"]}\n\`\`\`\n`;

function childEnv() {
  const env = { ...process.env, CW_NO_AUTO_AGENT: "1" };
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete env[v];
  return env;
}

function cw(cwd, args) {
  return execFileSync(node, [cli, ...args], { cwd, encoding: "utf8", env: childEnv() });
}

// The stub agent: write the result, mark "waiting" (one file per agent),
// then hold until the test writes "release".
function writeStub(file) {
  fs.writeFileSync(
    file,
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const [barrier, resultPath] = process.argv.slice(2);",
      `fs.writeFileSync(resultPath, ${JSON.stringify(RESULT("stub agent result"))});`,
      'fs.writeFileSync(path.join(barrier, "waiting-" + process.pid), resultPath);',
      'while (!fs.existsSync(path.join(barrier, "release"))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);',
      'process.stdout.write(JSON.stringify({ model: "stub-model" }));',
    ].join("\n"),
    "utf8"
  );
}

// The drive runs in its own process (drive() is synchronous while the agent
// runs) and prints its DriveResult.
function writeDriver(file) {
  fs.writeFileSync(
    file,
    [
      `const { drive } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "drive.js"))});`,
      "const [runId, cwd, stub, barrier, width] = process.argv.slice(2);",
      "const agentConfig = { schemaVersion: 1, command: process.execPath, args: [stub, barrier, '{{result}}'], source: 'flag' };",
      "const result = drive(runId, cwd, { once: true, concurrency: Number(width), agentConfig });",
      "process.stdout.write(JSON.stringify(result));",
    ].join("\n"),
    "utf8"
  );
}

async function waitFor(check, what) {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((res) => setTimeout(res, 10));
  }
}

async function runCase({ label, app, width, agents, operatorTask, sameTask }) {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-lost-update-")));
  try {
    fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
    const barrier = path.join(work, "barrier");
    fs.mkdirSync(barrier);
    const stub = path.join(work, "stub.js");
    const driver = path.join(work, "driver.js");
    writeStub(stub);
    writeDriver(driver);
    const operatorResult = path.join(work, "operator-result.md");
    fs.writeFileSync(operatorResult, RESULT("operator result"), "utf8");

    const runId = JSON.parse(cw(work, ["plan", app, "--repo", work, "--question", "lost update"])).runId;

    let driveOut = "";
    let driveErr = "";
    const child = spawn(node, [driver, runId, work, stub, barrier, String(width)], { cwd: work, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (driveOut += d));
    child.stderr.on("data", (d) => (driveErr += d));
    const exited = new Promise((res) => child.on("exit", (code) => res(code)));

    // Every agent of this round is now holding at the barrier, its result
    // written, the drive not yet saved.
    await waitFor(() => fs.readdirSync(barrier).filter((f) => f.startsWith("waiting-")).length >= agents, `${label}: ${agents} agent(s) at the barrier`);

    // Give the operator a task of its own: dispatch the rest of the round.
    if (operatorTask && !sameTask) cw(work, ["dispatch", runId]);
    if (operatorTask) cw(work, ["result", runId, operatorTask, operatorResult]);
    const commit = JSON.parse(cw(work, ["commit", runId, "--allow-unverified-checkpoint", "--reason", "operator-checkpoint"])).commit;
    assert.ok(commit && commit.id, `${label}: the operator commit was recorded`);

    fs.writeFileSync(path.join(barrier, "release"), "go", "utf8");
    const code = await exited;
    const state = JSON.parse(fs.readFileSync(path.join(work, ".cw", "runs", runId, "state.json"), "utf8"));

    if (operatorTask) {
      assert.equal(state.tasks.find((t) => t.id === operatorTask).status, "completed", `${label}: the operator's \`cw result\` for ${operatorTask} survives the drive's save (lost update)`);
    }
    assert.ok(
      (state.commits || []).some((c) => c.id === commit.id && c.reason === "operator-checkpoint"),
      `${label}: the operator's \`cw commit\` ${commit.id} survives the drive's save (lost update)`
    );

    if (sameTask) {
      // The operator settled the very task the drive's agent was working:
      // the drive refuses (fail closed) rather than record a second result
      // over the operator's or put the old state back.
      assert.notEqual(code, 0, `${label}: the drive refuses (stdout: ${driveOut})`);
      assert.match(driveErr, /changed by another writer/, `${label}: the refusal names the conflict`);
      assert.equal(state.commits[state.commits.length - 1].id, commit.id, `${label}: nothing was saved after the operator's commit`);
      return;
    }

    assert.equal(code, 0, `${label}: drive exits 0 (stderr: ${driveErr})`);
    const result = JSON.parse(driveOut);
    // The drive's own work is kept too: each agent's task is completed.
    const driven = result.steps.filter((s) => s.action === "accept" && s.status === "ok").map((s) => s.taskId);
    assert.equal(driven.length, agents, `${label}: the drive accepted ${agents} agent result(s)`);
    for (const id of driven) {
      assert.equal(state.tasks.find((t) => t.id === id).status, "completed", `${label}: the drive's own accept of ${id} is saved`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

(async () => {
  await runCase({ label: "serial", app: "end-to-end-golden-path", width: 1, agents: 1 });
  await runCase({ label: "concurrent", app: "architecture-review", width: 2, agents: 2, operatorTask: "map:transport-core" });
  await runCase({ label: "same-task", app: "end-to-end-golden-path", width: 1, agents: 1, operatorTask: "golden:path", sameTask: true });
  process.stdout.write("drive-operator-write-lost-update-smoke: ok (operator writes survive a live drive's save; a same-task conflict refuses)\n");
})().catch((error) => {
  process.stderr.write(`drive-operator-write-lost-update-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
