#!/usr/bin/env node
"use strict";

// normalizeRunState defaults, pinned through `cw state check <id> --write`
// against a hand-written legacy (schema-less) state.json:
//   - id from the run-dir basename
//   - createdAt/updatedAt default to epoch-0 ISO when absent
//   - loopStage defaults to "interpret"
//   - workflow.limits defaults to { maxAgents: 8, maxConcurrentAgents: 4 }
//   - every required array/record key gets its empty/default shape
// Also pins the migration status ladder (migrated vs current) and the
// dry-run-by-default / --write gate on the file actually changing.

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, readJson, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = freshDir("repo");
  const runId = "legacy-run";
  const runDir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const statePath = path.join(runDir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify({ foo: "bar" }));

  // dry run first: report says migrated, writeRequired true, file untouched
  const dry = run(["state", "check", runId], { cwd: repo });
  assert.equal(dry.status, 0);
  const dryReport = JSON.parse(dry.stdout);
  assert.equal(dryReport.status, "migrated");
  assert.equal(dryReport.detectedSchemaVersion, 0);
  assert.equal(dryReport.currentSchemaVersion, 1);
  assert.deepEqual(dryReport.supportedSchemaVersions, { min: 0, max: 1 });
  assert.equal(dryReport.dryRun, true);
  assert.equal(dryReport.writeRequired, true);
  assert.equal(dryReport.errors.length, 0);
  const stillRaw = fs.readFileSync(statePath, "utf8");
  assert.equal(stillRaw, JSON.stringify({ foo: "bar" }), "dry run must not touch the file");

  const idChange = dryReport.changes.find((c) => c.path === "id");
  assert.equal(idChange.after, runId);
  assert.equal("before" in idChange, false, "before must be OMITTED, not null, when absent");

  const createdChange = dryReport.changes.find((c) => c.path === "createdAt");
  assert.equal(createdChange.after, "1970-01-01T00:00:00.000Z");
  const updatedChange = dryReport.changes.find((c) => c.path === "updatedAt");
  assert.equal(updatedChange.after, "1970-01-01T00:00:00.000Z");

  const loopStageChange = dryReport.changes.find((c) => c.path === "loopStage");
  assert.equal(loopStageChange.after, "interpret");

  const limitsChange = dryReport.changes.find((c) => c.path === "workflow.limits");
  assert.deepEqual(limitsChange.after, { maxAgents: 8, maxConcurrentAgents: 4 });

  const workflowIdChange = dryReport.changes.find((c) => c.path === "workflow.id");
  assert.equal(workflowIdChange.after, "unknown-workflow");
  const workflowTitleChange = dryReport.changes.find((c) => c.path === "workflow.title");
  assert.equal(workflowTitleChange.after, "Unknown Workflow");

  // now --write and inspect the actual bytes on disk
  const wrote = run(["state", "check", runId, "--write"], { cwd: repo });
  assert.equal(wrote.status, 0);
  const wroteReport = JSON.parse(wrote.stdout);
  assert.equal(wroteReport.dryRun, false);

  const onDisk = readJson(statePath);
  assert.equal(onDisk.schemaVersion, 1);
  assert.equal(onDisk.id, runId);
  assert.equal(onDisk.createdAt, "1970-01-01T00:00:00.000Z");
  assert.equal(onDisk.updatedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(onDisk.loopStage, "interpret");
  assert.deepEqual(onDisk.workflow.limits, { maxAgents: 8, maxConcurrentAgents: 4 });
  assert.deepEqual(onDisk.tasks, []);
  assert.deepEqual(onDisk.dispatches, []);
  assert.deepEqual(onDisk.commits, []);
  assert.deepEqual(onDisk.phases, []);
  assert.deepEqual(onDisk.multiAgent, {
    schemaVersion: 1,
    runs: [],
    roles: [],
    groups: [],
    memberships: [],
    fanouts: [],
    fanins: [],
  });
  assert.deepEqual(onDisk.blackboard, {
    schemaVersion: 1,
    boards: [],
    topics: [],
    messages: [],
    contexts: [],
    artifacts: [],
    snapshots: [],
    decisions: [],
  });
  assert.deepEqual(onDisk.topologies, { schemaVersion: 1, runs: [] });

  // byte format still holds after the migration write
  const raw = fs.readFileSync(statePath, "utf8");
  assert.equal(raw, JSON.stringify(onDisk, null, 2) + "\n");

  // re-checking a now-current file reports "current", zero changes
  const again = run(["state", "check", runId], { cwd: repo });
  const againReport = JSON.parse(again.stdout);
  assert.equal(againReport.status, "current");
  assert.equal(againReport.writeRequired, false);
  assert.deepEqual(againReport.changes, []);
});
