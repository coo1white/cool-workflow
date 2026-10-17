#!/usr/bin/env node
// fs-atomic-owner-lock — pins acquireOwnerLock, the one lock implementation
// the drive mutex (run-store.ts withDriveLock) now shares with withFileLock:
// the same "<pid>@<ISO>\n" body, a live owner refuses at once through the
// caller's `refuse(ownerPid)` (never a wait, never a time steal), a dead
// owner's or this process's own leaked lock is taken over, re-entry is a
// no-op release, and release removes the lock only while this pid owns it.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { acquireOwnerLock, readLockOwnerPid, withFileLock } from "../../dist/shell/fs-atomic.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-fs-owner-"));
const BODY = new RegExp(`^${process.pid}@\\d{4}-\\d{2}-\\d{2}T[^\\n]+Z\\n$`);
const refuse = (ownerPid) => new Error(`refused pid=${ownerPid}`);

// --- Acquire on a free path: creates the parent dir, writes the shared body
// shape, leaves no tmp files; release removes the lock.
{
  const lock = path.join(tmp, "a", "drive.lock");
  const release = acquireOwnerLock(lock, refuse);
  assert.match(fs.readFileSync(lock, "utf8"), BODY, "the owner lock body is \"<pid>@<ISO>\\n\"");
  assert.equal(readLockOwnerPid(lock), process.pid);
  assert.deepEqual(fs.readdirSync(path.dirname(lock)), ["drive.lock"], "no per-attempt tmp file is left behind");
  // Re-entry inside one process returns a no-op release.
  const inner = acquireOwnerLock(lock, refuse);
  inner();
  assert.ok(fs.existsSync(lock), "the re-entered release must not remove the lock");
  release();
  assert.ok(!fs.existsSync(lock), "release removes the lock");
}

// --- withFileLock writes the same body shape: one lock format for both.
{
  const target = path.join(tmp, "b", "state.json");
  withFileLock(target, () => {
    assert.match(fs.readFileSync(`${target}.lock`, "utf8"), BODY, "withFileLock body has the same shape");
  });
}

// --- A LIVE owner refuses at once with the caller's error, even when the
// lock is far past withFileLock's 30s stale window (never time-stolen).
{
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    const lock = path.join(tmp, "c", "drive.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, `${child.pid}@2000-01-01T00:00:00.000Z\n`);
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(lock, old, old);
    const startedAt = Date.now();
    assert.throws(() => acquireOwnerLock(lock, refuse), new RegExp(`^Error: refused pid=${child.pid}$`));
    assert.ok(Date.now() - startedAt < 1000, "a live owner refuses at once, no wait");
    assert.equal(fs.readFileSync(lock, "utf8"), `${child.pid}@2000-01-01T00:00:00.000Z\n`, "a live owner's lock is untouched");
    assert.deepEqual(fs.readdirSync(path.dirname(lock)), ["drive.lock"], "no tmp file is left behind on refusal");
  } finally {
    child.kill("SIGKILL");
  }
}

// --- A DEAD owner's lock, a body with no pid, and this process's own leaked
// lock are all taken over.
{
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const deadPid = dead.pid;
  const waitExit = new Promise((resolve) => dead.on("exit", resolve));
  waitExit.then(() => {
    for (const [name, body] of [
      ["dead", `${deadPid}@2000-01-01T00:00:00.000Z\n`],
      ["junk", "not-a-lock-body"],
      ["own", `${process.pid}@2000-01-01T00:00:00.000Z\n`]
    ]) {
      const lock = path.join(tmp, `d-${name}`, "drive.lock");
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      fs.writeFileSync(lock, body);
      const release = acquireOwnerLock(lock, refuse);
      assert.match(fs.readFileSync(lock, "utf8"), BODY, `${name}: the lock is now ours`);
      release();
      assert.ok(!fs.existsSync(lock), `${name}: released`);
    }

    // --- Release leaves a lock that another owner took meanwhile.
    {
      const lock = path.join(tmp, "e", "drive.lock");
      const release = acquireOwnerLock(lock, refuse);
      fs.writeFileSync(lock, "1@2000-01-01T00:00:00.000Z\n");
      release();
      assert.equal(fs.readFileSync(lock, "utf8"), "1@2000-01-01T00:00:00.000Z\n", "release must not remove another owner's lock");
    }

    // --- readLockOwnerPid: 0 for a missing lock or a body with no pid.
    assert.equal(readLockOwnerPid(path.join(tmp, "missing.lock")), 0);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("fs-atomic-owner-lock: ok");
  });
}
