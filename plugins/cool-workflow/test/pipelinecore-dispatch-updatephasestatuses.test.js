#!/usr/bin/env node
// pipelinecore-dispatch-updatephasestatuses — updatePhaseStatuses: completed
// when every task is completed, running when some task is running or
// completed, else pending. SPEC/pipeline-run.md "Dispatch — src/dispatch.ts"
// (now src/core/pipeline/dispatch.ts).

const assert = require("node:assert/strict");
const { updatePhaseStatuses } = require("../dist/core/pipeline/dispatch");

function task(id, phase, status) {
  return { id, phase, status };
}
function phase(id, taskIds) {
  return { id, name: id, status: "pending", taskIds };
}

// Every task completed -> phase.status becomes "completed".
{
  const p = phase("p1", ["t1", "t2"]);
  const run = { phases: [p], tasks: [task("t1", "p1", "completed"), task("t2", "p1", "completed")] };
  updatePhaseStatuses(run);
  assert.equal(p.status, "completed");
}

// Some task running (not all completed) -> "running".
{
  const p = phase("p1", ["t1", "t2"]);
  const run = { phases: [p], tasks: [task("t1", "p1", "running"), task("t2", "p1", "pending")] };
  updatePhaseStatuses(run);
  assert.equal(p.status, "running");
}

// Some task completed but not all, and none running -> still "running"
// (the rule is "some running OR completed", not "all completed").
{
  const p = phase("p1", ["t1", "t2"]);
  const run = { phases: [p], tasks: [task("t1", "p1", "completed"), task("t2", "p1", "pending")] };
  updatePhaseStatuses(run);
  assert.equal(p.status, "running", "a partially-completed phase (no running tasks) still reports running, not pending");
}

// No task running or completed (all pending) -> "pending".
{
  const p = phase("p1", ["t1", "t2"]);
  const run = { phases: [p], tasks: [task("t1", "p1", "pending"), task("t2", "p1", "pending")] };
  updatePhaseStatuses(run);
  assert.equal(p.status, "pending");
}

// A phase with a failed/blocked task and no running/completed task ->
// "pending" (neither of the two special branches applies).
{
  const p = phase("p1", ["t1"]);
  const run = { phases: [p], tasks: [task("t1", "p1", "failed")] };
  updatePhaseStatuses(run);
  assert.equal(p.status, "pending");
}

// A phase with ZERO matching tasks: `phaseTasks.length > 0` guards the
// "completed" branch, so an empty phase does NOT flip to "completed" even
// though `.every()` on [] is vacuously true — it falls through to the
// "pending" default.
{
  const p = phase("p1", ["missing"]);
  const run = { phases: [p], tasks: [] };
  updatePhaseStatuses(run);
  assert.equal(p.status, "pending", "an empty-task phase must stay pending, the length guard prevents a vacuous 'completed'");
}

// Multiple phases are each updated independently in one call.
{
  const p1 = phase("p1", ["t1"]);
  const p2 = phase("p2", ["t2"]);
  const run = { phases: [p1, p2], tasks: [task("t1", "p1", "completed"), task("t2", "p2", "pending")] };
  updatePhaseStatuses(run);
  assert.equal(p1.status, "completed");
  assert.equal(p2.status, "pending");
}

// Mutates in place (no return value) and mutates the SAME phase objects
// passed in run.phases.
{
  const p = phase("p1", ["t1"]);
  const run = { phases: [p], tasks: [task("t1", "p1", "completed")] };
  const returned = updatePhaseStatuses(run);
  assert.equal(returned, undefined, "updatePhaseStatuses returns void");
  assert.equal(run.phases[0], p, "the same phase object reference must be mutated, not replaced");
  assert.equal(run.phases[0].status, "completed");
}

process.stdout.write("pipelinecore-dispatch-updatephasestatuses: ok\n");
