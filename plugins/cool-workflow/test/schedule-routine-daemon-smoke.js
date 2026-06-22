#!/usr/bin/env node
"use strict";

// schedule-routine-daemon smoke — the scheduling subsystem's first real test.
//
// Before this smoke, coverage measurement showed scheduler.ts at 12.7%,
// triggers.ts at 18.7% and daemon.ts at 29.7% line coverage: the only thing
// any gate exercised was `schedule list`. Everything a user actually does with
// schedules — create/pause/resume/complete/run-now/history/delete, cron and
// interval nextRunAt math, TTL expiry, due-event dedup, routine trigger
// create/fire/match with payload persistence, and the desktop daemon tick —
// shipped with zero assertions. This smoke covers that surface twice over:
// directly against the dist modules (deterministic time injection via due(now))
// and through the CLI commands users type (loop, schedule …, routine …,
// schedule daemon --once). Fail-closed paths (unknown kind, missing prompt,
// cron without --cron, unknown id, malformed match JSON) are asserted by name.

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-schedule-routine-"));

const { Scheduler } = require("../dist/scheduler");
const { RoutineTriggerBridge } = require("../dist/triggers");
const { DesktopSchedulerDaemon } = require("../dist/daemon");

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function backdateNextRunAt(cwd, taskId) {
  const taskStorePath = path.join(cwd, ".cw", "schedules", "tasks.json");
  const taskStore = JSON.parse(fs.readFileSync(taskStorePath, "utf8"));
  taskStore.tasks.find((task) => task.id === taskId).nextRunAt = new Date(Date.now() - MINUTE).toISOString();
  fs.writeFileSync(taskStorePath, JSON.stringify(taskStore), "utf8");
}

// ---------------------------------------------------------------------------
// Scheduler — direct module surface with injected time.
// ---------------------------------------------------------------------------

const scheduler = new Scheduler(tmp);

// create(loop): nextRunAt = now + interval, default 7-day TTL, active, runCount 0.
const before = Date.now();
const loopTask = scheduler.create({ prompt: "loop every 5 minutes", intervalMinutes: 5 });
const after = Date.now();
assert.equal(loopTask.kind, "loop");
assert.equal(loopTask.status, "active");
assert.equal(loopTask.runCount, 0);
const loopNext = new Date(loopTask.nextRunAt).getTime();
assert.ok(loopNext >= before + 5 * MINUTE && loopNext <= after + 5 * MINUTE, "loop nextRunAt = now + interval");
const loopExpires = new Date(loopTask.expiresAt).getTime();
assert.ok(loopExpires >= before + 7 * DAY && loopExpires <= after + 7 * DAY, "default ttl is 7 days");

// create(reminder): delay positions nextRunAt; completing a reminder finishes it.
const reminder = scheduler.create({ kind: "reminder", prompt: "remind once", delayMinutes: 2, ttlDays: 1 });
const reminderNext = new Date(reminder.nextRunAt).getTime();
assert.ok(reminderNext >= before + 2 * MINUTE, "reminder honors delayMinutes");

// create(cron): next run lands exactly on the requested minute/hour, seconds zeroed.
const cronTask = scheduler.create({ kind: "cron", prompt: "cron */15", cron: "*/15 * * * *" });
const cronNext = new Date(cronTask.nextRunAt);
assert.equal(cronNext.getMinutes() % 15, 0, "*/15 cron lands on a 15-minute boundary");
assert.equal(cronNext.getSeconds(), 0);
assert.ok(cronNext.getTime() > before, "cron nextRunAt is in the future");

const daily = scheduler.create({ kind: "cron", prompt: "daily at 14:30", cron: "30 14 * * *" });
const dailyNext = new Date(daily.nextRunAt);
assert.equal(dailyNext.getMinutes(), 30);
assert.equal(dailyNext.getHours(), 14);
assert.ok(dailyNext.getTime() - before <= 8 * DAY, "cron resolves within the 8-day search window");

