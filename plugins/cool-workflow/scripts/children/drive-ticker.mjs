#!/usr/bin/env node

// drive-ticker.mjs — the sign of life while a drive round waits on agents.
//
// Consumer: src/shell/drive.ts withDriveTicker, which spawns this with
// stderr inherited at the start of each round, only when [drive] progress
// is on (a TTY, or CW_DRIVE_PROGRESS=1), and stops it with SIGTERM when the
// round ends. drive's agent waits are spawnSync, so the drive process
// cannot print while it waits; this separate process does.
//
//   argv[2] = phase label (may be empty)
//   argv[3] = interval in ms
//   argv[4] = the drive process's pid
//   argv[5] = a claim file (may be empty; new in 0.3.3)
//   argv[6] = an alive file (may be empty or missing; new in 0.3.3)
//
// Every interval it writes one line to stderr:
//   [drive]   … <Label> still working — 20s
// When the alive file (kept by a concurrent round's batch child) names
// running agents, the line also says how long they have been quiet:
//   … still working — 4m 10s (last output 3m 50s ago)
//   … still working — 4m 10s (3 agents running, longest without output 3m 50s)
// With no such file (a serial agent, or before the first write) the line is
// the one above, byte for byte.
// Lines only, added at the end: no redraw, no color. While the claim file
// is there, a live agent view (agent-adapter-core createRenderer) is
// redrawing its rows on the same terminal, so no line is written: one
// would be glued into that view and break its redraw. It stops by itself
// when the drive process is gone or stderr is closed, so it never
// outlives the run.

import fs from "node:fs";

const [label = "", intervalArg = "", parentArg = "", claimFile = "", aliveFile = ""] = process.argv.slice(2);
const intervalMs = Number(intervalArg) > 0 ? Number(intervalArg) : 10000;
const parentPid = Number(parentArg) > 0 ? Number(parentArg) : process.ppid;
const started = Date.now();
const MAX_MS = 24 * 60 * 60 * 1000;

function since(ms) {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

function parentAlive() {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

function quietNote(now) {
  if (!aliveFile) return "";
  let running;
  try {
    running = JSON.parse(fs.readFileSync(aliveFile, "utf8")).jobs.filter((job) => job && !job.done && Number.isFinite(job.lastOutputAt));
  } catch {
    return "";
  }
  if (!running.length) return "";
  const quiet = since(Math.max(0, now - Math.min(...running.map((job) => job.lastOutputAt))));
  return running.length === 1 ? ` (last output ${quiet} ago)` : ` (${running.length} agents running, longest without output ${quiet})`;
}

process.on("SIGTERM", () => process.exit(0));
// Ctrl-C reaches the whole process group. The drive process decides what a
// stop means (it waits for the worker in hand); this ticker keeps going
// until the drive stops it or goes away.
process.on("SIGINT", () => {});
process.stderr.on("error", () => process.exit(0));

setInterval(() => {
  const elapsed = Date.now() - started;
  if (!parentAlive() || elapsed > MAX_MS) process.exit(0);
  if (claimFile && fs.existsSync(claimFile)) return;
  process.stderr.write(`[drive]   … ${label ? `${label} ` : ""}still working — ${since(elapsed)}${quietNote(Date.now())}\n`);
}, intervalMs);
