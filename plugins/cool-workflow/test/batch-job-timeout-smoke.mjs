#!/usr/bin/env node
// batch-job-timeout-smoke — a concurrent-round agent that runs past its time
// limit is stopped as a whole (its own children too), settles at once as a
// timeout, and says so; the drive says on the TTY that it will try again
// (new in 0.3.3; docs/agent-delegation-drive.7.md, "Concurrent batch").
//
// The case from the field: CW_AGENT_COMMAND was a user wrapper script that
// started the vendor CLI as its own child. At the per-job limit the batch
// child killed the wrapper only; the wrapper's child kept the job's stdout
// pipe open, so the job never settled and the whole batch ran on to the
// parent's spawnSync limit (limit + 30s). Then each held job failed as
// `batch delegate failed: spawnSync ... ETIMEDOUT`, worded as "agent process
// failed to spawn" (jobs that had ended kept their results: each writes its
// own line as it ends), and the drive ran the same round two more times
// with no word of why. In the field report all 12 jobs were held.
//
//   1. Batch child: a job whose child holds stdout, a job whose detached
//      (setsid) child holds stdout, and a quick job, with a 1s limit. Before
//      the fix the held jobs settled only when their 15s children ended
//      (about 15s, with no timeout mark; a longer-lived child runs on to
//      the parent's 31s limit and ETIMEDOUT); after, the batch is back in a few seconds,
//      the held jobs carry `timedOutMs: 1000`, the in-group child is gone,
//      and the quick job keeps its real result.
//   2. Wording: a timed-out or whole-batch failure is not "failed to spawn".
//   3. Drive: `[drive] ✗ <task> (<phase>) — timed out after 1s; trying
//      again (2/3)` on stderr with progress on, a `==> <Phase>` line after
//      every round, and nothing new on a piped run.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentBatchOutcomes, reconcileBatchOutcomes } from "../dist/shell/execution-backend/agent.js";
import { runBackend } from "../dist/shell/execution-backend/registry.js";
import { showBundledSandboxProfile, sandboxContextForValidation } from "../dist/shell/sandbox-profile.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-batch-job-timeout-")));

// A wrapper that starts a child holding the wrapper's stdout, then waits.
// argv: <pid file> <detached 0|1>. The child lives 15s at most.
const holder = path.join(work, "holder.js");
fs.writeFileSync(
  holder,
  [
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const detached = process.argv[3] === "1";',
    'const gc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: ["ignore", "inherit", "inherit"], detached });',
    "fs.writeFileSync(process.argv[2], String(gc.pid));",
    "setInterval(() => {}, 1000);",
  ].join("\n"),
  "utf8"
);
const quick = path.join(work, "quick.js");
fs.writeFileSync(quick, 'process.stdout.write("quick ok");\n', "utf8");

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

const leftovers = [];
function readPid(file) {
  const pid = Number(fs.readFileSync(file, "utf8"));
  if (Number.isInteger(pid) && pid > 1) leftovers.push(pid);
  return pid;
}

