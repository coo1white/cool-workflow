#!/usr/bin/env node
// pipelinecore-drivedecide-finalstatus — finalDriveStatus: the once/
// non-once branches and their exact precedence. SPEC/pipeline-run.md
// "Drive loop — src/drive.ts" (Final DriveResult.status,
// now src/core/pipeline/drive-decide.ts) and "Rebuild risks" #1 ("the park/block split").

const assert = require("node:assert/strict");
const { finalDriveStatus } = require("../dist/core/pipeline/drive-decide");

function inputs(overrides) {
  return {
    once: false,
    completedWorkers: 0,
    plannedWorkers: 0,
    committed: false,
    lastStepStatus: undefined,
    exhaustedMaxIterations: false,
    parkedWorkers: 0,
    ...overrides,
  };
}

// --once: all planned workers completed AND a commit happened -> "complete".
{
  const result = finalDriveStatus(inputs({ once: true, completedWorkers: 3, plannedWorkers: 3, committed: true }));
  assert.equal(result, "complete");
}

// --once: completed count matches planned but NOT committed -> falls
// through (not "complete" — committed is REQUIRED, not just task count).
{
  const result = finalDriveStatus(inputs({ once: true, completedWorkers: 3, plannedWorkers: 3, committed: false, lastStepStatus: "ok" }));
  assert.equal(result, "in-progress", "matching worker counts without a commit must NOT report complete");
}

// --once: last step parked -> "parked" (when not complete).
{
  const result = finalDriveStatus(inputs({ once: true, completedWorkers: 1, plannedWorkers: 3, lastStepStatus: "parked" }));
  assert.equal(result, "parked");
}

// --once: last step blocked -> "blocked".
{
  const result = finalDriveStatus(inputs({ once: true, completedWorkers: 1, plannedWorkers: 3, lastStepStatus: "blocked" }));
  assert.equal(result, "blocked");
}

// --once: neither complete nor parked/blocked -> "in-progress" (the
// catch-all for a mid-run single step).
{
  const result = finalDriveStatus(inputs({ once: true, completedWorkers: 1, plannedWorkers: 3, lastStepStatus: "ok" }));
  assert.equal(result, "in-progress");
}

// --once precedence: complete check runs FIRST — even if lastStepStatus
// happens to also be "parked", a fully-completed-and-committed run still
// reports "complete".
{
  const result = finalDriveStatus(inputs({ once: true, completedWorkers: 2, plannedWorkers: 2, committed: true, lastStepStatus: "parked" }));
  assert.equal(result, "complete", "the complete check must take priority over a stale lastStepStatus");
}

// Non-once: exhaustedMaxIterations ALWAYS wins -> "blocked", checked
// FIRST (before parked/blocked from lastStepStatus).
{
  const result = finalDriveStatus(inputs({ once: false, exhaustedMaxIterations: true, parkedWorkers: 5, lastStepStatus: "parked" }));
  assert.equal(result, "blocked", "iteration-bound exhaustion must report blocked, never parked, even with parked workers present");
}

// Non-once: parkedWorkers > 0 -> "parked" (this is the PARK/BLOCK split —
// parked workers ALWAYS win over a merely-blocked last step, since a
// parked worker is the more terminal/severe condition).
{
  const result = finalDriveStatus(inputs({ once: false, parkedWorkers: 1, lastStepStatus: "blocked" }));
  assert.equal(result, "parked", "any parked worker must report parked overall, even if the LAST step was merely blocked");
}

// Non-once: lastStepStatus "parked" with zero parkedWorkers ALSO reports
// "parked" (the OR condition: `parkedWorkers > 0 || lastStepStatus ===
// "parked"`).
{
  const result = finalDriveStatus(inputs({ once: false, parkedWorkers: 0, lastStepStatus: "parked" }));
  assert.equal(result, "parked");
}

// Non-once: no parked workers, no parked last step, but last step blocked
// -> "blocked".
{
  const result = finalDriveStatus(inputs({ once: false, parkedWorkers: 0, lastStepStatus: "blocked" }));
  assert.equal(result, "blocked");
}

// Non-once: none of the above -> "complete" (the final fallback; a
// finished, non-parked, non-blocked drive is complete).
{
  const result = finalDriveStatus(inputs({ once: false, parkedWorkers: 0, lastStepStatus: "complete" }));
  assert.equal(result, "complete");
}
{
  const result = finalDriveStatus(inputs({ once: false, parkedWorkers: 0, lastStepStatus: undefined }));
  assert.equal(result, "complete", "no last step at all (e.g. drive never ran) still falls to the complete default when nothing else applies");
}

process.stdout.write("pipelinecore-drivedecide-finalstatus: ok\n");
