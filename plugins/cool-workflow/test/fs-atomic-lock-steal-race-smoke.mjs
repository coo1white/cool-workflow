#!/usr/bin/env node
// fs-atomic-lock-steal-race-smoke — regression guard for a TOCTOU race in
// withFileLock's stale-lock steal path (fs-atomic.ts).
//
// The bug: judging a lock stale and deleting it were two steps with no
// exclusion between them, so a slow judge could delete a NEW owner's lock
// and two processes ended up inside the critical section at once. Many
// fixes measured worse; `open(..., "wx")` itself was not single-winner on
// Node 18 under load. The lock now takes its spot with `fs.linkSync` (a
// per-attempt temp file hard-linked onto the lock path), holds the owner's
// pid, and a lock whose pid is gone is taken over only by the single
// winner of a `<lock>.steal` guard, which re-reads the pid before it
// renames its own file over the lock.
//
// Reproduced with N real child processes barrier-released against one
// pre-planted lock whose holder is dead. This test asserts the critical
// section is never entered by more than one process at a time.
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const dist = path.join(pluginRoot, "dist");

const N = 8;
const TRIALS = 12;

const childSrc = `
const fs = require("node:fs");
const { withFileLock } = require(${JSON.stringify(path.join(dist, "shell", "fs-atomic.js"))});
function durableAppendFileSync(file, text) { const fd = fs.openSync(file, "a"); try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
const [target, logFile, readyFile, goFile] = process.argv.slice(2);
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
fs.writeFileSync(readyFile, "ready", "utf8");
while (!fs.existsSync(goFile)) { sleep(5); }
try {
  withFileLock(target, () => {
    durableAppendFileSync(logFile, \`enter \${process.pid}\\n\`);
    sleep(60);
    durableAppendFileSync(logFile, \`exit \${process.pid}\\n\`);
  });
} catch (error) {
  // A "stolen" throw is the SYMPTOM this test is measuring, not a harness
  // failure — do not let it crash the child. The maxDepth assertion below
  // is what actually determines pass/fail.
  if (!/was stolen during the critical section/.test(error.message)) throw error;
}
`;

// A child's stderr is kept and named in the failure: a child that exits
// non-zero (seen once on the Windows CI leg as a bare "child exited 1")
// must say which error stopped it, or the fault cannot be traced.
function spawnAllAndWait(procs) {
  return Promise.all(procs.map((p) => new Promise((res, rej) => {
    let stderr = "";
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (chunk) => { stderr += chunk; });
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`child exited ${code}:\n${stderr.trim() || "(no stderr)"}`))));
    p.on("error", rej);
  })));
}

// A pid that was alive and is now gone: the holder of the planted lock.
const deadPid = spawnSync(node, ["-e", ""]).pid;

// One trial: plant a lock held by a dead pid, barrier-release N real child
// processes at it together, and return the max concurrent-hold depth seen
// in the log.
async function trial() {
  const base = tmpDir("cw-lock-steal-race-");
  const target = path.join(base, "store.json");
  const lock = `${target}.lock`;
  const logFile = path.join(base, "log.txt");
  fs.writeFileSync(target, "{}\n", "utf8");
  fs.writeFileSync(lock, `${deadPid}\n`, "utf8");

  const child = path.join(base, "child.js");
  fs.writeFileSync(child, childSrc, "utf8");
  const goFile = path.join(base, "go");

  const procs = Array.from({ length: N }, (_, i) => {
    const readyFile = path.join(base, `ready-${i}`);
    return { readyFile, proc: spawn(node, [child, target, logFile, readyFile, goFile], { stdio: ["ignore", "ignore", "pipe"] }) };
  });

  const deadline = Date.now() + 15_000;
  while (procs.some((p) => !fs.existsSync(p.readyFile))) {
    if (Date.now() > deadline) throw new Error("children never readied up");
    await new Promise((res) => setTimeout(res, 5));
  }
  fs.writeFileSync(goFile, "go", "utf8");
  await spawnAllAndWait(procs.map((p) => p.proc));

  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean) : [];
  let depth = 0;
  let maxDepth = 0;
  for (const line of lines) {
    const kind = line.split(" ")[0];
    depth += kind === "enter" ? 1 : -1;
    maxDepth = Math.max(maxDepth, depth);
  }
  return { maxDepth, enters: lines.filter((l) => l.startsWith("enter")).length };
}

(async () => {
  for (let t = 1; t <= TRIALS; t++) {
    const { maxDepth, enters } = await trial();
    assert.equal(enters, N, `trial ${t}: all ${N} children entered the critical section (got ${enters})`);
    assert.equal(
      maxDepth,
      1,
      `trial ${t}: the stale-lock steal must never let more than one process hold the lock at once (saw ${maxDepth} concurrent holds)`
    );
  }
  process.stdout.write(`fs-atomic-lock-steal-race-smoke: ok (${TRIALS} trials x ${N} racing processes, no overlapping holds)\n`);
})().catch((error) => {
  process.stderr.write(`fs-atomic-lock-steal-race-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
