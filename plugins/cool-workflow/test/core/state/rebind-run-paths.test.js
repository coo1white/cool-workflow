#!/usr/bin/env node
// rebind-run-paths — rebindRunPaths makes a loaded run's paths and audit
// paths again from the folder it was found in. Stored values are never
// kept; stored key order is kept, so right paths save byte-identical.

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRunPaths, rebindRunPaths } = require("../../../dist/core/state/run-paths");

const runDir = "/repo/.cw/runs/demo-run";

// Planted values are replaced; unknown keys are dropped.
{
  const run = {
    paths: { ...createRunPaths("/old/.cw/runs/demo-run"), report: "../../.bashrc-target", graphSnapshotPath: "/etc/x" },
    audit: { schemaVersion: 1, eventLogPath: "/tmp/evil/events.jsonl", summaryPath: "/tmp/evil/summary.json", indexPath: "/tmp/evil/index.json" },
  };
  rebindRunPaths(run, runDir);
  assert.deepEqual(run.paths, createRunPaths(runDir));
  assert.deepEqual(run.audit, {
    schemaVersion: 1,
    eventLogPath: path.join(runDir, "audit", "events.jsonl"),
    summaryPath: path.join(runDir, "audit", "summary.json"),
    indexPath: path.join(runDir, "audit", "index.json"),
  });
}

// Right paths come back byte-identical, in the same key order.
{
  const stored = createRunPaths(runDir);
  const reordered = Object.fromEntries(Object.entries(stored).reverse());
  const run = { paths: { ...reordered } };
  rebindRunPaths(run, runDir);
  assert.equal(JSON.stringify(run.paths), JSON.stringify(reordered));
  assert.equal(run.audit, undefined, "no audit block is made where none was stored");
}

// Audit keys that were not stored stay absent.
{
  const run = { paths: createRunPaths(runDir), audit: { schemaVersion: 1 } };
  rebindRunPaths(run, runDir);
  assert.deepEqual(run.audit, { schemaVersion: 1 });
}

console.log("rebind-run-paths: ok");
