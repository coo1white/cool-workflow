#!/usr/bin/env node
// pipelinecore-drivedecide-iterationbound-width — maxIterations,
// autoWidth, roundWidth. SPEC/pipeline-run.md "Loop control in drive()"
// (src/drive.ts:796-894) and "Rebuild risks" #6 ("plannedWorkers freeze +
// iteration bound").

const assert = require("node:assert/strict");
const { maxIterations, autoWidth, roundWidth, DEFAULT_SCHEDULING_POLICY } = require("../dist/core/pipeline/drive-decide");

// maxIterations formula: (plannedWorkers + loopExpansion) * (maxAttempts + 1) + 5.
{
  assert.equal(maxIterations(3, 0, DEFAULT_SCHEDULING_POLICY), (3 + 0) * (3 + 1) + 5);
  assert.equal(maxIterations(3, 0, DEFAULT_SCHEDULING_POLICY), 17);
}
{
  assert.equal(maxIterations(5, 10, DEFAULT_SCHEDULING_POLICY), (5 + 10) * (3 + 1) + 5, "loopExpansion must be ADDED to plannedWorkers before multiplying");
  assert.equal(maxIterations(5, 10, DEFAULT_SCHEDULING_POLICY), 65);
}

// maxIterations: zero planned workers and zero expansion still gives the
// constant tail (+5), never zero itself — the bound always allows at
// least a few steps.
{
  assert.equal(maxIterations(0, 0, DEFAULT_SCHEDULING_POLICY), 5);
}

// maxIterations: a custom policy with a different maxAttempts changes the
// multiplier.
{
  assert.equal(maxIterations(2, 0, { maxAttempts: 1 }), (2 + 0) * (1 + 1) + 5);
  assert.equal(maxIterations(2, 0, { maxAttempts: 1 }), 9);
}

// autoWidth: no runnable phase at all -> 1 (serial fallback).
{
  const run = { phases: [], tasks: [], workflow: { limits: { maxConcurrentAgents: 4 } } };
  assert.equal(autoWidth(run), 1);
}

// autoWidth: a runnable phase whose mode is NOT "parallel" (sequential or
// unset) -> 1, even if it has many tasks.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2", "t3"], mode: "sequential" }],
    tasks: [{ id: "t1", phase: "p1", status: "pending" }, { id: "t2", phase: "p1", status: "pending" }, { id: "t3", phase: "p1", status: "pending" }],
    workflow: { limits: { maxConcurrentAgents: 4 } },
  };
  assert.equal(autoWidth(run), 1);
}

// autoWidth: a parallel phase's width is min(max(1, maxConcurrentAgents),
// taskIds.length).
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2", "t3"], mode: "parallel" }],
    tasks: [{ id: "t1", phase: "p1", status: "pending" }, { id: "t2", phase: "p1", status: "pending" }, { id: "t3", phase: "p1", status: "pending" }],
    workflow: { limits: { maxConcurrentAgents: 2 } },
  };
  assert.equal(autoWidth(run), 2, "width caps at maxConcurrentAgents when fewer than the task count");
}

// autoWidth: width caps at taskIds.length when maxConcurrentAgents is
// larger than the phase's own task count.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"], mode: "parallel" }],
    tasks: [{ id: "t1", phase: "p1", status: "pending" }, { id: "t2", phase: "p1", status: "pending" }],
    workflow: { limits: { maxConcurrentAgents: 8 } },
  };
  assert.equal(autoWidth(run), 2, "width must not exceed the phase's own task count even with a generous concurrency limit");
}

// autoWidth: a zero or missing maxConcurrentAgents floors to 1 (the
// `Math.max(1, ...)` guard), never zero width.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"], mode: "parallel" }],
    tasks: [{ id: "t1", phase: "p1", status: "pending" }, { id: "t2", phase: "p1", status: "pending" }],
    workflow: { limits: { maxConcurrentAgents: 0 } },
  };
  assert.equal(autoWidth(run), 1, "a zero-configured concurrency must floor to width 1, never 0");
}

// roundWidth: an explicit concurrency > 1 WINS over autoWidth entirely.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1"], mode: "sequential" }],
    tasks: [{ id: "t1", phase: "p1", status: "pending" }],
    workflow: { limits: { maxConcurrentAgents: 4 } },
  };
  assert.equal(roundWidth(run, 5), 5, "explicit concurrency must override autoWidth even for a sequential phase");
}

// roundWidth: concurrency of exactly 1 or undefined falls through to
// autoWidth (the `concurrency && concurrency > 1` guard).
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"], mode: "parallel" }],
    tasks: [{ id: "t1", phase: "p1", status: "pending" }, { id: "t2", phase: "p1", status: "pending" }],
    workflow: { limits: { maxConcurrentAgents: 4 } },
  };
  assert.equal(roundWidth(run, 1), 2, "concurrency of exactly 1 must fall through to autoWidth, not force width 1");
  assert.equal(roundWidth(run, undefined), 2);
}

// roundWidth: concurrency of 0 also falls through to autoWidth.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1"], mode: "sequential" }],
    tasks: [{ id: "t1", phase: "p1", status: "pending" }],
    workflow: { limits: { maxConcurrentAgents: 4 } },
  };
  assert.equal(roundWidth(run, 0), 1);
}

process.stdout.write("pipelinecore-drivedecide-iterationbound-width: ok\n");
