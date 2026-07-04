#!/usr/bin/env node
// statecore-normalize-defaults (milestone 3) — pins normalizeRunState's
// pinned defaults via migrateRunState, per v2/PLAN.md byte-compat item 4
// and SPEC/state-core.md "Normalization defaults": epoch-0 ISO timestamps,
// cwd = three dirs above the run dir else process.cwd(), workflow.limits =
// {maxAgents:8, maxConcurrentAgents:4}, loopStage "interpret".

const assert = require("node:assert/strict");
const path = require("node:path");
const { migrateRunState } = require("../dist/core/state/migrations");

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

// Bare legacy object (no schemaVersion, no statePath): createdAt/updatedAt
// both default to epoch-0 ISO, cwd falls back to process.cwd(), loopStage
// defaults to "interpret", workflow.limits gets the exact pinned object.
{
  const { run, report } = migrateRunState({});
  assert.equal(run.createdAt, EPOCH_ISO, "createdAt must default to epoch-0 ISO");
  assert.equal(run.updatedAt, EPOCH_ISO, "updatedAt must default to epoch-0 ISO");
  assert.equal(run.cwd, process.cwd(), "cwd must fall back to process.cwd() with no statePath");
  assert.equal(run.loopStage, "interpret", "loopStage must default to interpret");
  assert.deepEqual(
    run.workflow.limits,
    { maxAgents: 8, maxConcurrentAgents: 4 },
    "workflow.limits must default to the exact pinned object"
  );
  assert.equal(report.status, "migrated", "a bare {} with no schemaVersion must report status migrated");
}

// cwd = three directories above the run dir when statePath is given.
// statePath is <runDir>/state.json, so runDir's parent-parent-parent is cwd.
{
  const statePath = "/repo/.cw/runs/demo-run/state.json";
  const { run } = migrateRunState({}, { statePath });
  const runDir = path.dirname(statePath);
  const expectedCwd = path.resolve(runDir, "..", "..", "..");
  assert.equal(run.cwd, expectedCwd, "cwd must be three directories above the run dir");
  assert.equal(expectedCwd, "/repo", "concretely: /repo/.cw/runs/demo-run/../../.. resolves to /repo");
}

// id defaults to the run-dir basename when statePath is present.
{
  const statePath = "/repo/.cw/runs/demo-run/state.json";
  const { run } = migrateRunState({}, { statePath });
  assert.equal(run.id, "demo-run", "id must default to the run-dir basename");
}

// id defaults to "unknown-run" with no statePath and no existing id.
{
  const { run } = migrateRunState({});
  assert.equal(run.id, "unknown-run", "id must default to unknown-run with no statePath");
}

// An unknown/garbage loopStage VALUE is overwritten to "interpret" (not just
// defaulted when absent — actively normalized when invalid).
{
  const { run } = migrateRunState({ loopStage: "not-a-real-stage" });
  assert.equal(run.loopStage, "interpret", "an invalid loopStage value must be overwritten to interpret");
}

// A VALID loopStage value is preserved.
{
  for (const stage of ["interpret", "act", "observe", "adjust", "checkpoint"]) {
    const { run } = migrateRunState({ loopStage: stage });
    assert.equal(run.loopStage, stage, `a valid loopStage ${stage} must be preserved`);
  }
}

// createdAt/updatedAt copy EACH OTHER first, before falling back to epoch.
{
  const { run: run1 } = migrateRunState({ updatedAt: "2020-06-01T00:00:00.000Z" });
  assert.equal(run1.createdAt, "2020-06-01T00:00:00.000Z", "createdAt must copy from updatedAt when createdAt is absent");
  assert.equal(run1.updatedAt, "2020-06-01T00:00:00.000Z", "updatedAt is preserved as given");

  const { run: run2 } = migrateRunState({ createdAt: "2021-01-01T00:00:00.000Z" });
  assert.equal(run2.updatedAt, "2021-01-01T00:00:00.000Z", "updatedAt must copy from createdAt when updatedAt is absent");
  assert.equal(run2.createdAt, "2021-01-01T00:00:00.000Z", "createdAt is preserved as given");
}

// workflow.id/title/summary defaults.
{
  const { run } = migrateRunState({});
  assert.equal(run.workflow.id, "unknown-workflow");
  assert.equal(run.workflow.title, "Unknown Workflow");
  assert.equal(run.workflow.summary, "");
}

// workflow.id from legacy state.workflowId when present.
{
  const { run } = migrateRunState({ workflowId: "my-legacy-workflow" });
  assert.equal(run.workflow.id, "my-legacy-workflow", "workflow.id must come from legacy workflowId when present");
  assert.equal(run.workflow.title, "My Legacy Workflow", "workflow.title must be title-cased from the id");
}

// Existing workflow.limits is preserved (setDefault does not override).
{
  const { run } = migrateRunState({ workflow: { limits: { maxAgents: 2, maxConcurrentAgents: 1 } } });
  assert.deepEqual(run.workflow.limits, { maxAgents: 2, maxConcurrentAgents: 1 }, "existing workflow.limits must be preserved");
}

// All 16 paths.* entries are derived.
{
  const { run } = migrateRunState({}, { statePath: "/repo/.cw/runs/demo-run/state.json" });
  const pathKeys = [
    "runDir", "state", "report", "tasksDir", "resultsDir", "dispatchesDir",
    "artifactsDir", "commitsDir", "stateNodesDir", "feedbackDir", "auditDir",
    "workersDir", "candidatesDir", "multiAgentDir", "blackboardDir", "topologiesDir",
  ];
  for (const key of pathKeys) {
    assert.ok(key in run.paths, `paths.${key} must be present after normalization`);
  }
  assert.equal(run.paths.runDir, "/repo/.cw/runs/demo-run");
}

process.stdout.write("statecore-normalize-defaults: ok\n");