// create with jitter: nextRunAt lands inside [base, base + jitter].
const jittered = scheduler.create({ prompt: "jittered loop", intervalMinutes: 1, jitterSeconds: 30 });
const jitterNext = new Date(jittered.nextRunAt).getTime();
assert.ok(jitterNext >= before + 1 * MINUTE, "jitter never moves the run earlier");
assert.ok(jitterNext <= Date.now() + 1 * MINUTE + 31 * 1000, "jitter bounded by jitterSeconds");

// Fail closed by name: bad kind, missing prompt, cron without expression,
// malformed cron, unknown id.
assert.throws(() => scheduler.create({ kind: "hourly", prompt: "x" }), /Unsupported schedule kind: hourly/);
assert.throws(() => scheduler.create({ intervalMinutes: 5 }), /Missing required prompt/);
assert.throws(() => scheduler.create({ kind: "cron", prompt: "x" }), /cron schedule requires --cron/);
assert.throws(
  () => scheduler.create({ kind: "cron", prompt: "x", cron: "* * *" }),
  /Only 5-field cron expressions are supported/
);
assert.throws(() => scheduler.complete("missing-id"), /Scheduled task not found: missing-id/);
assert.throws(() => scheduler.pause("missing-id"), /Scheduled task not found: missing-id/);

// list + status filter.
assert.equal(scheduler.list().length, 5);
assert.equal(scheduler.list("active").length, 5);
assert.equal(scheduler.list("paused").length, 0);

// pause excludes from due; resume with a stale nextRunAt advances it.
scheduler.pause(loopTask.id);
assert.equal(scheduler.list("paused").length, 1);
const wayLater = new Date(Date.now() + 30 * MINUTE);
assert.ok(!scheduler.due(wayLater).some((task) => task.id === loopTask.id), "paused task is never due");
// Backdate the stored nextRunAt so resume sees a run that already passed
// (resume compares against the wall clock, not an injected now).
backdateNextRunAt(tmp, loopTask.id);
const resumed = scheduler.resume(loopTask.id);
assert.equal(resumed.status, "active");
assert.ok(
  new Date(resumed.nextRunAt).getTime() > Date.now(),
  "resume advances a nextRunAt that already passed"
);

// due(now): records one history entry per due transition — no duplicates on re-poll.
const dueAt = new Date(new Date(resumed.nextRunAt).getTime() + 1000);
const firstPoll = scheduler.due(dueAt);
assert.ok(firstPoll.some((task) => task.id === loopTask.id), "task is due once nextRunAt passes");
const dueRecords = () =>
  scheduler.history(loopTask.id).filter((record) => record.status === "due").length;
assert.equal(dueRecords(), 1);
scheduler.due(dueAt);
assert.equal(dueRecords(), 1, "re-polling the same dueness adds no duplicate history record");

// complete(loop): increments runCount, schedules the next run; maxRuns finishes it.
const completedOnce = scheduler.complete(loopTask.id, { maxRuns: 2 });
assert.equal(completedOnce.runCount, 1);
assert.equal(completedOnce.status, "active");
assert.ok(new Date(completedOnce.nextRunAt).getTime() > Date.now(), "loop reschedules after completion");
const completedTwice = scheduler.complete(loopTask.id);
assert.equal(completedTwice.runCount, 2);
assert.equal(completedTwice.status, "completed", "maxRuns reached finishes the schedule");

// complete(reminder): one shot, no reschedule.
const reminderDone = scheduler.complete(reminder.id);
assert.equal(reminderDone.status, "completed");

// TTL expiry: a now beyond expiresAt flips the task to expired and out of dueness.
const pastExpiry = new Date(new Date(cronTask.expiresAt).getTime() + 1000);
assert.ok(!scheduler.due(pastExpiry).some((task) => task.id === cronTask.id), "expired task is not due");
assert.equal(scheduler.list().find((task) => task.id === cronTask.id).status, "expired");

// runNow: explicit start writes a "started" history record.
const startedRecord = scheduler.runNow(daily.id);
assert.equal(startedRecord.status, "started");
assert.equal(startedRecord.scheduleId, daily.id);
assert.ok(scheduler.history(daily.id).some((record) => record.id === startedRecord.id));

// delete: true once, false for the already-gone id.
assert.equal(scheduler.delete(jittered.id).deleted, true);
assert.equal(scheduler.delete(jittered.id).deleted, false);

