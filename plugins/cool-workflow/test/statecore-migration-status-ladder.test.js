#!/usr/bin/env node
// statecore-migration-status-ladder (milestone 3) — pins the four-way
// status ladder: unsupported beats migrated beats normalized beats current.
// v2/PLAN.md byte-compat item 10 / SPEC/state-core.md "Migration status
// ladder + write gate", "Final status" invariant.

const assert = require("node:assert/strict");
const { migrateRunState } = require("../dist/core/state/migrations");

// current: schemaVersion already 1, and no normalization changes needed
// (a fully-formed, already-normalized run-state object).
{
  const alreadyNormalized = {
    schemaVersion: 1,
    id: "r1",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    cwd: "/repo",
    workflow: { id: "w", title: "W", summary: "", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: {
      runDir: "/repo/.cw/runs/r1", state: "/repo/.cw/runs/r1/state.json", report: "/repo/.cw/runs/r1/report.md",
      tasksDir: "/repo/.cw/runs/r1/tasks", resultsDir: "/repo/.cw/runs/r1/results", dispatchesDir: "/repo/.cw/runs/r1/dispatches",
      artifactsDir: "/repo/.cw/runs/r1/artifacts", commitsDir: "/repo/.cw/runs/r1/commits", stateNodesDir: "/repo/.cw/runs/r1/nodes",
      feedbackDir: "/repo/.cw/runs/r1/feedback", auditDir: "/repo/.cw/runs/r1/audit", workersDir: "/repo/.cw/runs/r1/workers",
      candidatesDir: "/repo/.cw/runs/r1/candidates", multiAgentDir: "/repo/.cw/runs/r1/multi-agent",
      blackboardDir: "/repo/.cw/runs/r1/blackboard", topologiesDir: "/repo/.cw/runs/r1/topologies",
    },
    nodes: [], contracts: [], feedback: [],
    audit: { schemaVersion: 1, eventLogPath: "/repo/.cw/runs/r1/audit/events.jsonl", summaryPath: "/repo/.cw/runs/r1/audit/summary.json", indexPath: "/repo/.cw/runs/r1/audit/index.json" },
    workers: [], sandboxProfiles: [], candidates: [], candidateSelections: [],
    multiAgent: { schemaVersion: 1, runs: [], roles: [], groups: [], memberships: [], fanouts: [], fanins: [] },
    blackboard: { schemaVersion: 1, boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] },
    topologies: { schemaVersion: 1, runs: [] },
  };
  const { report } = migrateRunState(alreadyNormalized);
  assert.equal(report.status, "current", "an already-complete schema-1 object with zero changes must report current");
  assert.equal(report.changes.length, 0);
  assert.equal(report.writeRequired, false);
}

// normalized: schemaVersion already 1, but some fields were missing/filled
// (changes.length > 0), no migration hop needed.
{
  const { report } = migrateRunState({ schemaVersion: 1 });
  assert.equal(report.status, "normalized", "schema 1 with filled-in defaults must report normalized");
  assert.ok(report.changes.length > 0);
  assert.equal(report.writeRequired, true);
}

// migrated: detected version below current (0), needed an actual migration
// hop through RUN_STATE_MIGRATIONS.
{
  const { report } = migrateRunState({});
  assert.equal(report.status, "migrated", "a legacy (no schemaVersion) object must report migrated");
  assert.equal(report.detectedSchemaVersion, 0);
}

// unsupported: detected version above current (newer than runtime).
{
  const { report } = migrateRunState({ schemaVersion: 2 });
  assert.equal(report.status, "unsupported", "schemaVersion newer than runtime must report unsupported");
  assert.equal(report.errors.length > 0, true);
}

// unsupported: detected version below min supported.
{
  const { report } = migrateRunState({ schemaVersion: -1 });
  assert.equal(report.status, "unsupported", "schemaVersion below min supported must report unsupported");
}

// unsupported: non-object input.
{
  const { report, run } = migrateRunState("just a string");
  assert.equal(report.status, "unsupported");
  assert.deepEqual(report.errors, ["Run state must be a JSON object."]);
  assert.deepEqual(run, {}, "non-object input must return run: {}");
}

// unsupported BEATS migrated/normalized: even a detected-legacy (0) object
// that ALSO has a shape error (e.g. tasks is a string, not an array) must
// land on unsupported, not migrated.
{
  const { report } = migrateRunState({ tasks: "not-an-array" });
  assert.equal(report.status, "unsupported", "a shape error must force unsupported even for an otherwise-migratable legacy object");
  assert.ok(report.errors.some((e) => e.includes("tasks")), "the tasks shape error must be present");
}

// writeRequired = changes.length > 0, tracked independently of status.
{
  const { report: r1 } = migrateRunState({});
  assert.equal(r1.writeRequired, true, "a legacy object always needs at least the schemaVersion change");

  const { report: r2 } = migrateRunState({ schemaVersion: 2 });
  assert.equal(r2.writeRequired, false, "an unsupported (too-new) report should reflect only the changes actually made (none, since it returns early)");
}

process.stdout.write("statecore-migration-status-ladder: ok\n");