try {
  // ===== 1. the batch child settles held jobs as timeouts =====
  {
    const inGroupPid = path.join(work, "in-group.pid");
    const setsidPid = path.join(work, "setsid.pid");
    const before = process.env.CW_BATCH_EXIT_GRACE_MS;
    process.env.CW_BATCH_EXIT_GRACE_MS = "300";
    const started = Date.now();
    let settled;
    try {
      settled = runAgentBatchOutcomes([
        { binary: process.execPath, args: [holder, inGroupPid, "0"], cwd: work, timeoutMs: 1000 },
        { binary: process.execPath, args: [quick], cwd: work, timeoutMs: 1000 },
        { binary: process.execPath, args: [holder, setsidPid, "1"], cwd: work, timeoutMs: 1000 },
      ]);
    } finally {
      if (before === undefined) delete process.env.CW_BATCH_EXIT_GRACE_MS;
      else process.env.CW_BATCH_EXIT_GRACE_MS = before;
    }
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 12000, `the batch settles soon after the 1s limit, not at the parent's 31s limit (took ${elapsed}ms)`);
    assert.equal(settled[0].spawnError, undefined, `a held job is not a batch failure (got ${settled[0].spawnError})`);
    assert.equal(settled[0].exitCode, null, "a timed-out job has no exit code");
    assert.equal(settled[0].timedOutMs, 1000, "a timed-out job says its limit");
    assert.equal(settled[1].exitCode, 0, "the quick job keeps its exit code");
    assert.equal(settled[1].stdout, "quick ok", "the quick job keeps its stdout");
    assert.equal(settled[1].timedOutMs, undefined, "the quick job did not time out");
    assert.equal(settled[2].spawnError, undefined, `a job held by a detached child is not a batch failure (got ${settled[2].spawnError})`);
    assert.equal(settled[2].timedOutMs, 1000, "a job held by a detached child still settles as a timeout");
    const gc = readPid(inGroupPid);
    const until = Date.now() + 3000;
    while (alive(gc) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    if (process.platform !== "win32") assert.ok(!alive(gc), "the timeout stops the job's own child too (its process group)");
    readPid(setsidPid);
    console.log("batch-job-timeout: held jobs settle as timeouts, the quick job keeps its result OK");
  }

  // ===== 2. honest wording =====
  {
    const ctx = sandboxContextForValidation(pluginRoot);
    const ro = showBundledSandboxProfile("readonly", ctx);
    const base = {
      schemaVersion: 1,
      cwd: work,
      sandboxPolicy: ro,
      backendId: "agent",
      manifest: { resultPath: path.join(work, "none.md"), prompt: "do it" },
      delegation: { command: process.execPath, args: [quick] },
    };
    const timedOut = runBackend({ ...base, label: "t", preparedAgentOutcome: { exitCode: null, stdout: "", timedOutMs: 600000 } });
    assert.equal(timedOut.status, "refused");
    assert.match(timedOut.result.summary, /agent process timed out after 600000ms and was killed/, `a timeout says so (got: ${timedOut.result.summary})`);
    const reconciled = reconcileBatchOutcomes([{}], { error: Object.assign(new Error("spawnSync node ETIMEDOUT"), { code: "ETIMEDOUT" }), status: null, stdout: "" }, 630000);
    assert.equal(reconciled[0].spawnError, "batch delegate failed: timed out after 630000ms (spawnSync node ETIMEDOUT)");
    const whole = runBackend({ ...base, label: "w", preparedAgentOutcome: reconciled[0] });
    assert.equal(whole.status, "refused");
    assert.ok(!/failed to spawn/.test(whole.result.summary), `a whole-batch timeout is not a spawn failure (got: ${whole.result.summary})`);
    assert.match(whole.result.summary, /agent delegation failed: batch delegate failed: timed out after 630000ms/);
    const real = runBackend({ ...base, label: "s", preparedAgentOutcome: { spawnError: "spawn ENOENT", exitCode: null, stdout: "" } });
    assert.match(real.result.summary, /agent process failed to spawn: spawn ENOENT/, "a real spawn failure keeps its words");
    console.log("batch-job-timeout: timeout and whole-batch wording OK");
  }

  // ===== 3. the drive says why it tries again =====
  {
    const dir = path.join(work, "repo");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
    spawnSync("git", ["init", "-q"], { cwd: dir });
    const pids = path.join(work, "drive.pid");
    const env = { ...process.env, CW_AGENT_COMMAND: `node ${holder} ${pids} 0`, CW_AGENT_TIMEOUT_MS: "1000", CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", CW_DRIVE_TICK_MS: "0" };
    for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_BATCH_EXIT_GRACE_MS"]) delete env[key];
    const args = [cwBin, "-q", "How does routing work?", "--fast", "--json"];

    const on = spawnSync(process.execPath, args, { cwd: dir, env: { ...env, CW_DRIVE_PROGRESS: "1" }, encoding: "utf8", timeout: 60000 });
    assert.equal(on.error, undefined, `the drive ends well before 60s (stderr: ${on.stderr})`);
    const result = JSON.parse(on.stdout);
    assert.equal(result.status, "parked", "three timed-out rounds park the run");
    assert.ok(!/failed to spawn/.test(on.stdout), "the parked reason does not say the agent failed to spawn");
    assert.match(on.stdout, /timed out after 1000ms/, "the parked reason says the agent timed out");
    const retry = /^\[drive\] ✗ \S.* \([^)]+\) — timed out after 1s; trying again \((\d)\/3\)$/gm;
    const tries = [...on.stderr.matchAll(retry)].map((m) => m[1]);
    assert.ok(tries.includes("2") && tries.includes("3"), `retry lines name the next try (stderr: ${on.stderr})`);
    const rounds = (on.stderr.match(/^\[drive\] ⇉ concurrent round:/gm) || []).length;
    const phaseLines = (on.stderr.match(/^\[drive\] ==> /gm) || []).length;
    assert.ok(rounds >= 3, `the round ran three times (stderr: ${on.stderr})`);
    assert.ok(phaseLines >= rounds, `every round ends with a ==> phase line (${phaseLines} lines, ${rounds} rounds)`);
    console.log("batch-job-timeout: drive retry lines and per-round phase lines OK");

    const dir2 = path.join(work, "repo2");
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir2, "README.md"), "# target\n", "utf8");
    spawnSync("git", ["init", "-q"], { cwd: dir2 });
    const piped = spawnSync(process.execPath, args, { cwd: dir2, env, encoding: "utf8", timeout: 60000 });
    assert.equal(JSON.parse(piped.stdout).status, "parked");
    assert.ok(!piped.stderr.includes("[drive]"), "a piped run with progress off prints no [drive] line");
    console.log("batch-job-timeout: piped default prints nothing new OK");
  }
} finally {
  for (const pid of leftovers) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("batch-job-timeout-smoke: ok");
