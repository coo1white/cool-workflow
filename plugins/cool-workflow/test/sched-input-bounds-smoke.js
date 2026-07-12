#!/usr/bin/env node
"use strict";

// sched-input-bounds smoke — hardens shell/scheduler-io.ts against bad input.
//
// Finding #10 (P2): schedule create() took negative/NaN numbers without a word
// — a `--interval -5` typo made a task whose nextRunAt sat in the past, a
// `maxRuns 0` or `ttlDays -1` made a task that could never run. The fix rejects
// each bad number by name (fail closed) instead of silently clamping it.
// interval 0 stays valid ("due now", a real supported value); only interval
// below 0 or non-whole is a typo — the narrow keeps the normal path unchanged.
//
// Finding #17 (P3): both stores forced schemaVersion to 1 on load, so a store
// written by a newer runtime was read as v1 with its extra fields dropped; and
// a corrupt (NaN) nextRunAt/expiresAt made `NaN <= now` false, so a task would
// silently never fire and never expire. The fix fails closed on an unknown
// store schemaVersion and treats a NaN date as due/expired, never silent.
//
// Fail-first: every assert.throws / due / expired check below passes only with
// the guards in place; against the pre-fix code the creates return a task, the
// loads return an empty list, and the corrupt task is neither due nor expired.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Scheduler, RoutineTriggerBridge } = require("../dist/shell/scheduler-io");

function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), tag));
}

// ---------------------------------------------------------------------------
// Finding #10 — create() rejects non-positive / non-finite numbers by name.
// ---------------------------------------------------------------------------
{
  const s = new Scheduler(freshDir("cw-sched-bounds-"));

  // interval must be a whole number of 0 or more (both option spellings). 0 is
  // a real supported value ("due now"), so it is NOT rejected; only a negative
  // or non-whole interval is the typo we fail closed on.
  assert.throws(() => s.create({ prompt: "x", intervalMinutes: -5 }), /interval must be a whole number of 0 or more/);
  assert.throws(() => s.create({ prompt: "x", interval: "-1" }), /interval must be a whole number of 0 or more/);
  assert.throws(() => s.create({ prompt: "x", intervalMinutes: 1.5 }), /interval must be a whole number of 0 or more/);
  assert.throws(() => s.create({ prompt: "x", intervalMinutes: "abc" }), /interval must be a whole number of 0 or more/);

  // interval 0 is a supported "due now" value: it creates and is immediately
  // due (nextRunAt is now or earlier), byte-identical to the pre-guard build.
  const zero = s.create({ prompt: "x", intervalMinutes: 0 });
  assert.equal(zero.intervalMinutes, 0);
  assert.ok(new Date(zero.nextRunAt).getTime() <= Date.now(), "an intervalMinutes:0 task is due now");
  const zeroAlt = s.create({ prompt: "x", interval: "0" });
  assert.equal(zeroAlt.intervalMinutes, 0);

  // jitter must be 0 or more.
  assert.throws(
    () => s.create({ prompt: "x", intervalMinutes: 5, jitterSeconds: -1 }),
    /jitterSeconds must be a number of 0 or more/
  );

  // maxRuns must be a whole number more than 0.
  assert.throws(() => s.create({ prompt: "x", intervalMinutes: 5, maxRuns: 0 }), /maxRuns must be a whole number more than 0/);
  assert.throws(() => s.create({ prompt: "x", intervalMinutes: 5, maxRuns: -2 }), /maxRuns must be a whole number more than 0/);

  // ttlDays must be more than 0 (a non-positive ttl makes an already-dead task).
  assert.throws(() => s.create({ prompt: "x", intervalMinutes: 5, ttlDays: 0 }), /ttlDays must be a number more than 0/);
  assert.throws(() => s.create({ prompt: "x", intervalMinutes: 5, ttlDays: -1 }), /ttlDays must be a number more than 0/);

  // delay must be 0 or more (0 = fire now, allowed).
  assert.throws(() => s.create({ kind: "reminder", prompt: "x", delayMinutes: -3 }), /delay must be a number of 0 or more/);

  // Valid values still create fine — no false rejects, same shape as before.
  const ok = s.create({ prompt: "x", intervalMinutes: 5, jitterSeconds: 30, maxRuns: 2, ttlDays: 1 });
  assert.equal(ok.intervalMinutes, 5);
  assert.equal(ok.maxRuns, 2);
  assert.equal(ok.jitterSeconds, 30);
  assert.ok(new Date(ok.nextRunAt).getTime() > Date.now(), "a valid loop still runs in the future");
  const rem = s.create({ kind: "reminder", prompt: "x", delayMinutes: 0, jitterSeconds: 0 });
  assert.equal(rem.kind, "reminder");
}

// ---------------------------------------------------------------------------
// Finding #17a — an unknown store schemaVersion fails closed on load.
// ---------------------------------------------------------------------------
{
  const dir = freshDir("cw-sched-schema-");
  const storePath = path.join(dir, ".cw", "schedules", "tasks.json");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ schemaVersion: 2, tasks: [], history: [] }));
  assert.throws(() => new Scheduler(dir).list(), /Unsupported schedule store schemaVersion: 2/);
}
{
  const dir = freshDir("cw-routine-schema-");
  const storePath = path.join(dir, ".cw", "routines", "triggers.json");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ schemaVersion: 9, triggers: [], events: [] }));
  assert.throws(() => new RoutineTriggerBridge(dir).list(), /Unsupported routine store schemaVersion: 9/);
}

// A v1 store, and a legacy store with no schemaVersion, both still load fine.
{
  const dir = freshDir("cw-sched-v1-");
  const storePath = path.join(dir, ".cw", "schedules", "tasks.json");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ tasks: [], history: [] })); // no schemaVersion
  assert.deepEqual(new Scheduler(dir).list(), []);
  fs.writeFileSync(storePath, JSON.stringify({ schemaVersion: 1, tasks: [], history: [] }));
  assert.deepEqual(new Scheduler(dir).list(), []);
}

// ---------------------------------------------------------------------------
// Finding #17b — a corrupt (NaN) date never makes a task silently sit inert.
// ---------------------------------------------------------------------------
{
  // A bad nextRunAt is treated as due, not silently skipped.
  const dir = freshDir("cw-sched-nan-next-");
  const s = new Scheduler(dir);
  const task = s.create({ prompt: "corrupt next", intervalMinutes: 5 });
  const storePath = path.join(dir, ".cw", "schedules", "tasks.json");
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  store.tasks[0].nextRunAt = "not-a-date";
  fs.writeFileSync(storePath, JSON.stringify(store));
  const due = s.due(new Date());
  assert.ok(due.some((t) => t.id === task.id), "a task with an unparseable nextRunAt is due, not silently skipped");
}
{
  // A bad expiresAt is treated as expired, not left active forever.
  const dir = freshDir("cw-sched-nan-exp-");
  const s = new Scheduler(dir);
  const task = s.create({ prompt: "corrupt expiry", intervalMinutes: 5 });
  const storePath = path.join(dir, ".cw", "schedules", "tasks.json");
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  store.tasks[0].expiresAt = "not-a-date";
  fs.writeFileSync(storePath, JSON.stringify(store));
  s.due(new Date());
  assert.equal(
    new Scheduler(dir).list().find((t) => t.id === task.id).status,
    "expired",
    "a task with an unparseable expiresAt is expired, not left active forever"
  );
}

process.stdout.write("sched-input-bounds smoke: ok (create rejects bad numbers, stores fail closed on unknown schemaVersion, NaN dates never sit inert)\n");
