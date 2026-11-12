#!/usr/bin/env node
// fs-atomic-lock — tryLock/unlock: one holder at a time, a lock left by a
// dead pid is taken over, a live holder is respected, and unlock only
// removes this process's own lock. withFileLock is re-entrant in-process.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isContainedPath, lockHolder, tryLock, unlock, withFileLock, assertSafeRunId } from "../../dist/shell/fs-atomic.js";
import { tmpDir } from "../helpers/workspace.mjs";

const dir = tmpDir("cw-lock-");
const lock = path.join(dir, "a.lock");

assert.equal(tryLock(lock), true, "a free lock is taken");
assert.equal(fs.readFileSync(lock, "utf8").trim(), String(process.pid));
assert.equal(tryLock(lock), false, "a held lock (live pid) is not taken twice");
assert.equal(lockHolder(lock), process.pid);
unlock(lock);
assert.equal(fs.existsSync(lock), false, "unlock removes our own lock");

// A dead holder's lock is taken over.
const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
fs.writeFileSync(lock, `${dead.stdout}\n`);
assert.equal(lockHolder(lock), undefined, "a dead pid holds nothing");
assert.equal(tryLock(lock), true, "a stale lock is taken over");
assert.equal(fs.readFileSync(lock, "utf8").trim(), String(process.pid));
unlock(lock);

// unlock never removes another process's lock.
fs.writeFileSync(lock, "1\n");
unlock(lock);
assert.equal(fs.existsSync(lock), true, "another pid's lock is left alone");
fs.rmSync(lock);

// withFileLock is re-entrant and releases on return.
const target = path.join(dir, "state.json");
const value = withFileLock(target, () => withFileLock(target, () => 7));
assert.equal(value, 7);
assert.equal(fs.existsSync(`${target}.lock`), false, "the lock is released");

assert.equal(isContainedPath(path.join(dir, "x", "y"), dir), true);
assert.equal(isContainedPath(path.join(dir, "..", "y"), dir), false);
assert.equal(assertSafeRunId("architecture-review-1"), "architecture-review-1");
for (const bad of ["..", ".", "a/b", "", "a\\b"]) assert.throws(() => assertSafeRunId(bad), `${JSON.stringify(bad)} is refused`);

console.log("fs-atomic-lock: ok");
