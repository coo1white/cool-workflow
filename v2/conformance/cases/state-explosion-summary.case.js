#!/usr/bin/env node
"use strict";

// `cw summary refresh` / `cw summary show` against the 14-worker
// architecture-review run (the one case where we deliberately use the
// full app, since state-explosion thresholds need enough real graph
// nodes to trip). Pins:
//   - the exact threshold reason strings and DEFAULT_STATE_EXPLOSION_THRESHOLDS
//     (graphNodes: 40, graphEdges: 60)
//   - freshness.persistedFingerprint / currentFingerprint are the 32-hex
//     fingerprintStrings family, and match right after a refresh
//   - summaries/index.json has id "multi-agent-summary-index"
//   - the human-text report's exact first lines and the collapse line

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

const FP32 = /^sha256:[0-9a-f]{32}$/;

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const runId = payload.runId;
  const runDir = path.dirname(payload.statePath);

  const refresh = run(["summary", "refresh", runId, "--json"], { cwd: repo });
  assert.equal(refresh.status, 0);
  const refreshIndex = JSON.parse(refresh.stdout);
  assert.equal(refreshIndex.schemaVersion, 1);
  assert.equal(refreshIndex.runId, runId);
  assert.equal(refreshIndex.id, "multi-agent-summary-index");
  assert.match(refreshIndex.sourceFingerprint, FP32);

  // `cw summary show --json` is the full StateExplosionReport (refresh's
  // own --json output is the index record, a different shape)
  const showJson = run(["summary", "show", runId, "--json"], { cwd: repo });
  assert.equal(showJson.status, 0);
  const report = JSON.parse(showJson.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.runId, runId);
  assert.ok(report.stateSize.graphNodes > 40, "the full app must trip the graphNodes threshold");
  assert.ok(report.stateSize.compactionRecommended, true);
  assert.ok(
    report.stateSize.reasons.some((line) => /^graph has \d+ nodes \(> 40\)$/.test(line)),
    "exact graphNodes threshold reason string"
  );
  assert.ok(
    report.stateSize.reasons.some((line) => /^graph has \d+ edges \(> 60\)$/.test(line)),
    "exact graphEdges threshold reason string"
  );

  assert.equal(report.freshness.status, "valid");
  assert.match(report.freshness.persistedFingerprint, FP32);
  assert.match(report.freshness.currentFingerprint, FP32);
  assert.equal(report.freshness.persistedFingerprint, report.freshness.currentFingerprint);
  assert.deepEqual(report.freshness.staleScopes, []);

  // index.json on disk carries the fixed id and schema version
  const indexPath = path.join(runDir, "summaries", "index.json");
  assert.ok(fs.existsSync(indexPath));
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.equal(index.id, "multi-agent-summary-index");
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.runId, runId);
  const indexRaw = fs.readFileSync(indexPath, "utf8");
  assert.equal(indexRaw, JSON.stringify(index, null, 2) + "\n");

  // human-text render: exact first lines and the collapse-line shape
  const show = run(["summary", "show", runId], { cwd: repo });
  assert.equal(show.status, 0);
  const lines = show.stdout.split("\n");
  assert.equal(lines[0], `State Explosion Report: ${runId}`);
  assert.equal(lines[1], "Freshness: valid");
  assert.equal(lines[2], "");
  assert.equal(lines[3], "State Size");
  assert.match(
    lines[4],
    /^ {2}records=\d+; graph nodes=\d+; graph edges=\d+; messages=\d+; compaction=recommended$/
  );
  assert.ok(
    show.stdout.includes("Compact Graph"),
    "the Compact Graph panel must appear when compaction is recommended"
  );
  assert.match(
    show.stdout,
    /Graph compacted: \d+ nodes collapsed into \d+ summary nodes/
  );
});
