#!/usr/bin/env node
// commit-snapshot-slim-smoke — proves commitState writes only the commit's
// own record into commits/<id>.json, not the whole run.
//
// Before the fix: writeJson(snapshotPath, { commit, run }) embedded the WHOLE
// WorkflowRun (all tasks, nodes, workers, feedback, and run.commits itself,
// which grows with every commit) into every commit snapshot. commitState runs
// roughly twice per task (dispatch + accept), so total commits/ bytes grew
// like N^2 in the number of commits. After the fix each snapshot only has a
// `commit` key, so its size stays flat no matter how big the run gets.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { commitState } = require("../dist/shell/commit");
const { createRunPaths, ensureRunDirs } = require("../dist/shell/run-store");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-commit-snapshot-slim-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "commit-slim-smoke"));
ensureRunDirs(paths);

// Build a run fixture with a large synthetic task list so the run itself
// serializes to well over 50KB. This is what the OLD code would have
// embedded whole into every single commit snapshot.
const bigNote = "x".repeat(400);
const tasks = [];
for (let i = 0; i < 300; i++) {
  tasks.push({
    id: `task-${i}`,
    kind: "agent",
    phase: "Build",
    status: "completed",
    prompt: `Do step ${i}. ${bigNote}`,
    taskPath: "",
    loopStage: "observe",
    metadata: { note: bigNote }
  });
}

const run = {
  schemaVersion: 1,
  id: "commit-slim-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "commit-slim-smoke",
    title: "Commit Snapshot Slim Smoke",
    summary: "",
    limits: { maxAgents: 1, maxConcurrentAgents: 1 }
  },
  inputs: {},
  loopStage: "checkpoint",
  phases: [],
  tasks,
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: [],
  workers: [],
  candidates: [],
  candidateSelections: []
};

// Sanity: the fixture run must actually be big, or the test would not expose
// the O(N^2) shape the old code had.
const runBytes = Buffer.byteLength(JSON.stringify(run), "utf8");
assert.ok(runBytes > 50000, `fixture run must serialize to over 50KB, got ${runBytes}`);

// commitState() runs roughly twice per task in real usage (dispatch + accept).
// Fire off several unverified checkpoint commits, matching that pattern.
const MAX_SNAPSHOT_BYTES = 4096;
const commits = [];
for (let i = 0; i < 5; i++) {
  const commit = commitState(run, {
    reason: `checkpoint ${i}`,
    allowUnverifiedCheckpoint: true,
    source: "runtime"
  });
  commits.push(commit);
}

assert.equal(run.commits.length, 5);

for (const commit of commits) {
  assert.ok(fs.existsSync(commit.snapshotPath), `snapshot file must exist: ${commit.snapshotPath}`);
  const raw = fs.readFileSync(commit.snapshotPath, "utf8");
  const parsed = JSON.parse(raw);

  // The fix: only `commit`, never the whole `run` (which would carry the
  // ever-growing run.commits array along with every task/node/worker).
  assert.deepEqual(Object.keys(parsed), ["commit"], `commits/${commit.id}.json must only have a "commit" key, got ${Object.keys(parsed)}`);
  assert.ok(!("run" in parsed), `commits/${commit.id}.json must not embed the run`);

  // Each snapshot must stay small and bounded, even though the fixture run
  // itself is 50KB+ and grows with every new commit pushed onto run.commits.
  const bytes = Buffer.byteLength(raw, "utf8");
  assert.ok(bytes < MAX_SNAPSHOT_BYTES, `commits/${commit.id}.json must stay under ${MAX_SNAPSHOT_BYTES} bytes, got ${bytes}`);

  // Slimming must not drop the commit's own fields: same id, same gitHead,
  // same evidence as the in-memory commit record.
  assert.equal(parsed.commit.id, commit.id);
  assert.equal(parsed.commit.gitHead, commit.gitHead);
  assert.deepEqual(parsed.commit.evidence, commit.evidence);
}

process.stdout.write("commit-snapshot-slim-smoke: ok\n");
