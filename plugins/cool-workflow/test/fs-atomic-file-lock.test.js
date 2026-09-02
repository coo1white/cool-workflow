#!/usr/bin/env node
// fs-atomic-file-lock (milestone 0) — pins withFileLock's exact protocol per
// project/docs/rebuild/PLAN.md byte-compat item 6 and SPEC/state-core.md "Lock protocol":
// O_EXCL lock body "<pid>@<ISO>\n", stale-lock steal (30s window), refresh-
// before, verify-after (never delete a stolen lock), and serialized RMW.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeJson, readJson, withFileLock } = require("../dist/shell/fs-atomic");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-v2-fs-lock-"));

// --- Lock file body format: "<pid>@<ISO>\n" -- observed DURING the critical
// section (the lock is removed after fn() returns on the normal path).
{
  const target = path.join(tmp, "body-check.json");
  writeJson(target, { n: 0 });
  let bodySeenDuringCriticalSection = null;
  withFileLock(target, () => {
    bodySeenDuringCriticalSection = fs.readFileSync(`${target}.lock`, "utf8");
  });
  assert.match(
    bodySeenDuringCriticalSection,
    /^\d+@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n$/,
    'lock body must be exactly "<pid>@<ISO>\\n"'
  );
  assert.ok(
    bodySeenDuringCriticalSection.startsWith(`${process.pid}@`),
    "lock body must start with this process's pid"
  );
  assert.ok(!fs.existsSync(`${target}.lock`), "the lock file must be removed after the critical section");
}

// --- Serialized read-modify-write: sequential locked increments never lose
// an update.
{
  const counterFile = path.join(tmp, "counter.json");
  writeJson(counterFile, { n: 0 });
  for (let i = 0; i < 10; i++) {
    withFileLock(counterFile, () => {
      const cur = readJson(counterFile).n;
      writeJson(counterFile, { n: cur + 1 });
    });
  }
  assert.equal(readJson(counterFile).n, 10, "locked RMW must never lose an update");
}

// --- A stale lock (older than FILE_LOCK_STALE_MS = 30_000) is stolen, not
// deadlocked.
{
  const target = path.join(tmp, "stale.json");
  writeJson(target, { n: 0 });
  const lock = `${target}.lock`;
  fs.writeFileSync(lock, "9999@stale\n");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  let ran = false;
  withFileLock(target, () => {
    ran = true;
  });
  assert.ok(ran, "a stale lock must be stolen rather than wedging the store");
  assert.ok(!fs.existsSync(lock), "the lock must be released after the critical section completes normally");
}

// --- A FRESH lock (within the steal window) blocks acquisition until it is
// released. We simulate this synchronously: hold a lock file open (as
// another "process" would), then confirm withFileLock cannot acquire it
// immediately and instead throws after exhausting its retry budget (we
// shrink the wait by removing the lock partway through via a timer so the
// happy path stays fast, then separately prove the immediate-EEXIST path
// really does retry rather than acquire instantly).
{
  const target = path.join(tmp, "fresh-contended.json");
  writeJson(target, { n: 0 });
  const lock = `${target}.lock`;
  // Plant a fresh (non-stale) lock as if another live process holds it.
  fs.writeFileSync(lock, `${process.pid + 1}@${new Date().toISOString()}\n`);

  // Release it shortly after withFileLock starts retrying, from a separate
  // async tick — withFileLock's retry loop is synchronous (Atomics.wait), so
  // we schedule the release via a child process racing against it instead of
  // an in-process timer (an in-process timer cannot fire during a
  // synchronous busy/blocking wait).
  const releaseAfterMs = 50;
  // The -e code is a static string; the lock path and delay ride as argv —
  // never build code from a path.
  const releaser = require("node:child_process").spawn(
    process.execPath,
    [
      "-e",
      'setTimeout(() => { try { require("fs").rmSync(process.argv[1], { force: true }); } catch {} }, Number(process.argv[2]));',
      lock,
      String(releaseAfterMs)
    ],
    { stdio: "ignore" }
  );

  let ran = false;
  withFileLock(target, () => {
    ran = true;
  });
  assert.ok(ran, "withFileLock must eventually acquire the lock once the contending holder releases it");
  releaser.kill();
}

// --- Verify-after: a lock stolen mid-critical-section must make the holder
// throw the "stolen" error and must NOT delete the thief's lock.
{
  const target = path.join(tmp, "stolen.json");
  writeJson(target, { n: 0 });
  const lock = `${target}.lock`;

  let threw = null;
  try {
    withFileLock(target, () => {
      // Simulate another process stealing the lock mid-operation: overwrite
      // the lock body with a different pid, as the steal-and-retry path would.
      fs.writeFileSync(lock, "424242@2020-01-01T00:00:00.000Z\n");
    });
  } catch (error) {
    threw = error;
  }
  assert.ok(threw instanceof Error, "a stolen lock must cause withFileLock to throw");
  assert.match(
    threw.message,
    /was stolen during the critical section/,
    "the thrown error must be the exact 'stolen' error message"
  );
  assert.ok(
    threw.message.includes(target),
    "the stolen-lock error must name the target path"
  );
  // The thief's lock must NOT have been deleted by the original holder.
  assert.ok(fs.existsSync(lock), "a stolen lock must NOT be deleted by the original holder");
  assert.equal(
    fs.readFileSync(lock, "utf8"),
    "424242@2020-01-01T00:00:00.000Z\n",
    "the thief's lock body must be left exactly as the thief wrote it"
  );
}

// --- No lock after exhausting the acquire budget throws the exact message.
// We force this deterministically by pre-creating a FRESH lock (never stale,
// never removed) and letting the wall-clock acquire budget
// (FILE_LOCK_ACQUIRE_BUDGET_MS, ~6s) run out. This is slow (~6s) but
// exercises the real retry ceiling exactly once.
{
  const target = path.join(tmp, "unavailable.json");
  writeJson(target, { n: 0 });
  const lock = `${target}.lock`;
  fs.writeFileSync(lock, `999999@${new Date().toISOString()}\n`); // fresh, never stale within this test

  assert.throws(
    () => withFileLock(target, () => {}),
    (err) => err.message === `could not acquire file lock for ${target}`,
    "exhausting all retries must throw the exact 'could not acquire file lock for <path>' message"
  );
  fs.rmSync(lock, { force: true });
}

process.stdout.write("fs-atomic-file-lock: ok\n");
