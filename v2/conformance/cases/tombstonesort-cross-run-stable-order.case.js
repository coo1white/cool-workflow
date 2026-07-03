#!/usr/bin/env node
"use strict";

// Second, independent angle on the same claim as
// tombstonesort-freed-manifest-path-order.case.js: the freed manifest is
// sorted by path, not an accident of one process's filesystem directory
// -iteration order.
//
// This case runs the SAME pipeline (same task set, so the same final set
// of worker scratch dirs) in two SEPARATE, independently built repos and
// two separate CW processes. Each process has its own filesystem
// directory entries created fresh (different inodes, different on-disk
// dirent order is possible across independent runs/OSes). If gc's
// "freeable" list were left in whatever order readdir/fs-walk happened to
// discover the files, two independent runs could plausibly disagree on
// relative order (e.g. under a different filesystem or a different OS).
// Because CW always resorts by path before hashing, both runs must here
// report the exact same RELATIVE ordering of worker paths in `freed`,
// every time, regardless of process-local fs iteration.
//
// (tombstoneHash itself is not compared here — it also folds in
// run-specific values like runId and wall-clock timestamps, so two
// distinct runs never share a hash even with an identical freed set. What
// must be identical, and is asserted below, is the freed[].path ORDER —
// the thing sorting-by-path actually controls.)

const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

function reclaimOnce() {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const pipe = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(pipe.status, 0);
  const runId = JSON.parse(pipe.stdout).runId;
  run(["registry", "refresh"], { cwd: repo });
  run(["run", "archive", runId, "--reason", "cross-run order check"], { cwd: repo });
  const gcRun = run(["gc", "run", "--json"], { cwd: repo });
  assert.equal(gcRun.status, 0);
  const overlay = readJson(path.join(repo, ".cw", "runs", runId, "reclaimed.json"));
  return overlay.tombstones[0].freed.map((f) => f.path);
}

caseMain(() => {
  const orderA = reclaimOnce();
  const orderB = reclaimOnce();

  assert.ok(orderA.length >= 10);
  assert.deepEqual(orderA, orderB, "two independent runs of the same task set must produce the same freed-path order");

  // Both must independently be sorted ascending — this is the actual
  // invariant ("sorted by path"), not merely "the two runs agree with
  // each other" (two runs could in principle agree while both being
  // unsorted, e.g. both driven by the same stable-but-non-path readdir
  // order on one OS/filesystem).
  const sortedA = orderA.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(orderA, sortedA, "run A's freed manifest must be in ascending path order");
  assert.deepEqual(orderB, sortedA, "run B's freed manifest must be in ascending path order");
});
