#!/usr/bin/env node
// statecore-migration-error-strings (milestone 3) — pins the byte-exact
// migration error strings from SPEC/state-core.md "Migration error strings
// (byte-exact)", including the <desc> sub-format for non-integer
// schemaVersion values.

const assert = require("node:assert/strict");
const { migrateRunState, reverseRunState } = require("../dist/core/state/migrations");

// Non-object input.
{
  const { report } = migrateRunState(42);
  assert.deepEqual(report.errors, ["Run state must be a JSON object."]);
}
{
  const { report } = migrateRunState([1, 2, 3]);
  assert.deepEqual(report.errors, ["Run state must be a JSON object."], "an array must also count as non-object");
}
{
  const { report } = migrateRunState(null);
  assert.deepEqual(report.errors, ["Run state must be a JSON object."], "null must also count as non-object");
}

// Below-minimum schemaVersion.
{
  const { report } = migrateRunState({ schemaVersion: -5 });
  assert.deepEqual(report.errors, ["Unsupported run-state schemaVersion -5."]);
}

// Above-current (newer than runtime) schemaVersion.
{
  const { report } = migrateRunState({ schemaVersion: 5 });
  assert.deepEqual(report.errors, ["Run state schemaVersion 5 is newer than this CW runtime (1)."]);
}

// Non-integer schemaVersion: detects as +Infinity, description is
// "invalid (<typeof>: <String(value)>)".
{
  const { report } = migrateRunState({ schemaVersion: 1.5 });
  assert.equal(report.detectedSchemaVersion, Number.POSITIVE_INFINITY, "1.5 must detect as +Infinity");
  assert.deepEqual(
    report.errors,
    ["Run state schemaVersion invalid (number: 1.5) is newer than this CW runtime (1)."],
    "non-integer schemaVersion must format as invalid (number: 1.5)"
  );
}

// Non-numeric schemaVersion (a string).
{
  const { report } = migrateRunState({ schemaVersion: "one" });
  assert.deepEqual(
    report.errors,
    ["Run state schemaVersion invalid (string: one) is newer than this CW runtime (1)."],
    "a string schemaVersion must format with its typeof"
  );
}

// Missing required field errors (shape violation forces unsupported).
{
  const { report } = migrateRunState({ tasks: 123 });
  assert.ok(
    report.errors.includes("tasks must be an array when present."),
    "tasks must be an array when present error must appear"
  );
}
{
  const { report } = migrateRunState({ workflow: "not-an-object" });
  assert.ok(
    report.errors.includes("workflow must be an object when present."),
    "workflow must be an object when present error must appear"
  );
}

// reverseRunState: below-min and above-current target errors.
{
  const { report } = reverseRunState({ schemaVersion: 1 }, -1);
  assert.deepEqual(report.errors, ["Target schemaVersion -1 is below the minimum supported 0."]);
}
{
  const { report } = reverseRunState({ schemaVersion: 1 }, 5);
  assert.deepEqual(report.errors, ["Target schemaVersion 5 is newer than this CW runtime (1)."]);
}

// reverseRunState: destructive-change warning string.
{
  const { report } = reverseRunState({ schemaVersion: 1 }, 0);
  assert.ok(
    report.warnings.some((w) => w === 'Destructive reverse change at schemaVersion: removed 1'),
    "destructive reverse change warning must match SPEC exactly"
  );
}

process.stdout.write("statecore-migration-error-strings: ok\n");
