#!/usr/bin/env node
"use strict";

// cw orphans list/gc against a repo that has:
//   - a true orphan: a run dir with NO state.json (what a killed process
//     leaves behind before its first checkpoint)
//   - a dir with a PRESENT BUT CORRUPT state.json — this is NOT an orphan
//     (left alone, gc territory, never swept by orphans)
// Confirms: list finds only the true orphan; default gc (fresh mtime) keeps
// it; --all reclaims exactly the true orphan and leaves the corrupt-state
// dir untouched; a second list call after gc shows the clean state again.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const orphanDir = path.join(repo, ".cw", "runs", "orphan-test-run");
  fs.mkdirSync(path.join(orphanDir, "scratch"), { recursive: true });
  fs.writeFileSync(path.join(orphanDir, "scratch", "file.txt"), "leftover-bytes");

  const corruptDir = path.join(repo, ".cw", "runs", "corrupt-state-run");
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, "state.json"), "not json {{{");

  const list = run(["orphans", "list", "--json"], { cwd: repo });
  assert.equal(list.status, 0);
  const listReport = JSON.parse(list.stdout);
  assert.equal(listReport.count, 1, "only the no-state.json dir is an orphan");
  assert.equal(listReport.entries[0].runId, "orphan-test-run");
  assert.ok(listReport.entries[0].bytes > 0);
  assert.equal(typeof listReport.entries[0].ageMinutes, "number");
  assert.ok(
    !listReport.entries.some((e) => e.runId === "corrupt-state-run"),
    "a dir with a present (even corrupt) state.json must never be an orphan"
  );

  const listHuman = run(["orphans", "list"], { cwd: repo });
  assert.match(listHuman.stdout, /^Orphan Runs \(home\): 1 in \d+ repo\(s\), \d+(\.\d)?(B|KiB|MiB|GiB) total\n/);
  assert.match(listHuman.stdout, /orphan-test-run \(.*\) age=\d+m/);
  assert.match(listHuman.stdout, /Reclaim with: cw orphans gc --min-age-minutes 60 {3}\(or --all\)\n$/);

  // Default age gate (60 min) keeps a dir with a fresh mtime.
  const gcDefault = run(["orphans", "gc", "--json"], { cwd: repo });
  assert.equal(gcDefault.status, 0);
  const gcDefaultReport = JSON.parse(gcDefault.stdout);
  assert.deepEqual(gcDefaultReport.removed, []);
  assert.equal(gcDefaultReport.keptCount, 1);
  assert.ok(fs.existsSync(orphanDir), "fresh orphan must survive the default age gate");

  // --all reclaims the true orphan only; the corrupt-state dir is untouched.
  const gcAll = run(["orphans", "gc", "--all", "--json"], { cwd: repo });
  assert.equal(gcAll.status, 0);
  const gcAllReport = JSON.parse(gcAll.stdout);
  assert.equal(gcAllReport.removed.length, 1);
  assert.equal(gcAllReport.removed[0].runId, "orphan-test-run");
  assert.ok(gcAllReport.freedBytes > 0);
  assert.equal(gcAllReport.keptCount, 0);
  assert.equal(fs.existsSync(orphanDir), false, "--all must delete the orphan dir");
  assert.ok(fs.existsSync(corruptDir), "corrupt-state dir must never be deleted by orphans gc");

  // A second list call now reports clean state again.
  const listAfter = run(["orphans", "list", "--json"], { cwd: repo });
  assert.equal(JSON.parse(listAfter.stdout).count, 0);
});
