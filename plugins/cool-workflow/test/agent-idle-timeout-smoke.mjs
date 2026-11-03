#!/usr/bin/env node
// agent-idle-timeout-smoke — telling a silent agent apart from a busy one
// (new in 0.3.3; docs/agent-delegation-drive.7.md, "Idle limit").
//
// In 0.3.2 a stuck agent held each round for its whole 10-minute limit, and
// nothing said whether it was still writing. Now:
//   1. Every batch line carries startedAt / endedAt / lastOutputAt (epoch ms),
//      so a job that went quiet early can be told from one that worked to the
//      end. Additive keys; the default path is otherwise unchanged.
//   2. With CW_AGENT_IDLE_TIMEOUT_MS set (opt-in), a job that writes nothing
//      for that long is stopped and its line says `idleTimedOutMs`, long
//      before its overall limit. A job that keeps writing is NOT stopped, and
//      with no idle limit nothing is stopped for being quiet.
//   3. The one-job (serial) path honours it too, and the refusal says
//      "produced no output for <N>ms" (not "timed out", not "failed to spawn")
//      and carries idleTimedOutMs for the drive's park rule.
// Before this change, case 2's silent job ran its full 30s with no mark.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runAgentBatchOutcomes, agentIdleTimeoutMs } from "../dist/shell/execution-backend/agent.js";
import { runBackend } from "../dist/shell/execution-backend/registry.js";
import { showBundledSandboxProfile, sandboxContextForValidation } from "../dist/shell/sandbox-profile.js";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const work = tmpDir("cw-agent-idle-");

// Writes once, then is silent for 30s.
const silent = path.join(work, "silent.js");
fs.writeFileSync(silent, 'process.stdout.write("started\\n"); setTimeout(() => {}, 30000);\n', "utf8");
// Writes every 200ms for 2.5s, then ends well.
const chatty = path.join(work, "chatty.js");
fs.writeFileSync(
  chatty,
  'let n = 0; const t = setInterval(() => { process.stderr.write("tick\\n"); if (++n >= 12) { clearInterval(t); process.stdout.write("done"); } }, 200);\n',
  "utf8"
);
// Silent for 1.5s, then ends well (no idle limit set for it).
const quiet = path.join(work, "quiet.js");
fs.writeFileSync(quiet, 'setTimeout(() => process.stdout.write("late ok"), 1500);\n', "utf8");

