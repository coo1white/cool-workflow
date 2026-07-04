#!/usr/bin/env node
"use strict";

// gc's tombstoneHash must be reproducible across hosts because the freed
// manifest is sorted BY PATH before hashing, never by insertion/creation
// order (scheduling-registry.md: "freeable is sorted by path bytes before
// hashing", src/reclamation.ts:466).
//
// A real stub-agent pipeline run (`cw -q ...`) creates one worker scratch
// dir per task, and the tasks are created in a fixed DEPENDENCY order that
// is NOT alphabetical: all "map:*" tasks first, then all "assess:*" tasks,
// then "verify:*", then "verdict:*". That creation order is directly
// visible in the same tombstone's skeleton.costRecord.tasks list (the
// order tasks were costed/executed in). If the freed-manifest were left in
// creation/insertion order, `freed[].path` would read map:*, map:*, ...,
// assess:*, ..., verify:*, verdict:*. Since "assess:" < "map:" < "verdict:"
// < "verify:" by byte order, a path-sorted manifest reads differently:
// assess:* entries first, then map:*, then verdict:*, then verify:*.
//
// This case runs the pipeline once, archives + reclaims it, and reads the
// durable reclaimed.json the CLI itself wrote (allowed: it is CLI output,
// not source) to confirm:
//   1. freed[].path is in strict ascending byte order (proves "sorted").
//   2. That order is a real permutation of, and strictly different from,
//      the task creation order recorded in the same tombstone (proves the
//      sort key is path, not "happens to already be sorted because fs
//      iteration order matched creation order").

const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const pipe = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(pipe.status, 0);
  const runId = JSON.parse(pipe.stdout).runId;
  run(["registry", "refresh"], { cwd: repo });

  const archive = run(["run", "archive", runId, "--reason", "tombstone sort check"], { cwd: repo });
  assert.equal(archive.status, 0);

  const gcRun = run(["gc", "run", "--json"], { cwd: repo });
  assert.equal(gcRun.status, 0);
  const gcRunReport = JSON.parse(gcRun.stdout);
  assert.equal(gcRunReport.reclaimed.length, 1);
  const reclaimed = gcRunReport.reclaimed[0];
  assert.equal(reclaimed.runId, runId);
  assert.match(reclaimed.tombstoneHash, /^sha256:[0-9a-f]{64}$/);

  const overlay = readJson(path.join(repo, ".cw", "runs", runId, "reclaimed.json"));
  assert.equal(overlay.tombstones.length, 1);
  const tomb = overlay.tombstones[0];
  assert.equal(tomb.tombstoneHash, reclaimed.tombstoneHash);

  const freedPaths = tomb.freed.map((f) => f.path);
  assert.ok(freedPaths.length >= 10, "the pipeline must produce enough worker scratch dirs to test ordering");

  // 1. The manifest really is in ascending path (byte) order.
  const sortedPaths = freedPaths.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(freedPaths, sortedPaths, "freed manifest must be sorted by path bytes before hashing");

  // 2. Creation order (from the same tombstone's costRecord.tasks) is a
  // genuinely different order: map:* tasks are costed/executed first,
  // but "assess:" < "map:" byte-wise, so a path-sorted manifest cannot
  // equal creation order. This rules out "coincidentally already sorted".
  const creationTaskIds = tomb.skeleton.costRecord.tasks.map((t) => t.taskId);
  const creationWorkerPaths = creationTaskIds.map((id) => `workers/worker-${id}-0001`);
  assert.notDeepEqual(
    freedPaths,
    creationWorkerPaths,
    "path-sorted freed manifest must differ from raw task-creation order"
  );

  // Sanity: the two orderings are still permutations of the same set —
  // this is a re-order, not a different/missing set of files.
  assert.deepEqual(freedPaths.slice().sort(), creationWorkerPaths.slice().sort());

  // Concretely: creation order starts with a "map:*" worker (first task
  // costed), but the path-sorted manifest starts with an "assess:*"
  // worker, since "assess:" sorts before "map:" byte-wise. This is the
  // single clearest signature that the sort key is the path, not the
  // order workers were made in.
  assert.match(creationWorkerPaths[0], /^workers\/worker-map:/, "pipeline creates map tasks first");
  assert.match(freedPaths[0], /^workers\/worker-assess:/, "sorted manifest leads with assess: (byte order), not the first-created map: worker");

  // gc verify recomputes tombstoneHash independently and must agree,
  // proving the hash itself (not just the stored value) is a function of
  // this same sorted manifest.
  const verify = run(["gc", "verify", runId, "--json"], { cwd: repo });
  assert.equal(verify.status, 0);
  const verifyReport = JSON.parse(verify.stdout);
  assert.equal(verifyReport.verified, true);
  assert.equal(verifyReport.tombstoneHash, reclaimed.tombstoneHash);
});
