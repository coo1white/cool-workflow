#!/usr/bin/env node
// drive-concurrent-spawn-lines-smoke — in a concurrent drive round, each
// worker's `[drive] → <label> (<phase>) — spawning agent, may take minutes…`
// line is printed when the round starts, while its agent runs, not after
// the whole round ends (D1 row 4 in docs/unix-principles.md §8; new in
// 0.3.2, project/docs/intent/2026-10-16-release-gate-ci.md, part
// "Operator decisions for 0.3.2").
//
// Black box through scripts/cw.js. The stub agent writes a start mark and
// then waits until the test makes a release file. With [drive] progress on,
// the test waits for every agent of the first concurrent round to start,
// and then for every worker's spawning line to come on stderr, BEFORE it
// lets any agent end. Before the change those lines came only after the
// round ended, so this wait timed out. With progress off (a piped run, the
// default) stderr has no [drive] line at all, and stdout is the same JSON.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-spawn-lines-")));

const agent = path.join(work, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    'const path = require("path");',
    "const gate = process.argv[4];",
    "fs.writeFileSync(path.join(gate, 'started-' + process.pid), '');",
    "const sleep = new Int32Array(new SharedArrayBuffer(4));",
    "const until = Date.now() + 60000;",
    "while (!fs.existsSync(path.join(gate, 'release')) && Date.now() < until) Atomics.wait(sleep, 0, 0, 50);",
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(process.argv[3], body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-spawn-lines' }));",
  ].join("\n"),
  "utf8"
);

function repo(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const gate = path.join(work, `${name}-gate`);
  fs.mkdirSync(gate);
  return { dir, gate };
}

function cwEnv(gate, extraEnv) {
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}} ${gate}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", ...extraEnv };
  for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_DRIVE_TICK_MS"]) {
    if (!(key in extraEnv)) delete env[key];
  }
  return env;
}

const ARGS = [cwBin, "-q", "How does routing work?", "--fast", "--json"];
const ROUND = /^\[drive\] » concurrent round: (\d+) agents? spawning in parallel, may take minutes…$/m;
const SPAWN = /^\[drive\] → \S.* \([^)]+\) — spawning agent, may take minutes…$/gm;
const SPAWN_LINE = /^\[drive\] → \S.* \([^)]+\) — spawning agent, may take minutes…$/;

function started(gate) {
  return fs.readdirSync(gate).filter((name) => name.startsWith("started-")).length;
}

function waitFor(check, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      if (check()) return resolve(true);
      if (Date.now() > until) return resolve(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

try {
  {
    const { dir, gate } = repo("progress-on");
    const child = spawn(process.execPath, ARGS, { cwd: dir, env: cwEnv(gate, { CW_DRIVE_PROGRESS: "1", CW_DRIVE_TICK_MS: "0" }), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
    try {
      assert.ok(await waitFor(() => ROUND.test(stderr), 60000), `a concurrent round starts (stderr: ${stderr})`);
      const width = Number(stderr.match(ROUND)[1]);
      // 0.3.3: » in place of ⇉, which some terminal fonts do not have.
      assert.ok(!stderr.includes("⇉"), `no ⇉ in the progress lines (stderr: ${stderr})`);
      assert.ok(width > 1, "the round runs more than one agent");
      assert.ok(await waitFor(() => started(gate) >= width, 60000), "every agent of the round has started and is waiting");
      const early = await waitFor(() => (stderr.match(SPAWN) || []).length >= width, 20000);
      assert.equal(started(gate), width, "no other agent started while the round waits");
      assert.ok(early, `each worker's spawning line prints while its agent runs (stderr so far: ${stderr})`);
      const roundAt = stderr.search(ROUND);
      const lines = stderr.slice(roundAt).split("\n").filter(Boolean);
      for (let i = 1; i <= width; i += 1) assert.match(lines[i], SPAWN_LINE, "the spawning lines come right after the round line");
    } finally {
      fs.writeFileSync(path.join(gate, "release"), "");
    }
    assert.equal(await exited, 0, `cw -q exits 0 (stderr: ${stderr})`);
    assert.equal(JSON.parse(stdout).status, "complete", "the run completes");
    const spawnLines = stderr.match(SPAWN) || [];
    assert.equal(spawnLines.length, new Set(spawnLines).size, "no worker's spawning line prints twice");
    console.log("drive-concurrent-spawn-lines: spawning lines print at round start OK");
  }
  {
    const { dir, gate } = repo("piped-default");
    fs.writeFileSync(path.join(gate, "release"), "");
    const child = spawnSync(process.execPath, ARGS, { cwd: dir, env: cwEnv(gate, {}), encoding: "utf8", timeout: 120000 });
    assert.equal(child.status, 0, `cw -q exits 0 (stderr: ${child.stderr})`);
    assert.equal(JSON.parse(child.stdout).status, "complete", "the run completes");
    assert.ok(!child.stderr.includes("[drive]"), "a piped run with progress off prints no [drive] line");
    console.log("drive-concurrent-spawn-lines: piped default prints nothing new OK");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("drive-concurrent-spawn-lines-smoke: ok");
