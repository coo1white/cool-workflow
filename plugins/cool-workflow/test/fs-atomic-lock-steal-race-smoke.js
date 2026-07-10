#!/usr/bin/env node
"use strict";

// fs-atomic-lock-steal-race-smoke — regression guard for a TOCTOU race in
// withFileLock's stale-lock steal path (fs-atomic.ts).
//
// The bug: on EEXIST, if the lock's mtime looked older than
// FILE_LOCK_STALE_MS, the code unconditionally deleted whatever file was
// AT THAT PATH via fs.rmSync(lock, { force: true }) and retried. Between
// the staleness check and the delete, the real owner can finish and a
// brand-new, legitimate owner can take the spot — the delete then removes
// THAT fresh lock instead of the stale one it judged, so two processes end
// up inside the critical section at once with no error from either side.
//
// Reproduced with N real child processes barrier-released against one
// pre-planted stale lock: with the original fs.rmSync(lock, {force:true})
// this reliably showed 2-8+ overlapping holds across 40 trials. A long
// chain of fixes were tried and measured worse, or looked clean locally
// but still failed under real contention, before landing on the real one
// — a rename-based "capture and verify" version had MORE overlaps than
// the original bug; a plain fs.unlinkSync swap was clean in isolation but
// flaked once under the full parallel smoke suite; a process.kill(pid, 0)
// liveness gate on top of that was clean locally but still failed once in
// CI; a readback-verification pass on top of THAT (only trust a `wx` open
// if reading the lock back shows exactly what was just written) closed
// two separate PRs' worth of CI failures locally but STILL failed twice
// more in CI — always on Node 18 (both x64 and arm64 runners; Node 20/22
// runners never failed). Stress-testing this exact retry loop under
// artificial CPU load (several `yes > /dev/null` processes running
// alongside the race) finally reproduced it outside CI: two separate
// processes could each `open(lock, "wx")` + write + read back and EACH
// see only its OWN content — meaning `open(O_CREAT|O_EXCL)` itself, not
// just the later unlink, was not reliably single-winner on Node 18 under
// load. The actual fix replaces the `wx`-open acquire with `fs.linkSync`
// (write a per-attempt temp file, then hard-link it onto the lock path) —
// `link(2)`'s exclusivity guarantee is the older, more battle-tested
// primitive for exactly this lockfile race (the classic Unix "lock via
// link" idiom), and it measured 0 double-winners across 15 trials at
// N=24 processes under the same artificial-load rig that reproduced the
// `wx`-open double-winner within single-digit trials.
//
// Even the linkSync acquire was not the end: PR #420's CI (arm64, Node 22)
// saw 2 concurrent holds again. The last hole was the steal path itself —
// judging a lock stale and unlinking it were still two steps with no
// exclusion between them, and unlink is not single-winner, so under enough
// load a slow judge could delete a NEW owner's lock. That gap cannot be
// closed from the judging side (there is no compare-and-delete), so it is
// now closed by exclusion: only the single-winner holder of a
// `<lock>.steal` guard (taken with the same linkSync acquire) may judge
// and delete, and the verdict is pinned to the exact judged file (same
// inode, same mtime) before the unlink. Under the same load rig (N=24,
// 6-core artificial load), the pre-guard code failed at trial 11 with 2
// concurrent holds; the guarded version ran 60/60 trials clean. See
// fs-atomic.ts's withFileLock doc comment for the full account. This test
// asserts the critical section is never entered by more than one process
// at a time.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const dist = path.join(pluginRoot, "dist");

const N = 8;
const TRIALS = 12;

const childSrc = `
const fs = require("node:fs");
const { withFileLock, durableAppendFileSync } = require(${JSON.stringify(path.join(dist, "shell", "fs-atomic.js"))});
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

function spawnAllAndWait(procs) {
  return Promise.all(procs.map((p) => new Promise((res, rej) => {
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`child exited ${code}`))));
    p.on("error", rej);
  })));
}

// One trial: plant a stale lock (mtime 60s in the past, so it is well past
// FILE_LOCK_STALE_MS), barrier-release N real child processes at it
// together, and return the max concurrent-hold depth seen in the log.
async function trial() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lock-steal-race-"));
  const target = path.join(base, "store.json");
  const lock = `${target}.lock`;
  const logFile = path.join(base, "log.txt");
  fs.writeFileSync(target, "{}\n", "utf8");
  fs.writeFileSync(lock, "999999@2020-01-01T00:00:00.000Z\n", "utf8");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);

  const child = path.join(base, "child.js");
  fs.writeFileSync(child, childSrc, "utf8");
  const goFile = path.join(base, "go");

  const procs = Array.from({ length: N }, (_, i) => {
    const readyFile = path.join(base, `ready-${i}`);
    return { readyFile, proc: spawn(node, [child, target, logFile, readyFile, goFile], { stdio: "ignore" }) };
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
