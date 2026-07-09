#!/usr/bin/env node
// pipelinecore-phase-scan-performance — perf cycle P1-1.
//
// firstRunnablePhase/updatePhaseStatuses (core/pipeline/dispatch.ts) and
// selectDriveTask (core/pipeline/drive-decide.ts) used to re-scan
// `phase.taskIds.includes(task.id)` for every task, every phase, every call
// -- O(tasks x taskIds-per-phase) per call, which degrades to O(tasks^2)
// since total taskIds across phases scales with total tasks. Each of these
// is called several times per drive hop, so a whole run's cost compounded
// to O(tasks^3). Fixed by converting each phase's taskIds to a Set once
// before filtering. This test proves the fix holds by asserting a wall-clock
// budget that the OLD O(tasks^2)-per-call code could not have met (the
// original audit measured 254-712ms for a SINGLE firstRunnablePhase call at
// 5000 tasks; this budget allows for MANY calls at that scale).

const assert = require("node:assert/strict");
const { firstRunnablePhase, updatePhaseStatuses } = require("../dist/core/pipeline/dispatch");
const { selectDriveTask } = require("../dist/core/pipeline/drive-decide");

// Every phase but the last is fully completed, forcing the scan to walk
// through and re-filter every earlier phase before finding the one
// runnable phase -- the worst case the O(tasks^2) bug hit hardest.
function buildRun(numPhases, tasksPerPhase) {
  const phases = [];
  const tasks = [];
  for (let p = 0; p < numPhases; p++) {
    const taskIds = [];
    for (let t = 0; t < tasksPerPhase; t++) {
      const id = `p${p}-t${t}`;
      taskIds.push(id);
      const status = p < numPhases - 1 ? "completed" : "pending";
      tasks.push({ id, phase: `phase${p}`, status });
    }
    phases.push({ id: `phase${p}`, name: `phase${p}`, status: "pending", taskIds });
  }
  return { phases, tasks, workflow: { limits: {} } };
}

const NUM_PHASES = 20;
const TASKS_PER_PHASE = 250; // 5000 tasks total, matching the audit's measured scale
const CALLS = 100;
const run = buildRun(NUM_PHASES, TASKS_PER_PHASE);

// Correctness: the walk still finds the single runnable (last) phase.
{
  const found = firstRunnablePhase(run);
  assert.equal(found.id, `phase${NUM_PHASES - 1}`, "the fix must not change which phase is selected");
}
{
  const task = selectDriveTask(run);
  assert.equal(task.id, `p${NUM_PHASES - 1}-t0`, "the fix must not change which task is selected");
}

// Performance: 100 calls to firstRunnablePhase at 5000 tasks. The OLD
// O(tasks^2)-per-call code measured 254-712ms for a SINGLE call at this
// scale (100+ calls would take tens of seconds); the Set-based fix does
// this in low single-digit milliseconds total. A generous 3s budget for
// 100 calls still fails hard on any O(tasks^2) regression while leaving
// wide margin against a slow/loaded CI box.
{
  const start = process.hrtime.bigint();
  for (let i = 0; i < CALLS; i++) firstRunnablePhase(run);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < 3000, `${CALLS} calls to firstRunnablePhase at ${run.tasks.length} tasks took ${elapsedMs.toFixed(1)}ms, expected < 3000ms`);
}

// Same budget for updatePhaseStatuses (mutates in place; re-run on a fresh
// copy each call to keep the fixture's completed/pending shape stable).
{
  const start = process.hrtime.bigint();
  for (let i = 0; i < CALLS; i++) {
    const copy = { phases: run.phases.map((p) => ({ ...p })), tasks: run.tasks };
    updatePhaseStatuses(copy);
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < 3000, `${CALLS} calls to updatePhaseStatuses at ${run.tasks.length} tasks took ${elapsedMs.toFixed(1)}ms, expected < 3000ms`);
}

// Same budget for selectDriveTask.
{
  const start = process.hrtime.bigint();
  for (let i = 0; i < CALLS; i++) selectDriveTask(run);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < 3000, `${CALLS} calls to selectDriveTask at ${run.tasks.length} tasks took ${elapsedMs.toFixed(1)}ms, expected < 3000ms`);
}

process.stdout.write("pipelinecore-phase-scan-performance: ok\n");
