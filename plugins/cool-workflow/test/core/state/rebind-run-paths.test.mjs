#!/usr/bin/env node
// rebind-run-paths — rebindRunPaths makes a loaded run's paths and audit
// paths again from the folder it was found in. Stored values are never
// kept; stored key order is kept, so right paths save byte-identical.

import assert from "node:assert/strict";
import path from "node:path";
import { createRunPaths, rebindRunPaths } from "../../../dist/core/state/run-paths.js";

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

// A sameLocation answer of yes keeps the stored string; no replaces it.
{
  const linked = createRunPaths("/link/.cw/runs/demo-run");
  const run = {
    paths: { ...linked, report: "/elsewhere/report.md" },
    audit: { schemaVersion: 1, eventLogPath: path.join(linked.auditDir, "events.jsonl") },
  };
  const same = (stored, rebuilt) => stored.replace(/^\/link\//, "/repo/") === rebuilt;
  rebindRunPaths(run, runDir, same);
  assert.equal(run.paths.runDir, linked.runDir, "same place: stored string kept");
  assert.equal(run.paths.state, linked.state);
  assert.equal(run.paths.report, path.join(runDir, "report.md"), "other place: rebuilt");
  assert.equal(run.audit.eventLogPath, path.join(linked.auditDir, "events.jsonl"));
}

console.log("rebind-run-paths: ok");
