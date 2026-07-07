#!/usr/bin/env node
// statecore-reverse-run-state (milestone 3) — pins reverseRunState's own
// status ladder and behavior, distinct from migrateRunState's (target
// version comparison, not "current schema version" comparison).
// SPEC/state-core.md: "reverseRunState(input, targetSchemaVersion,
// options) — same shape but takes a target version; refuses a target
// below min or above current; warns on destructive changes".

const assert = require("node:assert/strict");
const { reverseRunState } = require("../dist/core/state/migrations");

// Reversing schema 1 -> target 0 actually removes schemaVersion (via the
// declared reverse() edge) and reports status migrated (detected !==
// target).
{
  const { run, report } = reverseRunState({ schemaVersion: 1 }, 0);
  assert.equal("schemaVersion" in run, false, "reverse must delete schemaVersion when reversing to 0");
  assert.equal(report.status, "migrated", "detected (1) !== target (0) must report migrated");
  assert.equal(report.detectedSchemaVersion, 1);
  assert.equal(report.currentSchemaVersion, 0, "reverseRunState's report.currentSchemaVersion IS the target, not CURRENT_RUN_STATE_SCHEMA_VERSION");
}

// Reversing to the SAME version as detected reports current (no path
// needed) when there are no changes; findMigrationPath's fromVersion ===
// toVersion short-circuit applies here too.
{
  const { report } = reverseRunState({ schemaVersion: 1 }, 1);
  assert.equal(report.status, "current", "reversing to the same version with no other changes must report current");
  assert.equal(report.changes.length, 0);
}

// Non-object input still refuses with the same message as migrateRunState.
{
  const { report, run } = reverseRunState("nope", 0);
  assert.equal(report.status, "unsupported");
  assert.deepEqual(report.errors, ["Run state must be a JSON object."]);
  assert.deepEqual(run, {});
}

// dryRun defaults to false-ish (Boolean(undefined) = false) unless passed.
{
  const { report } = reverseRunState({ schemaVersion: 1 }, 0);
  assert.equal(report.dryRun, false, "dryRun must default to false when not passed");
}
{
  const { report } = reverseRunState({ schemaVersion: 1 }, 0, { dryRun: true });
  assert.equal(report.dryRun, true, "dryRun must be true when explicitly passed");
}

// statePath is carried through to the report untouched.
{
  const { report } = reverseRunState({ schemaVersion: 1 }, 0, { statePath: "/repo/.cw/runs/r1/state.json" });
  assert.equal(report.statePath, "/repo/.cw/runs/r1/state.json");
}

// No warning is produced for a non-destructive reverse (nothing removed).
{
  const { report } = reverseRunState({ schemaVersion: 1 }, 1);
  assert.deepEqual(report.warnings, [], "reversing to the same version must produce no destructive-change warnings");
}

process.stdout.write("statecore-reverse-run-state: ok\n");
