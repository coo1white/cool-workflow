#!/usr/bin/env node
// drive-ticker-tty-smoke — the still-working ticker and a live agent view
// do not write over each other (new in 0.3.3).
//
// In a serial hop the agent wrapper's stderr is the terminal itself
// (CW_AGENT_STREAM=1 here, a TTY in real use), and the shipped renderer
// (agent-adapter-core createRenderer) redraws one block in place with \r
// and cursor-up. A ticker line written into that block was glued to the
// spinner row and left old rows behind. Now the renderer claims the
// terminal through the CW_DRIVE_TTY_CLAIM file and the ticker keeps quiet
// while the claim is there.
//
// Checks, black box through scripts/cw.js with CW_DRIVE_PROGRESS=1:
//   1. a stub wrapper using the real createRenderer (stderr made to look
//      like a TTY): every [drive] line starts a line, the concurrent Map
//      round still gets its ticker line, and the round line uses », not ⇉;
//   2. a silent custom wrapper still gets the ticker in its serial hops;
//   3. a piped default run prints no [drive] line at all.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const coreUrl = pathToFileURL(path.join(pluginRoot, "scripts", "agents", "agent-adapter-core.mjs")).href;
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-ticker-tty-")));

const resultBody = [
  "const fence = String.fromCharCode(96).repeat(3);",
  "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
].join("\n");

const live = path.join(work, "live-agent.mjs");
fs.writeFileSync(
  live,
  [
    'import fs from "node:fs";',
    `import { createRenderer } from ${JSON.stringify(coreUrl)};`,
    "const tty = { isTTY: true, columns: 80, write: (s) => process.stderr.write(s) };",
    'const render = createRenderer({ stderr: tty, label: "stub" });',
    'render.action("stub: reading the repo (read-only)…");',
    "setTimeout(() => {",
    '  render.action("Read(README.md)");',
    "  render.finishLive();",
    resultBody,
    "  fs.writeFileSync(process.argv[3], body);",
    "  process.stdout.write(JSON.stringify({ model: 'stub-live' }));",
    "}, 1500);",
  ].join("\n"),
  "utf8"
);

const quiet = path.join(work, "quiet-agent.js");
fs.writeFileSync(
  quiet,
  [
    'const fs = require("fs");',
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);",
    resultBody,
    "fs.writeFileSync(process.argv[3], body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-quiet' }));",
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

function cw(dir, agent, extraEnv) {
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", ...extraEnv };
  for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_DRIVE_TICK_MS", "CW_NO_STREAM", "CW_DRIVE_TTY_CLAIM"]) {
    if (!(key in extraEnv)) delete env[key];
  }
  const child = spawnSync(process.execPath, [cwBin, "-q", "How does routing work?", "--fast", "--json"], { cwd: dir, env, encoding: "utf8", timeout: 180000 });
  assert.equal(child.status, 0, `cw -q exits 0 (stderr: ${child.stderr})`);
  assert.equal(JSON.parse(child.stdout).status, "complete", "the run completes");
  return child;
}

const on = { CW_DRIVE_PROGRESS: "1", CW_AGENT_STREAM: "1", CW_DRIVE_TICK_MS: "250" };

try {
  {
    const { stderr } = cw(repo("live"), live, on);
    assert.match(stderr, /stub: reading the repo/, "the live view reached the terminal in a serial hop");
    // What the eye sees on each row: escape codes take no room, and a \r
    // starts the row again.
    const rows = stderr.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/[\r\n]/);
    const glued = rows.filter((row) => row.indexOf("[drive]") > 0);
    assert.deepEqual(glued, [], "no [drive] line lands inside the live view's line");
    assert.match(stderr, /^\[drive\] {3}… Map still working — \d+s$/m, "the concurrent round keeps its ticker line");
    assert.match(stderr, /^\[drive\] » concurrent round: 2 agents spawning in parallel, may take minutes…$/m, "the round line uses »");
    assert.match(stderr, /^\[drive\] ==> Assess » \(0\/2\)$/m, "the parallel phase line uses »");
    assert.ok(!stderr.includes("⇉"), "no ⇉ in the progress lines");
    console.log("drive-ticker-tty: the live view and the ticker keep to their own lines OK");
  }
  {
    const { stderr } = cw(repo("quiet"), quiet, on);
    assert.match(stderr, /^\[drive\] {3}… (Verify|Verdict) still working — \d+s$/m, "a silent wrapper still gets the ticker in a serial hop");
    console.log("drive-ticker-tty: a silent wrapper keeps the ticker OK");
  }
  {
    const { stderr } = cw(repo("piped"), live, { CW_DRIVE_TICK_MS: "250" });
    assert.ok(!stderr.includes("[drive]"), "a piped run prints no [drive] line");
    console.log("drive-ticker-tty: piped default prints no [drive] line OK");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("drive-ticker-tty-smoke: ok");
