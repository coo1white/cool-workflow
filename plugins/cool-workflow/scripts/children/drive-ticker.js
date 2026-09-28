#!/usr/bin/env node
"use strict";

// drive-ticker.js — the sign of life while a drive round waits on agents.
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
//
// Every interval it writes one line to stderr:
//   [drive]   … <Label> still working — 20s
// Lines only, added at the end: no redraw, no color. It stops by itself
// when the drive process is gone or stderr is closed, so it never
// outlives the run.

const [label = "", intervalArg = "", parentArg = ""] = process.argv.slice(2);
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

process.on("SIGTERM", () => process.exit(0));
// Ctrl-C reaches the whole process group. The drive process decides what a
// stop means (it waits for the worker in hand); this ticker keeps going
// until the drive stops it or goes away.
process.on("SIGINT", () => {});
process.stderr.on("error", () => process.exit(0));

setInterval(() => {
  const elapsed = Date.now() - started;
  if (!parentAlive() || elapsed > MAX_MS) process.exit(0);
  process.stderr.write(`[drive]   … ${label ? `${label} ` : ""}still working — ${since(elapsed)}\n`);
}, intervalMs);
