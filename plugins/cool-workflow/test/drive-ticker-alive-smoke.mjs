#!/usr/bin/env node
// drive-ticker-alive-smoke — the ticker says how long the agents have been
// quiet (new in 0.3.4, a changed default on the TTY; operator's yes of
// 2026-11-02 in project/docs/intent/2026-10-16-release-gate-ci.md;
// docs/agent-delegation-drive.7.md, "Live output").
//
// In 0.3.2 a stuck round printed `… still working — 9m 50s` for ten minutes,
// the same as a busy one. Now, in a concurrent round:
//   1. The ticker reads the round's alive file and adds
//      `(last output 1m 5s ago)` for one running agent, or
//      `(3 agents running, longest without output 3m 20s)` for more. With
//      no file, a bad file, or no running agent, the line is the old one,
//      byte for byte.
//   2. The batch child keeps that file (CW_BATCH_ALIVE_FILE) while it runs.
//   3. End to end: a TTY-style run (CW_DRIVE_PROGRESS=1) shows the note; a
//      piped run shows no ticker and leaves no alive file; the file is
//      removed when the round ends.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const ticker = path.join(pluginRoot, "scripts", "children", "drive-ticker.mjs");
const batchChild = path.join(pluginRoot, "scripts", "children", "batch-delegate-child.mjs");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-alive-")));
const OLD = /^\[drive\] {3}… Map still working — \d+s$/;

function tickerLines(aliveContent, ms = 450) {
  const alive = path.join(work, `alive-${Math.random().toString(16).slice(2)}.json`);
  if (aliveContent !== undefined) fs.writeFileSync(alive, typeof aliveContent === "string" ? aliveContent : JSON.stringify(aliveContent));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ticker, "Map", "100", String(process.pid), "", alive], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    setTimeout(() => child.kill("SIGTERM"), ms);
    child.on("close", () => resolve(err.split("\n").filter(Boolean)));
  });
}

try {
  // ===== 1. the ticker =====
  {
    const now = Date.now();
    const one = await tickerLines({ jobs: [{ i: 0, startedAt: now - 70000, lastOutputAt: now - 65000, done: false }, { i: 1, startedAt: now - 70000, lastOutputAt: now - 1000, done: true }] });
    assert.ok(one.length >= 2, `ticks: ${one}`);
    for (const line of one) assert.match(line, /^\[drive\] {3}… Map still working — \d+s \(last output 1m 5s ago\)$/, line);

    const three = await tickerLines({ jobs: [0, 1, 2].map((i) => ({ i, startedAt: now - 300000, lastOutputAt: now - [200000, 5000, 1000][i], done: false })) });
    for (const line of three) assert.match(line, /^\[drive\] {3}… Map still working — \d+s \(3 agents running, longest without output 3m 2\ds\)$/, line);

    for (const [name, content] of [["all done", { jobs: [{ i: 0, startedAt: now, lastOutputAt: now, done: true }] }], ["no file", undefined], ["bad file", "{not json"], ["no jobs key", {}]]) {
      const lines = await tickerLines(content);
      assert.ok(lines.length >= 2, `${name}: ticks`);
      for (const line of lines) assert.match(line, OLD, `${name}: the old line, byte for byte: ${line}`);
    }
    console.log("drive-ticker-alive: ticker note and old-line fallback OK");
  }

  // ===== 2. the batch child keeps the file =====
  {
    const alive = path.join(work, "batch-alive.json");
    const slow = path.join(work, "slow.js");
    fs.writeFileSync(slow, 'process.stdout.write("hi\\n"); setTimeout(() => {}, 2500);\n');
    const child = spawn(process.execPath, [batchChild], { env: { ...process.env, CW_BATCH_ALIVE_FILE: alive }, stdio: ["pipe", "pipe", "ignore"] });
    child.stdin.end(JSON.stringify([
      { binary: process.execPath, args: ["-e", ""], cwd: work, timeoutMs: 60000 },
      { binary: process.execPath, args: [slow], cwd: work, timeoutMs: 60000 },
    ]));
    await new Promise((r) => setTimeout(r, 1700));
    const seen = JSON.parse(fs.readFileSync(alive, "utf8"));
    const byI = new Map(seen.jobs.map((j) => [j.i, j]));
    assert.equal(byI.get(0).done, true, `the quick job is marked done: ${JSON.stringify(seen)}`);
    assert.equal(byI.get(1).done, false, "the slow job is still running");
    assert.ok(byI.get(1).lastOutputAt >= byI.get(1).startedAt, "it has a last-output time");
    await new Promise((r) => child.on("close", r));
    console.log("drive-ticker-alive: batch child keeps the alive file OK");
  }

  // ===== 3. end to end =====
  {
    const agent = path.join(work, "agent.js");
    fs.writeFileSync(
      agent,
      [
        'const fs = require("fs");',
        "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);",
        "const fence = String.fromCharCode(96).repeat(3);",
        "fs.writeFileSync(process.argv[3], '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n');",
        "process.stdout.write(JSON.stringify({ model: 'stub-alive' }));",
      ].join("\n")
    );
    const run = (name, extraEnv) => {
      const dir = path.join(work, name);
      const tmp = path.join(work, `${name}-tmp`);
      fs.mkdirSync(dir);
      fs.mkdirSync(tmp);
      fs.writeFileSync(path.join(dir, "README.md"), "# target\n");
      spawnSync("git", ["init", "-q"], { cwd: dir });
      const env = { ...process.env, TMPDIR: tmp, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", ...extraEnv };
      for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_DRIVE_TICK_MS", "CW_AGENT_IDLE_TIMEOUT_MS"]) if (!(key in extraEnv)) delete env[key];
      const child = spawnSync(process.execPath, [cwBin, "-q", "How does routing work?", "--fast", "--json"], { cwd: dir, env, encoding: "utf8", timeout: 120000 });
      assert.equal(child.status, 0, `cw -q exits 0 (stderr: ${child.stderr})`);
      assert.equal(JSON.parse(child.stdout).status, "complete");
      const left = fs.readdirSync(tmp).filter((f) => f.startsWith("cw-drive-alive-"));
      return { child, left };
    };
    {
      const { child, left } = run("tty", { CW_DRIVE_PROGRESS: "1", CW_DRIVE_TICK_MS: "400" });
      assert.match(child.stderr, /^\[drive\] {3}… Map still working — \d+s \((last output \d+s ago|\d+ agents running, longest without output \d+s)\)$/m, `the note shows in a concurrent round: ${child.stderr}`);
      assert.deepEqual(left, [], "the alive file is removed when the round ends");
    }
    {
      const { child, left } = run("piped", { CW_DRIVE_TICK_MS: "400" });
      assert.ok(!child.stderr.includes("still working"), "a piped run prints no ticker line");
      assert.deepEqual(left, [], "a piped run keeps no alive file");
    }
    console.log("drive-ticker-alive: end to end OK");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("drive-ticker-alive-smoke: ok");
