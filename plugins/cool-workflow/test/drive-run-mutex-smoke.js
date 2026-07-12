#!/usr/bin/env node
"use strict";

// drive-run-mutex-smoke — a run may be driven by only ONE process at a time.
//
// Finding (P1): a concurrent round loads the run once, spawns agents for
// minutes, then flushes the run object it loaded at round start
// (saveCheckpoint) — the lock covers only the write instant, so a SECOND
// drive on the same run clobbers this one's flush (lost update) and, worse,
// both drives mint the SAME worker id from an in-memory count
// (createWorkerId), double-dispatching the same task. Nothing stopped two
// `cw run resume <id> --drive` calls from running the same run at once.
//
// The fix: drive()/driveAsync() hold a run-scoped DRIVE mutex
// (<runDir>/drive.lock, a pid file) across the whole call. A second drive
// whose owner pid is still a LIVE process fails closed with a clear refusal
// (never a silent double-drive); a lock whose owner is GONE (a crashed prior
// drive) or this process's own leak is stolen so a crash never wedges the run.
//
//   Part A (fails before the fix): a drive.lock owned by a LIVE external
//     process makes drive() refuse — before the fix drive() ignored the file
//     and returned a normal result.
//   Part B (guard): a drive.lock owned by a DEAD pid is stolen and the drive
//     proceeds — the refusal must not wedge a run after a crash.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));

// A live child process to stand in for "another drive holding the run". A bare
// keep-alive timer keeps it running until we kill it. stdio ignored so it
// never writes to this test's streams.
function spawnKeepAlive() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  return child;
}

function waitForExit(child) {
  return new Promise((resolve) => child.on("exit", () => resolve()));
}

function writeDriveLock(runDir, pid) {
  fs.writeFileSync(path.join(runDir, "drive.lock"), `${pid}@${new Date().toISOString()}\n`, { mode: 0o600 });
}

async function main() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-mutex-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");

  // Clear ambient agent config so drive() never auto-detects an agent CLI on
  // PATH and spawns a real child on the unfixed (Part A) path — see
  // drive-exhaustion-blocked-smoke.js for the same guard.
  const savedEnv = {};
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) {
    savedEnv[v] = process.env[v];
    delete process.env[v];
  }

  const cwd0 = process.cwd();
  const notConfigured = { schemaVersion: 1 };
  let liveChild;
  try {
    process.chdir(work);
    const p = plan(loadWorkflowApp("end-to-end-golden-path"), { repo: work, question: "drive mutex" });
    const runDir = path.join(work, ".cw", "runs", p.id);
    const lockPath = path.join(runDir, "drive.lock");

    // ---- Part A: a LIVE owner refuses (this is what fails before the fix) ----
    liveChild = spawnKeepAlive();
    writeDriveLock(runDir, liveChild.pid);
    assert.throws(
      () => drive(p.id, work, { now: "2026-07-01T00:00:00.000Z", agentConfig: notConfigured }),
      /already being driven/,
      "a second drive must refuse while another live process drives the same run"
    );
    // The refusal must NOT remove the live owner's lock.
    assert.ok(fs.existsSync(lockPath), "the live owner's drive.lock is left intact on refusal");

    liveChild.kill("SIGKILL");
    await waitForExit(liveChild);
    liveChild = undefined;

    // ---- Part B: a DEAD owner is stolen, the drive proceeds -----------------
    const deadChild = spawnKeepAlive();
    const deadPid = deadChild.pid;
    deadChild.kill("SIGKILL");
    await waitForExit(deadChild);
    writeDriveLock(runDir, deadPid);

    const result = drive(p.id, work, { now: "2026-07-01T00:00:00.000Z", agentConfig: notConfigured });
    assert.equal(result.runId, p.id, "a drive over a stale (dead-owner) lock proceeds normally");
    // A completed drive releases its own lock.
    assert.ok(!fs.existsSync(lockPath), "the drive removes its own drive.lock on exit");
  } finally {
    if (liveChild) {
      try {
        liveChild.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    process.chdir(cwd0);
    for (const v of Object.keys(savedEnv)) {
      if (savedEnv[v] === undefined) delete process.env[v];
      else process.env[v] = savedEnv[v];
    }
    fs.rmSync(work, { recursive: true, force: true });
  }

  process.stdout.write("drive-run-mutex-smoke: ok\n");
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
