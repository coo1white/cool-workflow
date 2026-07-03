#!/usr/bin/env node
"use strict";

// The wall-clock scheduler (cw loop / cw schedule), distinct from cw sched
// (lease-based queue scheduling — see sched-lease-lifecycle.case.js).
// Covers: cw loop is sugar for schedule create --kind loop; intervalMinutes
// 0 makes a task due immediately (deterministic, no real sleep needed);
// due() dedups its "due" history record on repeat calls before nextRunAt
// advances; complete/pause/resume/run-now/history/delete all round-trip.

const { run, gitRepo, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const loop = run(["loop", "--prompt", "watch it"], { cwd: repo });
  assert.equal(loop.status, 0);
  const loopTask = JSON.parse(loop.stdout);
  assert.equal(loopTask.kind, "loop", "cw loop forces kind to loop");
  assert.equal(loopTask.status, "active");
  assert.match(loopTask.id, /^loop-\d{8}T\d{6}Z-[0-9a-f]{6}$/);

  const list = run(["schedule", "list", "--json"], { cwd: repo });
  assert.equal(list.status, 0);
  assert.ok(JSON.parse(list.stdout).some((t) => t.id === loopTask.id));

  // intervalMinutes 0 -> nextRunAt is "now", so it is due right away.
  const create = run(["schedule", "create", "--prompt", "instant", "--intervalMinutes", "0", "--json"], { cwd: repo });
  assert.equal(create.status, 0);
  const task = JSON.parse(create.stdout);
  const id = task.id;

  const due1 = run(["schedule", "due", "--json"], { cwd: repo });
  assert.equal(due1.status, 0);
  const due1Report = JSON.parse(due1.stdout);
  assert.ok(due1Report.some((t) => t.id === id), "an intervalMinutes:0 task must be immediately due");

  // Calling due() again before completing/advancing must NOT duplicate the
  // "due" history record (lastDueAt < nextRunAt guard).
  run(["schedule", "due", "--json"], { cwd: repo });
  run(["schedule", "due", "--json"], { cwd: repo });
  const historyAfterRepeats = run(["schedule", "history", id, "--json"], { cwd: repo });
  const dueRecords = JSON.parse(historyAfterRepeats.stdout).filter((r) => r.status === "due");
  assert.equal(dueRecords.length, 1, "repeated due() calls must not duplicate the due history record");

  const complete = run(["schedule", "complete", id, "--json"], { cwd: repo });
  assert.equal(complete.status, 0);
  const completed = JSON.parse(complete.stdout);
  assert.equal(completed.runCount, 1);
  assert.ok(completed.lastRunAt);

  const pause = run(["schedule", "pause", id, "--json"], { cwd: repo });
  assert.equal(pause.status, 0);
  assert.equal(JSON.parse(pause.stdout).status, "paused");

  const resume = run(["schedule", "resume", id, "--json"], { cwd: repo });
  assert.equal(resume.status, 0);
  assert.equal(JSON.parse(resume.stdout).status, "active");

  const runNow = run(["schedule", "run-now", id, "--json"], { cwd: repo });
  assert.equal(runNow.status, 0);
  const runNowRecord = JSON.parse(runNow.stdout);
  assert.equal(runNowRecord.status, "started");
  assert.equal(runNowRecord.scheduleId, id);
  assert.match(runNowRecord.id, /^run-loop-/);

  const historyAll = run(["schedule", "history", "--json"], { cwd: repo });
  assert.equal(historyAll.status, 0);
  const allRecords = JSON.parse(historyAll.stdout);
  assert.ok(allRecords.some((r) => r.status === "due" && r.scheduleId === id));
  assert.ok(allRecords.some((r) => r.status === "started" && r.scheduleId === id));

  const del = run(["schedule", "delete", id, "--json"], { cwd: repo });
  assert.equal(del.status, 0);
  assert.deepEqual(JSON.parse(del.stdout), { deleted: true, id });

  const delAgain = run(["schedule", "delete", id, "--json"], { cwd: repo });
  assert.deepEqual(JSON.parse(delAgain.stdout), { deleted: false, id });

  // A reminder is one-shot: complete() ends it regardless of maxRuns.
  const reminder = run(["schedule", "create", "--prompt", "one shot", "--kind", "reminder", "--delayMinutes", "0", "--json"], { cwd: repo });
  assert.equal(reminder.status, 0);
  const reminderId = JSON.parse(reminder.stdout).id;
  assert.match(reminderId, /^reminder-/);
  const reminderComplete = run(["schedule", "complete", reminderId, "--json"], { cwd: repo });
  assert.equal(JSON.parse(reminderComplete.stdout).status, "completed", "a reminder always completes on its first complete()");
});
