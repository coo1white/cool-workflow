#!/usr/bin/env node
"use strict";

// exec-child-termination-smoke — the batch delegate child and the agent/local/
// container backends must never let one wedged process hold the whole run
// hostage. Two regressions proven here, both fail-closed the moment the child
// stops behaving:
//
//   Finding #4 — a batch job's stdin stayed an open, never-written pipe, so a
//   vendor CLI that reads stdin to EOF blocked until its own timeout instead of
//   getting an immediate EOF. The fix spawns each job with stdin "ignore"
//   (matching the serial path agent.ts runAgentProcess stdio ["ignore",...]).
//   Proof: a job that only exits AFTER stdin reaches EOF. Before the fix it is
//   killed by the per-job timeout (exitCode null); after, it exits 0 at once.
//
//   Finding #2 — the batch delegate absorbs the drive's single SIGTERM, but a
//   job's grandchild that inherited the job's stdout pipe keeps that pipe open
//   past the job's death. The job's `close` never fires, the delegate's
//   captured stdout stream never ends, and its event loop never empties: the
//   one SIGTERM can never actually stop it — a deadlock. The fix arms a bounded
//   self-exit deadline after the first stop signal. Proof: a job that forks a
//   detached grandchild holding the pipe, then a SIGTERM to the delegate. Before
//   the fix the delegate hangs forever; after, it self-exits 143 within the
//   deadline (compressed here via CW_BATCH_STOP_DEADLINE_MS).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { runAgentBatchOutcomes } = require(path.join(pluginRoot, "dist/shell/execution-backend/agent.js"));
const DELEGATE_SCRIPT = path.join(pluginRoot, "scripts/children/batch-delegate-child.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Finding #4: a batch job whose binary reads stdin to EOF before it exits. The
// delegate never writes stdin, so with the default inherited pipe the job hangs
// until the per-job timeout; with stdin "ignore" it gets EOF immediately.
function stdinReaderStubBody() {
  return [
    'let data = "";',
    'process.stdin.on("data", (d) => { data += d; });',
    'process.stdin.on("end", () => {',
    '  process.stdout.write(JSON.stringify({ model: "stub-stdin", stdinBytes: data.length }));',
    "  process.exit(0);",
    "});"
  ].join("\n");
}

function stdinEofDoesNotHangAJob() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-exec-term-stdin-")));
  try {
    const stub = path.join(work, "reads-stdin.js");
    fs.writeFileSync(stub, stdinReaderStubBody(), "utf8");
    // timeoutMs is the per-job window. Before the fix this whole test waited
    // out this window (the job is SIGTERM-killed at it); after the fix the job
    // settles near-instantly, well under it.
    const job = { binary: process.execPath, args: [stub], cwd: work, timeoutMs: 4000 };
    const settled = runAgentBatchOutcomes([job]);
    assert.equal(settled.length, 1, "one job in, one outcome out");
    assert.equal(
      settled[0].exitCode,
      0,
      `a stdin-reading job must get EOF and exit 0, not hang to its timeout (got exitCode ${settled[0].exitCode}, spawnError ${settled[0].spawnError})`
    );
    assert.equal(settled[0].spawnError, undefined, "a clean EOF exit carries no spawnError");
    assert.match(settled[0].stdout, /stub-stdin/, "the job's real stdout survives");
    console.log("exec-child-termination-smoke: a stdin-reading batch job gets EOF and does not hang ok");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Finding #2: a job that forks a DETACHED grandchild inheriting the job's stdout
// (fd 1 = the delegate's captured pipe for this job), then exits. The grandchild
// outlives the job and holds that pipe open, so the delegate's `close` for the
// job never fires. The grandchild self-exits after a bounded life so it can
// never leak, and the test also SIGKILLs it by the pid it records.
function pipeHoldingJobStubBody() {
  return [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const pidFile = process.argv[2];',
    'const gc = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 12000)"], {',
    '  stdio: ["ignore", "inherit", "ignore"],',
    "  detached: true",
    "});",
    "gc.unref();",
    "fs.writeFileSync(pidFile, String(gc.pid));",
    "process.exit(0);"
  ].join("\n");
}

async function wedgedGrandchildCannotDeadlockTheDelegate() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-exec-term-wedge-")));
  const gcPidFile = path.join(work, "gc.pid");
  let delegate;
  try {
    const stub = path.join(work, "pipe-holder.js");
    fs.writeFileSync(stub, pipeHoldingJobStubBody(), "utf8");
    const job = { binary: process.execPath, args: [stub, gcPidFile], cwd: work, timeoutMs: 60000 };

    delegate = spawn(process.execPath, [DELEGATE_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      // Compress the 8s production deadline so the smoke stays fast and
      // deterministic. The env override IS the mechanism under test.
      env: { ...process.env, CW_BATCH_STOP_DEADLINE_MS: "1200" }
    });
    delegate.stdout.on("data", () => {});
    delegate.stderr.on("data", () => {});
    const exitPromise = new Promise((resolve) => {
      delegate.on("exit", (code, signal) => resolve({ code, signal }));
    });

    delegate.stdin.write(JSON.stringify([job]));
    delegate.stdin.end();

    // Let the job spawn its grandchild and wedge the pipe before we stop it.
    await sleep(1500);
    assert.ok(fs.existsSync(gcPidFile), "the job spawned its pipe-holding grandchild");

    // The drive's single graceful stop. Before the fix the delegate can never
    // act on it (the wedged pipe keeps its loop alive); after, the deadline
    // force-exits it.
    delegate.kill("SIGTERM");

    const watchdog = sleep(6000).then(() => "TIMEOUT");
    const result = await Promise.race([exitPromise, watchdog]);
    assert.notEqual(result, "TIMEOUT", "the delegate must self-exit after SIGTERM, not deadlock on a wedged grandchild's pipe");
    assert.equal(result.code, 143, `a SIGTERM-then-deadline exit uses code 143 (got code ${result.code}, signal ${result.signal})`);
    console.log("exec-child-termination-smoke: a wedged grandchild's pipe cannot deadlock the delegate's SIGTERM ok");
  } finally {
    if (delegate && delegate.exitCode === null && delegate.signalCode === null) {
      try { delegate.kill("SIGKILL"); } catch {}
    }
    try {
      const gcPid = Number(fs.readFileSync(gcPidFile, "utf8"));
      if (Number.isFinite(gcPid)) process.kill(gcPid, "SIGKILL");
    } catch {}
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  stdinEofDoesNotHangAJob();
  await wedgedGrandchildCannotDeadlockTheDelegate();
  console.log("exec-child-termination-smoke: ok (batch stdin EOF + bounded self-exit under a wedged grandchild)");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
