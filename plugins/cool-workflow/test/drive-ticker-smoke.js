#!/usr/bin/env node
"use strict";

// drive-ticker-smoke — the sign of life while a round waits on its agents
// (D1 in docs/unix-principles.md §8: a new line at least every 10 s).
//
// With [drive] progress on, a round that waits on a slow agent prints
// `[drive]   … <Phase> still working — <n>s` to stderr at each tick
// (CW_DRIVE_TICK_MS, default 10000). With progress off (a piped run, the
// default) the bytes do not change: no ticker line. CW_DRIVE_TICK_MS=0
// turns the line off. stdout is the same JSON in every case.
//
// Black box through scripts/cw.js, with a stub agent that waits 1.2 s and
// then writes a valid cw:result.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-ticker-")));

const agent = path.join(work, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);",
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(process.argv[3], body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-ticker' }));",
  ].join("\n"),
  "utf8"
);

function repo(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function cw(dir, extraEnv) {
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", ...extraEnv };
  for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_DRIVE_TICK_MS"]) {
    if (!(key in extraEnv)) delete env[key];
  }
  const child = spawnSync(process.execPath, [cwBin, "-q", "How does routing work?", "--fast", "--json"], { cwd: dir, env, encoding: "utf8", timeout: 120000 });
  assert.equal(child.status, 0, `cw -q exits 0 (stderr: ${child.stderr})`);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, "complete", "the run completes");
  return child;
}

const TICK = /^\[drive\] {3}… [A-Z][A-Za-z]* still working — \d+s$/m;

try {
  {
    const child = cw(repo("progress-on"), { CW_DRIVE_PROGRESS: "1", CW_DRIVE_TICK_MS: "300" });
    assert.match(child.stderr, TICK, "a slow round prints the ticker line when progress is on");
    assert.match(child.stderr, /^\[drive\] {3}… Map still working — \d+s$/m, "the line names the phase in hand");
    assert.ok(!/\x1b\[/.test(child.stderr.split("\n").filter((line) => line.includes("still working")).join("\n")), "the ticker line has no escape bytes");
    console.log("drive-ticker: progress on prints the still-working line OK");
  }
  {
    const child = cw(repo("piped-default"), { CW_DRIVE_TICK_MS: "300" });
    assert.ok(!child.stderr.includes("still working"), "a piped run with progress off prints no ticker line");
    console.log("drive-ticker: piped default prints nothing new OK");
  }
  {
    const child = cw(repo("tick-off"), { CW_DRIVE_PROGRESS: "1", CW_DRIVE_TICK_MS: "0" });
    assert.ok(!child.stderr.includes("still working"), "CW_DRIVE_TICK_MS=0 turns the ticker off");
    assert.match(child.stderr, /\[drive\] /, "the other [drive] lines are still there");
    console.log("drive-ticker: CW_DRIVE_TICK_MS=0 turns it off OK");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("drive-ticker-smoke: ok");