// Store tolerance: a partial store (no arrays) loads as empty, not a crash.
const partialDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-schedule-partial-"));
const partialStorePath = path.join(partialDir, ".cw", "schedules", "tasks.json");
fs.mkdirSync(path.dirname(partialStorePath), { recursive: true });
fs.writeFileSync(partialStorePath, JSON.stringify({ schemaVersion: 1 }), "utf8");
assert.deepEqual(new Scheduler(partialDir).list(), []);

// ---------------------------------------------------------------------------
// RoutineTriggerBridge — create/fire/match/events with payload persistence.
// ---------------------------------------------------------------------------

const triggers = new RoutineTriggerBridge(tmp);

const apiTrigger = triggers.create({ prompt: "react to opened PRs", match: { action: "opened" } });
assert.equal(apiTrigger.kind, "api");
const githubTrigger = triggers.create({
  kind: "github",
  prompt: "react to merged PRs",
  match: '{"pull_request.state": "merged"}'
});
assert.equal(githubTrigger.kind, "github");

assert.throws(() => triggers.create({ kind: "slack", prompt: "x" }), /Unsupported routine trigger kind: slack/);
assert.throws(() => triggers.create({ kind: "api" }), /Missing required prompt/);
assert.throws(() => triggers.create({ prompt: "x", match: "[1,2]" }), /Expected JSON object/);

assert.equal(triggers.list().length, 2);
assert.equal(triggers.list("github").length, 1);

// fire: matching payload → matched event with a rendered cw:routine prompt;
// the full payload is persisted to payloadPath either way.
const matchedEvents = triggers.fire("api", { action: "opened", number: 7 });
assert.equal(matchedEvents.length, 1);
assert.equal(matchedEvents[0].matched, true);
assert.match(matchedEvents[0].prompt, /react to opened PRs/);
assert.match(matchedEvents[0].prompt, /cw:routine/);
assert.match(matchedEvents[0].prompt, new RegExp(apiTrigger.id));
const persisted = JSON.parse(fs.readFileSync(matchedEvents[0].payloadPath, "utf8"));
assert.equal(persisted.schemaVersion, 1);
assert.equal(persisted.matched, true);
assert.deepEqual(persisted.payload, { action: "opened", number: 7 });

// Non-matching payload → recorded but unmatched, no prompt rendered.
const unmatchedEvents = triggers.fire("api", { action: "closed" });
assert.equal(unmatchedEvents[0].matched, false);
assert.equal(unmatchedEvents[0].prompt, undefined);

// Deep dotted-key match against a nested payload; non-object payload never matches.
const deepEvents = triggers.fire("github", { pull_request: { state: "merged" } });
assert.equal(deepEvents[0].matched, true);
assert.equal(triggers.fire("github", "not-an-object")[0].matched, false);

assert.throws(() => triggers.fire("slack", {}), /Unsupported routine trigger kind: slack/);

// events filter + delete semantics.
assert.equal(triggers.events(apiTrigger.id).length, 2);
assert.equal(triggers.events().length, 4);
assert.equal(triggers.delete(githubTrigger.id).deleted, true);
assert.equal(triggers.delete(githubTrigger.id).deleted, false);

// An empty match object matches everything.
const catchAll = triggers.create({ prompt: "catch all", match: {} });
assert.equal(triggers.fire("api", { anything: true }).find((e) => e.triggerId === catchAll.id).matched, true);

// ---------------------------------------------------------------------------
// DesktopSchedulerDaemon — tick writes the due inbox.
// ---------------------------------------------------------------------------

const daemonDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-daemon-"));
const daemonScheduler = new Scheduler(daemonDir);
const dueSoon = daemonScheduler.create({ prompt: "daemon picks me up", intervalMinutes: 1 });
// Backdate nextRunAt so the daemon's wall-clock tick sees a due task.
backdateNextRunAt(daemonDir, dueSoon.id);

const daemon = new DesktopSchedulerDaemon({ cwd: daemonDir, intervalSeconds: 1 });
const tick = daemon.tick();
assert.equal(tick.dueCount, 1);
assert.deepEqual(tick.dueIds, [dueSoon.id]);
const inbox = JSON.parse(fs.readFileSync(tick.inboxPath, "utf8"));
assert.equal(inbox.schemaVersion, 1);
assert.equal(inbox.due.length, 1);
assert.equal(inbox.due[0].id, dueSoon.id);

