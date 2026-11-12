#!/usr/bin/env node
// drive-ticker-alive-smoke — the ticker says how long the agents have been
// quiet (new in 0.3.3, a changed default on the TTY; operator's yes of
// 2026-11-02; docs/reference.md, "Live output").
//
// In 0.3.2 a stuck round printed `… still working — 9m 50s` for ten minutes,
// the same as a busy one. Now, in a concurrent round:
//   1. The note (core quietNote) is `(last output 1m 5s ago)` for one
//      running agent, or `(3 agents running, longest without output 3m 20s)`
//      for more. With no running agent it is empty: the line is the old one.
//   2. End to end: a TTY-style run (CW_DRIVE_PROGRESS=1) shows the note; a
//      piped run shows no ticker line.
// Since batch 5 the drive keeps each agent's last-output time in memory
// (agents run as async children), so there is no alive file and no batch
// child.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { quietNote, sinceText } from "../dist/core/pipeline/drive-decide.js";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = tmpDir("cw-drive-alive-");

try {
  // ===== 1. the note =====
  {
    const now = Date.now();
    assert.equal(quietNote([{ lastOutputAt: now - 65000, done: false }, { lastOutputAt: now - 1000, done: true }], now), " (last output 1m 5s ago)");
    assert.equal(quietNote([0, 1, 2].map((i) => ({ lastOutputAt: now - [200000, 5000, 1000][i], done: false })), now), " (3 agents running, longest without output 3m 20s)");
    assert.equal(quietNote([{ lastOutputAt: now, done: true }], now), "", "all done: no note");
    assert.equal(quietNote([], now), "", "no jobs: no note");
    assert.equal(sinceText(9000), "9s");
    assert.equal(sinceText(590000), "9m 50s");
    console.log("drive-ticker-alive: quiet note OK");
  }

  // ===== 2. end to end =====
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
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "README.md"), "# target\n");
      spawnSync("git", ["init", "-q"], { cwd: dir });
      const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", ...extraEnv };
      for (const key of ["CW_AGENT_ENDPOINT", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_DRIVE_TICK_MS", "CW_AGENT_IDLE_TIMEOUT_MS"]) if (!(key in extraEnv)) delete env[key];
      const child = spawnSync(process.execPath, [cwBin, "-q", "How does routing work?", "--json"], { cwd: dir, env, encoding: "utf8", timeout: 120000 });
      assert.equal(child.status, 0, `cw -q exits 0 (stderr: ${child.stderr})`);
      assert.equal(JSON.parse(child.stdout).status, "complete");
      return { child };
    };
    {
      const { child } = run("tty", { CW_DRIVE_PROGRESS: "1", CW_DRIVE_TICK_MS: "400" });
      assert.match(child.stderr, /^\[drive\] {3}… Map still working — \d+s \((last output \d+s ago|\d+ agents running, longest without output \d+s)\)$/m, `the note shows in a concurrent round: ${child.stderr}`);
    }
    {
      const { child } = run("piped", { CW_DRIVE_TICK_MS: "400" });
      assert.ok(!child.stderr.includes("still working"), "a piped run prints no ticker line");
    }
    console.log("drive-ticker-alive: end to end OK");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("drive-ticker-alive-smoke: ok");
