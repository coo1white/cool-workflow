#!/usr/bin/env node
"use strict";

// After a stub-agent pipeline run completes, the run must show up in:
//   - cw registry refresh/show (repo scope) — freshness valid, counts.completed=1
//   - cw run list (home scope, the default) — same run, freshness valid
//   - cw history — newest-first timeline entry
// registry refresh at repo scope also rebuilds the home index (no extra
// "registry refresh --scope home" step is needed for run list to see it).

const { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const pipe = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(pipe.status, 0);
  const runId = JSON.parse(pipe.stdout).runId;
  assert.ok(runId, "pipeline run must report a runId");

  // Before any registry refresh, repo-scope show reports absent freshness
  // (derived is empty until refresh persists an index) but never writes.
  const before = run(["registry", "show", "--json"], { cwd: repo });
  assert.equal(before.status, 0);
  const beforeReport = JSON.parse(before.stdout);
  assert.equal(beforeReport.scope, "repo");
  assert.equal(beforeReport.freshness.status, "absent");

  const refresh = run(["registry", "refresh", "--json"], { cwd: repo });
  assert.equal(refresh.status, 0);
  const report = JSON.parse(refresh.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scope, "repo");
  assert.equal(report.freshness.status, "valid");
  assert.deepEqual(report.freshness.staleRuns, []);
  assert.deepEqual(report.freshness.missingRuns, []);
  assert.equal(report.counts.total, 1);
  assert.equal(report.counts.completed, 1);
  assert.equal(report.counts.failed, 0);
  assert.equal(report.nextAction, "node scripts/cw.js run search");
  const record = report.index.records.find((r) => r.runId === runId);
  assert.ok(record, "refreshed index must contain the run");
  assert.equal(record.derivedLifecycle, "completed");
  assert.equal(record.appId, "architecture-review");

  // registry show (repo scope) after refresh: same shape, still valid, never writes.
  const show = run(["registry", "show", "--json"], { cwd: repo });
  assert.equal(show.status, 0);
  const showReport = JSON.parse(show.stdout);
  assert.equal(showReport.freshness.status, "valid");
  assert.equal(showReport.counts.total, 1);

  // run list defaults to home scope and must see the same run without a
  // separate "--scope home" refresh (repo-scope refresh also writes home).
  const list = run(["run", "list", "--json"], { cwd: repo });
  assert.equal(list.status, 0);
  const listReport = JSON.parse(list.stdout);
  assert.equal(listReport.scope, "home");
  assert.equal(listReport.freshness, "valid");
  assert.equal(listReport.total, 1);
  assert.equal(listReport.records[0].runId, runId);

  // run show <id> must resolve the same run cross-repo.
  const showRun = run(["run", "show", runId, "--json"], { cwd: repo });
  assert.equal(showRun.status, 0);
  const showRunReport = JSON.parse(showRun.stdout);
  assert.equal(showRunReport.found, true);
  assert.equal(showRunReport.record.runId, runId);

  // cw history: newest-first cross-repo timeline includes the run.
  const history = run(["history", "--json"], { cwd: repo });
  assert.equal(history.status, 0);
  const historyReport = JSON.parse(history.stdout);
  assert.ok(Array.isArray(historyReport.entries));
  assert.ok(
    historyReport.entries.some((r) => r.runId === runId),
    "history must include the completed run"
  );

  // The persisted per-repo index file exists on disk with the same runId.
  const idx = readJson(require("node:path").join(repo, ".cw", "registry", "index.json"));
  assert.ok(idx.records.some((r) => r.runId === runId));
});
