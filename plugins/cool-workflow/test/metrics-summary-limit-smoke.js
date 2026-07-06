#!/usr/bin/env node
"use strict";

// metrics-summary-limit-smoke — regression guard for `cw metrics summary`'s
// --limit option. RunRegistry.list() -> .search() already defaults to a
// 50-record floor when no limit is passed, so metricsSummaryCli was never
// truly unbounded — but it silently ignored any explicit --limit an operator
// passed, and the MCP tool row didn't advertise the option at all. This pins:
//   A. an explicit --limit N loads only N run states, not every run.
//   B. omitting --limit is unchanged (still scans everything under the
//      50-record floor).
//   C. --limit 0 clamps to the existing floor of 1 (RunRegistry's own
//      clampInt behavior, unchanged by this fix).
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));
const { metricsSummaryCli } = require(path.join(pluginRoot, "dist", "shell", "metrics-cli.js"));

function makeRun(tmp, id) {
  const paths = createRunPaths(path.join(tmp, ".cw", "runs", id));
  ensureRunDirs(paths);
  const run = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: tmp,
    workflow: { id, title: id, summary: "", limits: { maxAgents: 4, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    workers: [],
  };
  saveCheckpoint(run);
  return run;
}

function metricsSummaryLimit() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-metrics-limit-"));
  const N = 5;
  for (let i = 0; i < N; i++) makeRun(tmp, `run-${i}`);

  const limited = metricsSummaryCli({ cwd: tmp, scope: "repo", limit: 2 });
  assert.equal(limited.runCount, 2, `--limit 2 must load exactly 2 runs, got ${limited.runCount}`);

  const unlimited = metricsSummaryCli({ cwd: tmp, scope: "repo" });
  assert.equal(unlimited.runCount, N, `omitting --limit must still scan all ${N} runs (default 50-record floor), got ${unlimited.runCount}`);

  const floored = metricsSummaryCli({ cwd: tmp, scope: "repo", limit: 0 });
  assert.equal(floored.runCount, 1, `--limit 0 must clamp to the existing floor of 1, got ${floored.runCount}`);
}

(() => {
  metricsSummaryLimit();
  process.stdout.write("metrics-summary-limit-smoke: ok (--limit N loads N; omitted --limit unchanged; --limit 0 clamps to floor 1)\n");
})();
