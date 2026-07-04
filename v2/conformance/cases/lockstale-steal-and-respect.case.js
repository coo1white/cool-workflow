#!/usr/bin/env node
"use strict";

// withFileLock (state-core.md "Lock protocol"): the lock file is
// "<runDir>/state.json.lock", body "<pid>@<ISO>\n", made with O_EXCL.
// A lock older than FILE_LOCK_STALE_MS (30_000 ms) is stolen (deleted,
// retried at once) instead of blocking the caller. A lock that is NOT
// yet stale is respected: the caller waits (up to 240 tries x 25 ms)
// until it is free.
//
// Both cases here fabricate the ON-DISK lock state a second process
// would have left behind, then drive ONE real `cw summary show` (which
// calls saveCheckpoint -> withFileLock(state.json, ...)) against it and
// observe the deterministic reaction. No real concurrent CW processes
// are spawned, so there is no timing flake.
//
//   1. STALE-LOCK-IS-STOLEN: a lock body from a fake pid, backdated
//      mtime > 30s -> cw proceeds fast (steals it), and the state.json
//      mtime moves (saveCheckpoint really ran), and no stale lock file
//      is left over.
//   2. FRESH-LOCK-IS-RESPECTED: a lock body from a fake pid, mtime just
//      now, released by a background timer after ~1.5s -> cw waits for
//      it (does not steal early) and succeeds once it is gone; the
//      elapsed wall time is at least the hold time.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { run, gitRepo, freshDir, caseMain, assert, stubAgentEnv } = require("../lib");

function makeRun() {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0, "seed run must succeed");
  const payload = JSON.parse(r.stdout);
  return { repo, runId: payload.runId, statePath: payload.statePath };
}

caseMain(async () => {
  // --- 1. a stale lock (backdated > 30s, fake pid) is stolen, not respected ---
  {
    const { repo, runId, statePath } = makeRun();
    const lockPath = `${statePath}.lock`;
    const beforeMtime = fs.statSync(statePath).mtimeMs;

    const fakePid = 999999;
    fs.writeFileSync(lockPath, `${fakePid}@2020-01-01T00:00:00.000Z\n`);
    const staleTime = new Date(Date.now() - 60_000); // 60s old: past FILE_LOCK_STALE_MS (30s)
    fs.utimesSync(lockPath, staleTime, staleTime);
    assert.ok(fs.existsSync(lockPath), "fabricated stale lock must exist before the op");

    const t0 = Date.now();
    const show = run(["summary", "show", runId, "--json"], { cwd: repo });
    const elapsedMs = Date.now() - t0;

    assert.equal(show.status, 0, `stale lock must be stolen, not block: ${show.stderr}`);
    // A blocked caller would wait up to 240*25ms = 6000ms; stealing is
    // near-instant. Give generous headroom for a slow CI box.
    assert.ok(elapsedMs < 4000, `expected a fast steal, took ${elapsedMs}ms`);

    // The lock is gone again on normal completion (released by the real
    // owner, not left as the fake pid's file).
    assert.ok(!fs.existsSync(lockPath), "no stale lock file should remain after a clean op");

    // saveCheckpoint really ran under the new lock: state.json was rewritten.
    const afterMtime = fs.statSync(statePath).mtimeMs;
    assert.ok(afterMtime > beforeMtime, "state.json must be rewritten by the stealing process");

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.schemaVersion, 1);
    void repo;
  }

  // --- 2. a fresh lock (recent mtime, fake pid) is respected: cw waits ---
  {
    const { repo, runId, statePath } = makeRun();
    const lockPath = `${statePath}.lock`;

    const fakePid = 999998;
    const holdMs = 1500;
    fs.writeFileSync(lockPath, `${fakePid}@${new Date().toISOString()}\n`);
    // mtime is "now" -- nowhere near the 30s stale threshold.
    assert.ok(fs.existsSync(lockPath), "fabricated fresh lock must exist before the op");

    // Release it after holdMs from a small detached helper, standing in
    // for "the other process finishes and releases its own lock" --
    // this is the one direction the spec says is affordable to wait out
    // for real (240 x 25ms = 6s max bound), no fabrication of the
    // release needed.
    const helperDir = freshDir("lock-release-helper");
    const helperScript = path.join(helperDir, "release.js");
    fs.writeFileSync(
      helperScript,
      [
        "setTimeout(() => {",
        "  try {",
        `    require("fs").unlinkSync(${JSON.stringify(lockPath)});`,
        "  } catch (e) {}",
        `}, ${holdMs});`,
      ].join("\n")
    );
    const child = spawn(process.execPath, [helperScript], { detached: true, stdio: "ignore" });
    child.unref();

    const t0 = Date.now();
    const show = run(["summary", "show", runId, "--json"], { cwd: repo });
    const elapsedMs = Date.now() - t0;

    assert.equal(show.status, 0, `must succeed once the fresh lock is released: ${show.stderr}`);
    // It must have actually waited for the release, not stolen the
    // fresh lock early -- elapsed time is at least close to the hold
    // time (allow some slack under the 25ms poll granularity).
    assert.ok(
      elapsedMs >= holdMs - 200,
      `expected cw to wait out the fresh lock (>= ~${holdMs}ms), took ${elapsedMs}ms`
    );
    assert.ok(!fs.existsSync(lockPath), "lock must be gone after a clean completed op");

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.schemaVersion, 1);
    void repo;
  }
});
