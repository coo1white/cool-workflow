#!/usr/bin/env node
// pipelinecore-dispatch-firstrunnablephase — firstRunnablePhase: walks
// phases in order; running-task or pending-task phase wins; an incomplete
// phase with nothing pending/running blocks everything after it (null).
// SPEC/pipeline-run.md "Dispatch — src/dispatch.ts" (src/dispatch.ts:177-185).

const assert = require("node:assert/strict");
const { firstRunnablePhase } = require("../dist/core/pipeline/dispatch");

function task(id, phase, status) {
  return { id, phase, status };
}
function phase(id, taskIds) {
  return { id, name: id, status: "pending", taskIds };
}
function run(phases, tasks) {
  return { phases, tasks };
}

// A phase with a pending task is runnable.
{
  const r = run([phase("p1", ["t1"])], [task("t1", "p1", "pending")]);
  assert.equal(firstRunnablePhase(r).id, "p1");
}

// A phase with a running task is runnable (checked BEFORE the pending
// check, but either check alone would pick this phase too).
{
  const r = run([phase("p1", ["t1"])], [task("t1", "p1", "running")]);
  assert.equal(firstRunnablePhase(r).id, "p1");
}

// A fully completed first phase is skipped; the walk continues to the
// next phase with a pending task.
{
  const r = run(
    [phase("p1", ["t1"]), phase("p2", ["t2"])],
    [task("t1", "p1", "completed"), task("t2", "p2", "pending")]
  );
  assert.equal(firstRunnablePhase(r).id, "p2");
}

// An incomplete phase (not all completed) with NOTHING pending/running
// blocks everything after it: returns null even though a LATER phase has
// a pending task.
{
  const r = run(
    [phase("p1", ["t1"]), phase("p2", ["t2"])],
    [task("t1", "p1", "failed"), task("t2", "p2", "pending")]
  );
  assert.equal(firstRunnablePhase(r), null, "a blocked earlier phase must freeze the whole walk");
}

// All phases fully completed -> no runnable phase (falls through the
// entire loop to the final `return null`).
{
  const r = run([phase("p1", ["t1"])], [task("t1", "p1", "completed")]);
  assert.equal(firstRunnablePhase(r), null);
}

// Empty phases array -> null (loop body never runs).
{
  const r = run([], []);
  assert.equal(firstRunnablePhase(r), null);
}

// A phase with a "blocked" task and no pending/running task counts as
// incomplete (not "every task completed") -> blocks (returns null),
// mirroring the failed-task case above.
{
  const r = run([phase("p1", ["t1"])], [task("t1", "p1", "blocked")]);
  assert.equal(firstRunnablePhase(r), null);
}

// A phase whose taskIds reference tasks NOT present in run.tasks produces
// an empty phaseTasks array; `.every()` on an empty array is vacuously
// true, so it counts as "fully completed" and the walk moves on.
{
  const r = run(
    [phase("p1", ["missing-task"]), phase("p2", ["t2"])],
    [task("t2", "p2", "pending")]
  );
  assert.equal(firstRunnablePhase(r).id, "p2", "a phase with no matching tasks is vacuously complete and skipped");
}

// Multiple runnable phases: the FIRST in declaration order wins even if a
// later one also qualifies.
{
  const r = run(
    [phase("p1", ["t1"]), phase("p2", ["t2"])],
    [task("t1", "p1", "pending"), task("t2", "p2", "pending")]
  );
  assert.equal(firstRunnablePhase(r).id, "p1");
}

process.stdout.write("pipelinecore-dispatch-firstrunnablephase: ok\n");
