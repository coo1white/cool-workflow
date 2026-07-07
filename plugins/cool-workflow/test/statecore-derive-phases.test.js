#!/usr/bin/env node
// statecore-derive-phases (milestone 3) — pins normalizeRunState's derived
// `phases` logic: grouped by task.phase (else "Workflow"), slugified ids,
// status completed only when every task in the phase is completed.
// SPEC/state-core.md "Normalization defaults": "phases derived from tasks
// when absent (group by task.phase else 'Workflow'); phase id is the
// slugified name; status is 'completed' only when every task in it is
// completed, else 'pending')".

const assert = require("node:assert/strict");
const { migrateRunState } = require("../dist/core/state/migrations");

// No tasks at all: phases derives to an empty array.
{
  const { run } = migrateRunState({ tasks: [] });
  assert.deepEqual(run.phases, [], "empty tasks must derive to empty phases");
}

// Tasks with no `phase` field group under "Workflow".
{
  const { run } = migrateRunState({
    tasks: [
      { id: "t1", status: "pending" },
      { id: "t2", status: "pending" },
    ],
  });
  assert.equal(run.phases.length, 1);
  assert.equal(run.phases[0].name, "Workflow");
  assert.equal(run.phases[0].id, "workflow", "slugified 'Workflow' must be 'workflow'");
  assert.deepEqual(run.phases[0].taskIds, ["t1", "t2"]);
  assert.equal(run.phases[0].status, "pending");
}

// Tasks grouped by an explicit phase name, slugified id.
{
  const { run } = migrateRunState({
    tasks: [
      { id: "t1", phase: "Plan Stage", status: "completed" },
      { id: "t2", phase: "Plan Stage", status: "completed" },
    ],
  });
  assert.equal(run.phases.length, 1);
  assert.equal(run.phases[0].name, "Plan Stage");
  assert.equal(run.phases[0].id, "plan-stage", "slugify must lowercase and hyphenate");
  assert.equal(run.phases[0].status, "completed", "a phase where every task is completed must report completed");
}

// A phase with a mix of statuses reports "pending" (not partially-completed).
{
  const { run } = migrateRunState({
    tasks: [
      { id: "t1", phase: "Mixed", status: "completed" },
      { id: "t2", phase: "Mixed", status: "running" },
    ],
  });
  assert.equal(run.phases[0].status, "pending", "a phase is pending unless ALL its tasks are completed");
}

// Multiple distinct phases each get their own entry.
{
  const { run } = migrateRunState({
    tasks: [
      { id: "t1", phase: "Alpha", status: "completed" },
      { id: "t2", phase: "Beta", status: "pending" },
    ],
  });
  const names = run.phases.map((p) => p.name).sort();
  assert.deepEqual(names, ["Alpha", "Beta"]);
}

// A task entry that is not an object (garbage in tasks array) is silently
// skipped by derivePhases (only touches record-shaped entries).
{
  const { run } = migrateRunState({
    tasks: [
      "not-a-task-object",
      { id: "t1", phase: "Real", status: "completed" },
    ],
  });
  assert.equal(run.phases.length, 1, "a non-object task entry must be silently ignored");
  assert.equal(run.phases[0].name, "Real");
}

// A task missing an id is skipped (no taskId to add to the phase).
{
  const { run } = migrateRunState({
    tasks: [
      { phase: "NoId", status: "completed" },
      { id: "t2", phase: "NoId", status: "completed" },
    ],
  });
  assert.deepEqual(run.phases[0].taskIds, ["t2"], "a task without an id must not appear in taskIds");
}

// Existing `phases` array (already present) is left untouched — derivation
// only runs when phases is ABSENT/not-an-array.
{
  const existingPhases = [{ id: "custom", name: "Custom", status: "running", taskIds: [] }];
  const { run } = migrateRunState({ phases: existingPhases, tasks: [{ id: "t1", phase: "Ignored", status: "completed" }] });
  assert.deepEqual(run.phases, existingPhases, "an already-present phases array must not be re-derived");
}

process.stdout.write("statecore-derive-phases: ok\n");
