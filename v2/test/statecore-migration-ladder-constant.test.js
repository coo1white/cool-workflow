#!/usr/bin/env node
// statecore-migration-ladder-constant (milestone 3) — pins the
// RUN_STATE_MIGRATIONS ladder itself: exactly ONE step, from 0 to 1, with
// its exact description and its migrate()/reverse() behavior.
// SPEC/state-core.md: "RUN_STATE_MIGRATIONS — ONE step: from: 0, to: 1,
// description 'Mark legacy run state without schemaVersion as run-state
// schema 1.', migrate sets schemaVersion default; reverse deletes
// schemaVersion only when it equals 1".

const assert = require("node:assert/strict");
const { RUN_STATE_MIGRATIONS } = require("../dist/core/state/migrations");

// Exactly one step.
{
  assert.equal(RUN_STATE_MIGRATIONS.length, 1, "RUN_STATE_MIGRATIONS must have exactly one step");
}

// Exact from/to/description.
{
  const step = RUN_STATE_MIGRATIONS[0];
  assert.equal(step.from, 0);
  assert.equal(step.to, 1);
  assert.equal(step.description, "Mark legacy run state without schemaVersion as run-state schema 1.");
}

// migrate(): sets schemaVersion to 1 as a DEFAULT (only when absent).
{
  const step = RUN_STATE_MIGRATIONS[0];
  const state = {};
  const context = { changes: [], errors: [] };
  step.migrate(state, context);
  assert.equal(state.schemaVersion, 1, "migrate must set schemaVersion to 1 when absent");
  assert.equal(context.changes.length, 1, "migrate must record exactly one change");
}

// migrate(): does NOT override an already-present schemaVersion (setDefault
// semantics — only fills when undefined).
{
  const step = RUN_STATE_MIGRATIONS[0];
  const state = { schemaVersion: 1 };
  const context = { changes: [], errors: [] };
  step.migrate(state, context);
  assert.equal(state.schemaVersion, 1);
  assert.equal(context.changes.length, 0, "migrate must record no change when schemaVersion is already present");
}

// reverse(): deletes schemaVersion only when it equals 1 (CURRENT).
{
  const step = RUN_STATE_MIGRATIONS[0];
  const state = { schemaVersion: 1 };
  const context = { changes: [], errors: [] };
  step.reverse(state, context);
  assert.equal("schemaVersion" in state, false, "reverse must delete schemaVersion when it equals 1");
  assert.equal(context.changes.length, 1);
  assert.equal(context.changes[0].path, "schemaVersion");
  assert.equal(context.changes[0].before, 1);
  assert.equal(context.changes[0].after, undefined);
}

// reverse(): does nothing when schemaVersion is NOT 1 (e.g. already absent
// or some other value).
{
  const step = RUN_STATE_MIGRATIONS[0];
  const state = { schemaVersion: 0 };
  const context = { changes: [], errors: [] };
  step.reverse(state, context);
  assert.equal(state.schemaVersion, 0, "reverse must leave a non-1 schemaVersion untouched");
  assert.equal(context.changes.length, 0);
}

process.stdout.write("statecore-migration-ladder-constant: ok\n");