try {
  // ===== 0. the env read: only a positive number turns it on =====
  assert.equal(agentIdleTimeoutMs({}), undefined);
  assert.equal(agentIdleTimeoutMs({ CW_AGENT_IDLE_TIMEOUT_MS: "" }), undefined);
  assert.equal(agentIdleTimeoutMs({ CW_AGENT_IDLE_TIMEOUT_MS: "0" }), undefined);
  assert.equal(agentIdleTimeoutMs({ CW_AGENT_IDLE_TIMEOUT_MS: "-5" }), undefined);
  assert.equal(agentIdleTimeoutMs({ CW_AGENT_IDLE_TIMEOUT_MS: "soon" }), undefined);
  assert.equal(agentIdleTimeoutMs({ CW_AGENT_IDLE_TIMEOUT_MS: " 1500 " }), 1500);

  // ===== 1 + 2. the batch child =====
  {
    const started = Date.now();
    const out = runAgentBatchOutcomes([
      { binary: process.execPath, args: [silent], cwd: work, timeoutMs: 60000, idleTimeoutMs: 1000 },
      { binary: process.execPath, args: [chatty], cwd: work, timeoutMs: 60000, idleTimeoutMs: 1000 },
      { binary: process.execPath, args: [quiet], cwd: work, timeoutMs: 60000 },
    ]);
    const took = Date.now() - started;
    assert.ok(took < 15000, `a silent job is stopped at its idle limit, not its 60s limit (took ${took}ms)`);

    assert.equal(out[0].idleTimedOutMs, 1000, `the silent job says it was stopped for no output: ${JSON.stringify(out[0])}`);
    assert.equal(out[0].timedOutMs, undefined, "an idle stop is not a time-limit stop");
    assert.equal(out[0].exitCode, null);

    assert.equal(out[1].exitCode, 0, `a job that keeps writing is not stopped: ${JSON.stringify(out[1])}`);
    assert.equal(out[1].stdout, "done");
    assert.equal(out[1].idleTimedOutMs, undefined);

    assert.equal(out[2].exitCode, 0, `with no idle limit a quiet job runs to its end: ${JSON.stringify(out[2])}`);
    assert.equal(out[2].stdout, "late ok");
    assert.equal(out[2].idleTimedOutMs, undefined);
  }

  // A job that exits by itself is never an idle stop, even when a process it
  // left behind keeps its stdout open through the grace window (review fix).
  {
    const leaver = path.join(work, "leaver.js");
    fs.writeFileSync(leaver, 'setTimeout(() => { require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { stdio: ["ignore", "inherit", "inherit"] }); process.stdout.write("done"); process.exit(0); }, 1500);\n');
    const [out] = runAgentBatchOutcomes([{ binary: process.execPath, args: [leaver], cwd: work, timeoutMs: 60000, idleTimeoutMs: 2000 }]);
    assert.equal(out.exitCode, 0, `a job that ended by itself keeps its exit 0: ${JSON.stringify(out)}`);
    assert.equal(out.idleTimedOutMs, undefined, "and is not reported as an idle stop");
  }

  // CW's bundled wrappers are silent on a piped stderr unless CW_AGENT_STREAM=1,
  // so with an idle limit the job gets it (and a user's own value wins).
  {
    const tell = path.join(work, "tell.js");
    fs.writeFileSync(tell, 'process.stdout.write(String(process.env.CW_AGENT_STREAM));\n');
    const base = { binary: process.execPath, args: [tell], cwd: work, timeoutMs: 60000 };
    const [withIdle, userZero, noIdle] = runAgentBatchOutcomes([
      { ...base, idleTimeoutMs: 5000, env: { ...process.env, CW_AGENT_STREAM: undefined } },
      { ...base, idleTimeoutMs: 5000, env: { ...process.env, CW_AGENT_STREAM: "0" } },
      { ...base, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CW_AGENT_STREAM")) },
    ]);
    assert.equal(withIdle.stdout, "1", "an idle-limited job gets CW_AGENT_STREAM=1");
    assert.equal(userZero.stdout, "0", "the user's own CW_AGENT_STREAM=0 is kept");
    assert.equal(noIdle.stdout, "undefined", "with no idle limit nothing is added");
  }

  // The new time keys on the raw NDJSON line (reconcile does not need them).
  {
    const { spawnSync } = await import("node:child_process");
    const child = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "children", "batch-delegate-child.mjs")], {
      input: JSON.stringify([
        { binary: process.execPath, args: [silent], cwd: work, timeoutMs: 60000, idleTimeoutMs: 800 },
        { binary: process.execPath, args: [quiet], cwd: work, timeoutMs: 60000 },
      ]),
      encoding: "utf8",
    });
    const lines = child.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    const s = lines.find((l) => l.idleTimedOutMs);
    assert.ok(s, "the silent job's line carries idleTimedOutMs");
    const q = lines.find((l) => l.stdout === "late ok");
    assert.ok(q && q.exitCode === 0 && !q.idleTimedOutMs, `a job that writes before the limit is never stopped: ${JSON.stringify(q)}`);
  }

  // ===== 3. the serial (one-job) path =====
  {
    const ctx = sandboxContextForValidation(pluginRoot);
    const ro = showBundledSandboxProfile("readonly", ctx);
    const base = {
      schemaVersion: 1,
      cwd: work,
      sandboxPolicy: ro,
      backendId: "agent",
      manifest: { resultPath: path.join(work, "none.md"), prompt: "do it" },
    };
    const before = process.env.CW_AGENT_IDLE_TIMEOUT_MS;
    process.env.CW_AGENT_IDLE_TIMEOUT_MS = "1000";
    try {
      const started = Date.now();
      const env = runBackend({ ...base, label: "serial", timeoutMs: 60000, delegation: { command: process.execPath, args: [silent] } });
      assert.ok(Date.now() - started < 15000, "the serial path is stopped at its idle limit too");
      assert.equal(env.status, "refused");
      assert.match(env.result.summary, /agent process produced no output for 1000ms and was killed/, `got: ${env.result.summary}`);
      assert.doesNotMatch(env.result.summary, /failed to spawn|timed out/);
      assert.equal(env.idleTimedOutMs, 1000);
      assert.equal(env.timedOutMs, undefined);

      const ok = runBackend({ ...base, label: "chatty", timeoutMs: 60000, delegation: { command: process.execPath, args: [chatty] } });
      assert.notEqual(ok.status, "refused", `a chatty serial job is not stopped: ${ok.result.summary}`);
    } finally {
      if (before === undefined) delete process.env.CW_AGENT_IDLE_TIMEOUT_MS;
      else process.env.CW_AGENT_IDLE_TIMEOUT_MS = before;
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

process.stdout.write("agent-idle-timeout-smoke: ok (silent job stopped early, busy job kept, times on every line)\n");
