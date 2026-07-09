#!/usr/bin/env node
"use strict";

// State-explosion freshness ladder (absent -> valid -> stale) and the
// exact persisted-byte / human-text shapes, driven WITHOUT `-q`/drive()
// (same hand-written `state.json` + `workers` array technique as
// stateexplosion-thresholds-and-collapse.case.js).
//
// Pins:
//   - `cw summary show` on a run with NO summaries yet reports freshness
//     "absent" and nextAction "summary refresh <runId>"
//   - after `cw summary refresh`, freshness is "valid" and
//     persistedFingerprint === currentFingerprint (both the 32-hex
//     fingerprintStrings family)
//   - `summaries/index.json` on disk: id "multi-agent-summary-index",
//     schemaVersion 1, and the exact 2-space-indent + trailing-newline
//     JSON.stringify bytes
//   - adding a worker after refresh (without a second refresh) makes the
//     NEXT `summary show` report freshness "stale"
//   - `cw summary show` human text (no --json): exact first 4 lines and
//     the "State Size" line shape

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, readJson, caseMain, assert } = require("../lib");

function baseState(runId, cwd, runDir, workers) {
  return {
    schemaVersion: 1,
    id: runId,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    cwd,
    workflow: { id: "fixture-workflow", title: "Fixture Workflow", summary: "", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: {
      runDir,
      state: path.join(runDir, "state.json"),
      report: path.join(runDir, "report.md"),
      tasksDir: path.join(runDir, "tasks"),
      resultsDir: path.join(runDir, "results"),
      dispatchesDir: path.join(runDir, "dispatches"),
      artifactsDir: path.join(runDir, "artifacts"),
      commitsDir: path.join(runDir, "commits"),
      stateNodesDir: path.join(runDir, "nodes"),
      feedbackDir: path.join(runDir, "feedback"),
    },
    workers,
  };
}

function worker(id, runId) {
  return {
    schemaVersion: 1,
    id,
    runId,
    taskId: `t-${id}`,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    status: "completed",
    workerDir: "/tmp/w",
    inputPath: "/tmp/w/input.json",
    resultPath: "/tmp/w/result.md",
    artifactsDir: "/tmp/w/artifacts",
    logsDir: "/tmp/w/logs",
    allowedPaths: [],
    feedbackIds: [],
    errors: [],
  };
}

const FP32 = /^sha256:[0-9a-f]{32}$/;

caseMain(() => {
  const runId = "explosion-freshness-run";
  const repo = freshDir("repo");
  const runDir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const statePath = path.join(runDir, "state.json");
  const writeWorkers = (workers) => {
    fs.writeFileSync(statePath, JSON.stringify(baseState(runId, repo, runDir, workers), null, 2) + "\n");
  };

  writeWorkers([worker("w0", runId), worker("w1", runId)]);

  // No summaries yet: freshness is "absent".
  const showAbsent = run(["summary", "show", runId, "--json"], { cwd: repo });
  assert.equal(showAbsent.status, 0);
  const absentReport = JSON.parse(showAbsent.stdout);
  assert.equal(absentReport.freshness.status, "absent");
  assert.equal(absentReport.freshness.persistedFingerprint, undefined);
  assert.match(absentReport.freshness.currentFingerprint, FP32);
  assert.equal(absentReport.nextAction, `cw summary refresh ${runId}`);

  // Refresh: freshness becomes "valid", persisted === current.
  const refresh = run(["summary", "refresh", runId, "--json"], { cwd: repo });
  assert.equal(refresh.status, 0);

  const showValid = run(["summary", "show", runId, "--json"], { cwd: repo });
  const validReport = JSON.parse(showValid.stdout);
  assert.equal(validReport.freshness.status, "valid");
  assert.match(validReport.freshness.persistedFingerprint, FP32);
  assert.match(validReport.freshness.currentFingerprint, FP32);
  assert.equal(validReport.freshness.persistedFingerprint, validReport.freshness.currentFingerprint);
  assert.deepEqual(validReport.freshness.staleScopes, []);

  // summaries/index.json: exact id/schemaVersion + byte-exact JSON.stringify shape.
  const indexPath = path.join(runDir, "summaries", "index.json");
  assert.ok(fs.existsSync(indexPath));
  const index = readJson(indexPath);
  assert.equal(index.id, "multi-agent-summary-index");
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.runId, runId);
  const indexRaw = fs.readFileSync(indexPath, "utf8");
  assert.equal(indexRaw, JSON.stringify(index, null, 2) + "\n", "state-explosion summary files use the one JSON.stringify(v, null, 2) + \"\\n\" byte shape");

  // Mutate the run (add a third worker) WITHOUT refreshing again: the next
  // `summary show` must report "stale" against the stale-since-persisted
  // index.
  writeWorkers([worker("w0", runId), worker("w1", runId), worker("w2", runId)]);
  const showStale = run(["summary", "show", runId, "--json"], { cwd: repo });
  assert.equal(showStale.status, 0);
  const staleReport = JSON.parse(showStale.stdout);
  assert.equal(staleReport.freshness.status, "stale");
  assert.notEqual(staleReport.freshness.persistedFingerprint, staleReport.freshness.currentFingerprint);
  assert.equal(staleReport.nextAction, `cw summary refresh ${runId}`);

  // Human text (no --json): exact first lines.
  const showText = run(["summary", "show", runId], { cwd: repo });
  assert.equal(showText.status, 0);
  const lines = showText.stdout.split("\n");
  assert.equal(lines[0], `State Explosion Report: ${runId}`);
  assert.ok(lines[1].startsWith("Freshness: stale"));
  assert.equal(lines[2], "");
  assert.equal(lines[3], "State Size");
  assert.match(lines[4], /^ {2}records=\d+; graph nodes=\d+; graph edges=\d+; messages=\d+; compaction=(recommended|not needed)$/);
});
