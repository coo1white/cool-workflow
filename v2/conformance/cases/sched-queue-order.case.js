#!/usr/bin/env node
"use strict";

// cw queue add/list/drain: list is sorted priority asc, then enqueuedAt;
// drain marks the next N pending|ready entries drained with ONE shared
// drainedAt, under lock, and returns {drained, remaining}; a non-finite
// --priority silently falls back to the default 100 rather than erroring.

const { run, gitRepo, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const low = run(["queue", "add", "--app", "low", "--priority", "200", "--json"], { cwd: repo });
  assert.equal(low.status, 0);
  const lowEntry = JSON.parse(low.stdout);
  assert.equal(lowEntry.priority, 200);
  assert.equal(lowEntry.status, "pending");

  const high = run(["queue", "add", "--app", "high", "--priority", "10", "--json"], { cwd: repo });
  const mid = run(["queue", "add", "--app", "mid", "--priority", "100", "--json"], { cwd: repo });
  assert.equal(JSON.parse(high.stdout).priority, 10);
  assert.equal(JSON.parse(mid.stdout).priority, 100);

  const list = run(["queue", "list", "--json"], { cwd: repo });
  assert.equal(list.status, 0);
  const listReport = JSON.parse(list.stdout);
  assert.equal(listReport.total, 3);
  assert.deepEqual(
    listReport.entries.map((e) => e.appId),
    ["high", "mid", "low"],
    "queue list must sort by priority ascending"
  );

  const listHuman = run(["queue", "list"], { cwd: repo });
  assert.match(listHuman.stdout, /^Run Queue: 3 entry\(ies\) \[priority asc\]\n/);
  assert.match(listHuman.stdout, /#10 .* \[pending\] high /);

  // Non-finite --priority silently falls back to the default 100.
  const badPriority = run(["queue", "add", "--app", "bad", "--priority", "notanumber", "--json"], { cwd: repo });
  assert.equal(badPriority.status, 0);
  assert.equal(JSON.parse(badPriority.stdout).priority, 100, "a non-numeric --priority falls back to default 100");

  // drain --limit 2 marks the two lowest-priority-number entries drained
  // with a SHARED drainedAt, and reports the count still pending.
  const drain = run(["queue", "drain", "--limit", "2", "--json"], { cwd: repo });
  assert.equal(drain.status, 0);
  const drainReport = JSON.parse(drain.stdout);
  assert.equal(drainReport.schemaVersion, 1);
  assert.equal(drainReport.drained.length, 2);
  assert.deepEqual(
    drainReport.drained.map((e) => e.appId),
    ["high", "mid"],
    "drain must take the next N in priority order"
  );
  assert.ok(drainReport.drained.every((e) => e.status === "drained"));
  assert.equal(drainReport.drained[0].drainedAt, drainReport.drained[1].drainedAt, "one shared drainedAt");
  assert.equal(drainReport.remaining, 2, "2 entries remain pending: low + bad");

  // queue show resolves a single entry, or throws for an unknown id.
  const anyId = drainReport.drained[0].id;
  const show = run(["queue", "show", anyId, "--json"], { cwd: repo });
  assert.equal(show.status, 0);
  assert.equal(JSON.parse(show.stdout).id, anyId);

  // Default drain limit is 1.
  const drainDefault = run(["queue", "drain", "--json"], { cwd: repo });
  assert.equal(drainDefault.status, 0);
  assert.equal(JSON.parse(drainDefault.stdout).drained.length, 1);
});
