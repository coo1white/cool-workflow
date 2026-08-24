#!/usr/bin/env node
// fs-atomic-lock-reentrant — pins withFileLock's in-process re-entry
// (HELD_LOCKS): a nested call on the SAME target runs its fn at once under
// the already-held lock (no self-deadlock, no acquire-budget wait), the
// inner call never removes the lock, re-entry is keyed by the RESOLVED
// path, and the lock is released even when fn throws.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeJson, withFileLock } = require("../dist/shell/fs-atomic");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-fs-reent-"));

// --- Nested call on the SAME target: runs at once, keeps the lock held,
// and only the OUTER exit removes the lock file.
{
  const target = path.join(tmp, "same.json");
  writeJson(target, { n: 0 });
  const lock = `${target}.lock`;
  let innerRan = false;
  const startedAt = Date.now();
  withFileLock(target, () => {
    assert.ok(fs.existsSync(lock), "the outer call holds the lock");
    const bodyBefore = fs.readFileSync(lock, "utf8");
    withFileLock(target, () => {
      innerRan = true;
      assert.ok(fs.existsSync(lock), "the lock is still there inside the nested call");
    });
    assert.ok(fs.existsSync(lock), "the nested call must NOT remove the lock on its way out");
    assert.equal(fs.readFileSync(lock, "utf8"), bodyBefore, "the nested call must not touch the lock body");
  });
  const elapsedMs = Date.now() - startedAt;
  assert.ok(innerRan, "the nested fn ran");
  assert.ok(!fs.existsSync(lock), "the outer exit removes the lock");
  // The acquire budget is ~6s. A nested call that waited on its own lock
  // would burn all of it and then throw; well under 3s proves it did not.
  assert.ok(elapsedMs < 3000, `re-entry must be at once, not a budget wait (took ${elapsedMs}ms)`);
}

// --- Re-entry is keyed by the RESOLVED lock path: the same target named
// through a ".." hop is still the same lock.
{
  const dir = path.join(tmp, "keyed");
  const target = path.join(dir, "t.json");
  writeJson(target, { n: 0 });
  const alias = path.join(dir, "..", "keyed", "t.json");
  let innerRan = false;
  const startedAt = Date.now();
  withFileLock(target, () => {
    withFileLock(alias, () => {
      innerRan = true;
    });
  });
  assert.ok(innerRan, "the alias path re-enters the same held lock");
  assert.ok(Date.now() - startedAt < 3000, "no budget wait on the alias path");
  assert.ok(!fs.existsSync(`${target}.lock`), "released after the outer exit");
}

// --- Different targets nest normally: each gets its own lock, and the
// inner release does not touch the outer lock.
{
  const a = path.join(tmp, "a.json");
  const b = path.join(tmp, "b.json");
  writeJson(a, { n: 0 });
  writeJson(b, { n: 0 });
  withFileLock(a, () => {
    withFileLock(b, () => {
      assert.ok(fs.existsSync(`${a}.lock`), "outer lock held");
      assert.ok(fs.existsSync(`${b}.lock`), "inner lock held");
    });
    assert.ok(!fs.existsSync(`${b}.lock`), "inner lock released on inner exit");
    assert.ok(fs.existsSync(`${a}.lock`), "outer lock still held after the inner exit");
  });
  assert.ok(!fs.existsSync(`${a}.lock`), "outer lock released");
}

// --- A throw inside fn still releases the lock AND the held-lock note, so
// the next acquire on the same target is at once, not a stale-steal wait.
{
  const target = path.join(tmp, "throwing.json");
  writeJson(target, { n: 0 });
  assert.throws(
    () =>
      withFileLock(target, () => {
        throw new Error("boom");
      }),
    /boom/,
    "the fn error comes through unchanged"
  );
  assert.ok(!fs.existsSync(`${target}.lock`), "the lock is released on the error path");

  const startedAt = Date.now();
  let ranAgain = false;
  withFileLock(target, () => {
    ranAgain = true;
    // If HELD_LOCKS kept the old key, this nested call would be a wrong
    // re-entry; if it lost the release, the acquire above would have waited.
    withFileLock(target, () => {});
  });
  assert.ok(ranAgain, "a fresh acquire works after the error");
  assert.ok(Date.now() - startedAt < 3000, "the fresh acquire is at once");
}

process.stdout.write("fs-atomic-lock-reentrant: ok\n");