// ---------------------------------------------------------------------------
// CLI surface — the same operations through the commands users type.
// ---------------------------------------------------------------------------

const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-schedule-cli-"));

function runJson(args) {
  return JSON.parse(
    execFileSync(node, [cli, ...args], { cwd: cliDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  );
}

function runFail(args) {
  const result = spawnSync(node, [cli, ...args], { cwd: cliDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.notEqual(result.status, 0, `expected failure: cw ${args.join(" ")}`);
  return result;
}

// loop is sugar for schedule create --kind loop.
const cliLoop = runJson(["loop", "--prompt", "cli loop", "--interval", "3"]);
assert.equal(cliLoop.kind, "loop");
assert.equal(cliLoop.intervalMinutes, 3);

const cliCron = runJson(["schedule", "create", "--kind", "cron", "--prompt", "cli cron", "--cron", "0 9 * * 1"]);
assert.equal(new Date(cliCron.nextRunAt).getDay(), 1, "monday-only cron lands on a Monday");
assert.equal(new Date(cliCron.nextRunAt).getHours(), 9);

assert.equal(runJson(["schedule", "list"]).length, 2);
assert.equal(runJson(["schedule", "pause", cliLoop.id]).status, "paused");
assert.equal(runJson(["schedule", "list", "--status", "paused"]).length, 1);
assert.equal(runJson(["schedule", "resume", cliLoop.id]).status, "active");
assert.equal(runJson(["schedule", "complete", cliLoop.id]).runCount, 1);
assert.equal(runJson(["schedule", "run-now", cliLoop.id]).status, "started");
assert.ok(runJson(["schedule", "history", cliLoop.id]).length >= 1);
assert.ok(Array.isArray(runJson(["schedule", "due"])));
assert.equal(runJson(["schedule", "delete", cliCron.id]).deleted, true);

const cliDaemonTick = runJson(["schedule", "daemon", "--once"]);
assert.equal(typeof cliDaemonTick.dueCount, "number");
assert.ok(fs.existsSync(cliDaemonTick.inboxPath));

const cliTrigger = runJson(["routine", "create", "--prompt", "cli routine", "--match", '{"action":"opened"}']);
assert.equal(cliTrigger.kind, "api");
assert.equal(runJson(["routine", "list"]).length, 1);
const payloadFile = path.join(cliDir, "payload.json");
fs.writeFileSync(payloadFile, JSON.stringify({ action: "opened" }), "utf8");
const cliEvents = runJson(["routine", "fire", "api", payloadFile]);
assert.equal(cliEvents[0].matched, true);
assert.equal(runJson(["routine", "events", cliTrigger.id]).length, 1);
assert.equal(runJson(["routine", "delete", cliTrigger.id]).deleted, true);

// CLI fails closed with named refusals.
assert.match(runFail(["schedule", "create", "--kind", "cron", "--prompt", "x"]).stderr, /cron schedule requires --cron/);
assert.match(runFail(["schedule", "complete", "missing-id"]).stderr, /Scheduled task not found: missing-id/);
assert.match(runFail(["routine", "create"]).stderr, /Missing required prompt/);
assert.match(runFail(["routine", "fire", "slack"]).stderr, /Unsupported routine trigger kind: slack/);

// The schedule/routine/sched verbs are dispatched into src/cli/handlers/scheduling.ts —
// each bare verb fails closed with its carved handler's usage string.
assert.match(runFail(["schedule"]).stderr, /schedule create\|list\|delete/, "cw schedule routes through the carved handler");
assert.match(runFail(["routine"]).stderr, /routine create\|list\|delete\|fire\|events/, "cw routine routes through the carved handler");
assert.match(runFail(["sched"]).stderr, /sched plan\|lease\|release/, "cw sched routes through the carved handler");

console.log("schedule-routine-daemon smoke passed: scheduler lifecycle + cron/interval math, TTL expiry, due dedup, routine trigger fire/match with persisted payloads, daemon tick inbox, and the full CLI surface — all fail-closed paths named.");
