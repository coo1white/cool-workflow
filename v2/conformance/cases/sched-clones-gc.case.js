#!/usr/bin/env node
"use strict";

// cw clones list/gc: empty state has the documented "no cached checkouts"
// shape; then two synthetic cache entries (one with meta, one without) show
// the missing-meta defaults, sort-by-fetchedAt, and the TTL sweep rule that
// an entry with NO fetchedAt is kept by a plain sweep but removed by --all.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const emptyJson = run(["clones", "list", "--json"], { cwd: repo });
  assert.equal(emptyJson.status, 0);
  const emptyReport = JSON.parse(emptyJson.stdout);
  assert.equal(emptyReport.schemaVersion, 1);
  assert.equal(emptyReport.count, 0);
  assert.equal(emptyReport.totalBytes, 0);
  assert.deepEqual(emptyReport.entries, []);
  const clonesDir = emptyReport.clonesDir;

  const emptyHuman = run(["clones", "list"], { cwd: repo });
  assert.equal(emptyHuman.stdout, `No cached remote checkouts in ${clonesDir}.\n`);

  const emptyGc = run(["clones", "gc"], { cwd: repo });
  assert.equal(emptyGc.status, 0);
  assert.equal(emptyGc.stdout, `Nothing to reclaim (entries older than 30 day(s)); 0 kept in ${clonesDir}.\n`);

  // Build two synthetic cache entries directly under the resolved clones dir.
  const withMeta = path.join(clonesDir, "abc123hash");
  fs.mkdirSync(withMeta, { recursive: true });
  fs.writeFileSync(
    path.join(withMeta, ".cw-clone-meta.json"),
    JSON.stringify({ url: "https://example.com/repo.git", kind: "git", ref: "main", fetchedAt: "2020-01-01T00:00:00.000Z", commit: "deadbeef" })
  );
  fs.writeFileSync(path.join(withMeta, "README.md"), "hello world");

  const noMeta = path.join(clonesDir, "nometahash");
  fs.mkdirSync(noMeta, { recursive: true });
  fs.writeFileSync(path.join(noMeta, "file.txt"), "nofile!");

  const list = run(["clones", "list", "--json"], { cwd: repo });
  assert.equal(list.status, 0);
  const listReport = JSON.parse(list.stdout);
  assert.equal(listReport.count, 2);
  const meta = listReport.entries.find((e) => e.hash === "abc123hash");
  const noMetaEntry = listReport.entries.find((e) => e.hash === "nometahash");
  assert.equal(meta.url, "https://example.com/repo.git");
  assert.equal(meta.kind, "git");
  assert.equal(meta.ref, "main");
  assert.equal(meta.fetchedAt, "2020-01-01T00:00:00.000Z");
  assert.equal(meta.commit, "deadbeef");
  assert.equal(noMetaEntry.url, "(unknown)", "missing meta must default url to (unknown)");
  assert.equal(noMetaEntry.kind, "git");
  assert.equal(noMetaEntry.ref, null);
  assert.equal(noMetaEntry.fetchedAt, null);
  assert.equal(noMetaEntry.commit, null);

  // Plain TTL sweep (default 30 days): the dated 2020 entry is old enough to
  // go; the no-fetchedAt entry cannot be aged, so it is kept.
  const gc = run(["clones", "gc", "--json"], { cwd: repo });
  assert.equal(gc.status, 0);
  const gcReport = JSON.parse(gc.stdout);
  assert.equal(gcReport.removed.length, 1);
  assert.equal(gcReport.removed[0].hash, "abc123hash");
  assert.equal(gcReport.keptCount, 1);
  assert.equal(gcReport.olderThanDays, 30);
  assert.equal(gcReport.all, false);
  assert.equal(fs.existsSync(withMeta), false, "dated entry must be removed by the TTL sweep");
  assert.ok(fs.existsSync(noMeta), "no-fetchedAt entry survives a plain TTL sweep");

  // --all removes even a no-fetchedAt entry.
  const gcAll = run(["clones", "gc", "--all", "--json"], { cwd: repo });
  assert.equal(gcAll.status, 0);
  const gcAllReport = JSON.parse(gcAll.stdout);
  assert.equal(gcAllReport.removed.length, 1);
  assert.equal(gcAllReport.removed[0].hash, "nometahash");
  assert.equal(gcAllReport.olderThanDays, null, "olderThanDays is null in JSON with --all");
  assert.equal(fs.existsSync(noMeta), false, "--all removes even an unaged entry");
});
