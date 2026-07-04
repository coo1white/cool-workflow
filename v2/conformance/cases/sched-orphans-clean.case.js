#!/usr/bin/env node
"use strict";

// cw orphans list / cw orphans gc on a clean repo (no runs at all, no
// orphan dirs): documented empty/ok shape, scope defaults to home, and
// gc is a true no-op (writes nothing, removes nothing).

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const list = run(["orphans", "list"], { cwd: repo });
  assert.equal(list.status, 0);
  assert.match(
    list.stdout,
    /^No orphan run\(s\) \(home\): every "\.cw\/runs\/" entry across \d+ repo\(s\) is known to the registry\.\n$/
  );

  const listJson = run(["orphans", "list", "--json"], { cwd: repo });
  assert.equal(listJson.status, 0);
  const listReport = JSON.parse(listJson.stdout);
  assert.equal(listReport.schemaVersion, 1);
  assert.equal(listReport.scope, "home");
  assert.equal(listReport.count, 0);
  assert.equal(listReport.totalBytes, 0);
  assert.deepEqual(listReport.entries, []);
  assert.ok(Array.isArray(listReport.repos));

  const gc = run(["orphans", "gc"], { cwd: repo });
  assert.equal(gc.status, 0);
  assert.equal(gc.stdout, "Nothing to reclaim (orphans older than 60 minute(s)); 0 kept (home).\n");

  const gcJson = run(["orphans", "gc", "--json"], { cwd: repo });
  assert.equal(gcJson.status, 0);
  const gcReport = JSON.parse(gcJson.stdout);
  assert.equal(gcReport.schemaVersion, 1);
  assert.equal(gcReport.scope, "home");
  assert.deepEqual(gcReport.removed, []);
  assert.equal(gcReport.freedBytes, 0);
  assert.equal(gcReport.keptCount, 0);
  assert.equal(gcReport.minAgeMinutes, 60);
  assert.equal(gcReport.all, false);

  const gcAllJson = run(["orphans", "gc", "--all", "--json"], { cwd: repo });
  assert.equal(gcAllJson.status, 0);
  const gcAllReport = JSON.parse(gcAllJson.stdout);
  assert.equal(gcAllReport.minAgeMinutes, null, "minAgeMinutes must be null with --all");
  assert.equal(gcAllReport.all, true);
  assert.deepEqual(gcAllReport.removed, []);

  // --scope repo also reports clean/empty and never writes.
  const repoScope = run(["orphans", "list", "--scope", "repo", "--json"], { cwd: repo });
  assert.equal(repoScope.status, 0);
  const repoScopeReport = JSON.parse(repoScope.stdout);
  assert.equal(repoScopeReport.scope, "repo");
  assert.equal(repoScopeReport.count, 0);

  // orphans reads never write: no .cw dir should exist under the repo at all
  // (list/gc on a repo with zero runs must not create .cw/runs, registry, etc).
  assert.equal(fs.existsSync(path.join(repo, ".cw")), false, "orphans must not create .cw/");
});
