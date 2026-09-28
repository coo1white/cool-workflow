#!/usr/bin/env node
// pipelinecore-dispatch-overlap — runnableTaskIds/nextDispatchTasks
// (dispatch.ts) and autoWidth/selectDriveTask (drive-decide.ts) with the
// `overlapPrevious` phase option: a phase with it is dispatched together
// with the phase(s) before it, chaining while each next phase also
// carries the flag; without it, behavior is exactly as before (a single
// phase's task ids only).

const assert = require("node:assert/strict");
const { runnableTaskIds, nextDispatchTasks } = require("../../../dist/core/pipeline/dispatch");
const { autoWidth, selectDriveTask } = require("../../../dist/core/pipeline/drive-decide");

function task(id, phase, status) {
  return { id, phase, status, kind: "agent", taskPath: `${id}.md`, prompt: "do it" };
}

function run(phases, tasks, maxConcurrentAgents) {
  return { phases, tasks, workflow: { limits: { maxConcurrentAgents } } };
}

function phase(id, taskIds, options = {}) {
  return { id, name: id, taskIds, mode: "parallel", status: "pending", ...options };
}

// --- No overlap: runnableTaskIds is the first runnable phase's ids only;
// nextDispatchTasks/autoWidth are unchanged from the pre-overlap shape. ---
{
  const phases = [phase("map", ["map:1", "map:2", "map:3"]), phase("assess", ["assess:1"])];
  const tasks = [task("map:1", "map", "pending"), task("map:2", "map", "pending"), task("map:3", "map", "pending"), task("assess:1", "assess", "pending")];
  const r = run(phases, tasks, 4);

  assert.deepEqual([...runnableTaskIds(r)], ["map:1", "map:2", "map:3"], "no overlapPrevious: only the first runnable phase's ids");

  const dispatched = nextDispatchTasks(r);
  assert.deepEqual(dispatched.map((t) => t.id), ["map:1", "map:2", "map:3"], "nextDispatchTasks is unchanged: just the map phase, capped by the limit");

  assert.equal(autoWidth(r), 3, "autoWidth = min(cap, group size) = min(4,3) = 3, same as before overlap existed");
}

// --- Overlap: phase 1 pending + phase 2 overlapPrevious -> both phases'
// ids; nextDispatchTasks returns Map tasks first then Assess (task-array
// order), capped by the limit; autoWidth = min(cap, group size). ---
{
  const phases = [phase("map", ["map:1", "map:2"]), phase("assess", ["assess:1", "assess:2"], { overlapPrevious: true })];
  const tasks = [task("map:1", "map", "pending"), task("map:2", "map", "pending"), task("assess:1", "assess", "pending"), task("assess:2", "assess", "pending")];
  const r = run(phases, tasks, 3);

  assert.deepEqual([...runnableTaskIds(r)].sort(), ["assess:1", "assess:2", "map:1", "map:2"].sort(), "overlapPrevious pulls the next phase's ids into the group");

  const dispatched = nextDispatchTasks(r);
  assert.deepEqual(dispatched.map((t) => t.id), ["map:1", "map:2", "assess:1"], "Map tasks come first (task-array order), then Assess, capped at the limit (3)");

  assert.equal(autoWidth(r), 3, "autoWidth = min(cap 3, group size 4) = 3");
}

// --- Chain stops at the first phase without the flag: phase 3 lacks
// overlapPrevious, so it is never pulled in even though phase 2 has it. ---
{
  const phases = [
    phase("map", ["map:1"]),
    phase("assess", ["assess:1"], { overlapPrevious: true }),
    phase("verify", ["verify:1"]),
  ];
  const tasks = [task("map:1", "map", "pending"), task("assess:1", "assess", "pending"), task("verify:1", "verify", "pending")];
  const r = run(phases, tasks, 10);

  assert.deepEqual([...runnableTaskIds(r)].sort(), ["assess:1", "map:1"].sort(), "the chain stops at the first phase without overlapPrevious (verify is excluded)");
}

// --- Phase 1 completed: the group starts at phase 2, and phase 2 alone
// (phase 3 is not pulled in since IT lacks the flag; phase 2's own
// overlapPrevious just describes its relation to phase 1, which is now
// moot since phase 1 is done). ---
{
  const phases = [
    phase("map", ["map:1"]),
    phase("assess", ["assess:1"], { overlapPrevious: true }),
    phase("verify", ["verify:1"]),
  ];
  const tasks = [task("map:1", "map", "completed"), task("assess:1", "assess", "pending"), task("verify:1", "verify", "pending")];
  const r = run(phases, tasks, 10);

  assert.deepEqual([...runnableTaskIds(r)], ["assess:1"], "with phase 1 completed, firstRunnablePhase is phase 2, and phase 3 is still excluded (it lacks overlapPrevious)");
}

// --- Phase 1 has a failed task and nothing pending/running: fail closed
// -> empty set, even though phase 2 (overlapPrevious) has pending tasks.
// A blocked phase gate must never be bypassed by an overlapping phase. ---
{
  const phases = [phase("map", ["map:1", "map:2"]), phase("assess", ["assess:1"], { overlapPrevious: true })];
  const tasks = [task("map:1", "map", "failed"), task("map:2", "map", "completed"), task("assess:1", "assess", "pending")];
  const r = run(phases, tasks, 10);

  assert.deepEqual([...runnableTaskIds(r)], [], "a failed task with nothing pending/running in phase 1 blocks everything, overlapping or not");
  assert.deepEqual(nextDispatchTasks(r), [], "nextDispatchTasks is empty too");
  assert.equal(autoWidth(r), 1, "autoWidth falls back to 1 when there is no runnable phase at all");
  assert.equal(selectDriveTask(r), undefined, "selectDriveTask is undefined when the phase gate is blocked");
}

// --- selectDriveTask: a running task in the group wins over any pending
// task, even a pending one earlier in run.tasks; absent a running task,
// the first pending task in the group is picked. ---
{
  const phases = [phase("map", ["map:1", "map:2"]), phase("assess", ["assess:1"], { overlapPrevious: true })];
  const tasksWithRunning = [task("map:1", "map", "pending"), task("map:2", "map", "running"), task("assess:1", "assess", "pending")];
  const rRunning = run(phases, tasksWithRunning, 10);
  assert.equal(selectDriveTask(rRunning)?.id, "map:2", "a running task in the group is selected first");

  const tasksAllPending = [task("map:1", "map", "pending"), task("map:2", "map", "pending"), task("assess:1", "assess", "pending")];
  const rPending = run(phases, tasksAllPending, 10);
  assert.equal(selectDriveTask(rPending)?.id, "map:1", "with no running task, the first pending task in the group (run.tasks order) is selected");
}

process.stdout.write("pipelinecore-dispatch-overlap: ok\n");
