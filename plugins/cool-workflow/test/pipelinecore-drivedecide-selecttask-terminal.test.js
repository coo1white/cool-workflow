#!/usr/bin/env node
// pipelinecore-drivedecide-selecttask-terminal — selectDriveTask,
// countCompleted/countParked, verdictVerifierNodeId,
// exitCodeFromEvidence, hasTerminalCommit, and terminalOrConfigStep's
// commit/complete/blocked branches (the phase-gate half). This is
// drive-decide.ts, the most load-bearing pure function in the rebuild —
// SPEC/pipeline-run.md "Drive internals a rebuild must copy"
// (terminalOrConfigStep, now src/core/pipeline/drive-decide.ts).

const assert = require("node:assert/strict");
const {
  selectDriveTask,
  countCompleted,
  countParked,
  verdictVerifierNodeId,
  exitCodeFromEvidence,
  hasTerminalCommit,
  terminalOrConfigStep,
} = require("../dist/core/pipeline/drive-decide");

function task(id, phase, status, extra) {
  return { id, phase, status, ...extra };
}
function phase(id, taskIds) {
  return { id, name: id, status: "pending", taskIds };
}
function run(phases, tasks, commits) {
  return { id: "run-1", phases, tasks, commits: commits || [] };
}

// selectDriveTask: a RUNNING task in the runnable phase wins over a
// pending one (retries take priority per the SPEC's "serial driver takes
// a running task before a pending one").
{
  const r = run([phase("p1", ["t1", "t2"])], [task("t1", "p1", "pending"), task("t2", "p1", "running")]);
  const selected = selectDriveTask(r);
  assert.equal(selected.id, "t2", "a running task must be selected before a pending one");
}

// selectDriveTask: with no running task, the next pending task of the
// runnable phase is selected.
{
  const r = run([phase("p1", ["t1", "t2"])], [task("t1", "p1", "completed"), task("t2", "p1", "pending")]);
  const selected = selectDriveTask(r);
  assert.equal(selected.id, "t2");
}

// selectDriveTask: no runnable phase (blocked earlier phase) ->
// undefined.
{
  const r = run(
    [phase("p1", ["t1"]), phase("p2", ["t2"])],
    [task("t1", "p1", "failed"), task("t2", "p2", "pending")]
  );
  assert.equal(selectDriveTask(r), undefined);
}

// selectDriveTask: no phases at all -> undefined, no throw.
{
  assert.equal(selectDriveTask(run([], [])), undefined);
}

// countCompleted / countParked: simple status tallies.
{
  const r = run([], [task("t1", "p1", "completed"), task("t2", "p1", "failed"), task("t3", "p1", "failed"), task("t4", "p1", "pending")]);
  assert.equal(countCompleted(r), 1);
  assert.equal(countParked(r), 2, "parked == status:failed count, NOT status:blocked");
}

// verdictVerifierNodeId: only a COMPLETED task whose id matches
// /^verdict[:/]|^synthesis[:/]/i (case-insensitive) supplies the verifier.
{
  const r = run([], [task("verdict:final", "p1", "completed", { verifierNodeId: "v1" })]);
  assert.equal(verdictVerifierNodeId(r), "v1");
}
{
  const r = run([], [task("synthesis/final", "p1", "completed", { verifierNodeId: "v2" })]);
  assert.equal(verdictVerifierNodeId(r), "v2");
}
{
  const r = run([], [task("VERDICT:final", "p1", "completed", { verifierNodeId: "v3" })]);
  assert.equal(verdictVerifierNodeId(r), "v3", "the regex is case-insensitive");
}
// A verdict-id task that is NOT completed does not supply a verifier.
{
  const r = run([], [task("verdict:final", "p1", "running", { verifierNodeId: "v1" })]);
  assert.equal(verdictVerifierNodeId(r), undefined);
}
// A task id that merely CONTAINS "verdict" but doesn't match the anchored
// prefix pattern (verdict[:/] at the START) does not match.
{
  const r = run([], [task("final-verdict", "p1", "completed", { verifierNodeId: "v1" })]);
  assert.equal(verdictVerifierNodeId(r), undefined, "the regex is anchored to the START of the id, a suffix match must not count");
}
// No matching task at all -> undefined.
{
  const r = run([], [task("map:a", "p1", "completed", { verifierNodeId: "v1" })]);
  assert.equal(verdictVerifierNodeId(r), undefined);
}

// exitCodeFromEvidence: reads the "exitCode:<n>" evidence line;
// "exitCode:null" maps to null; no matching line -> null.
{
  assert.equal(exitCodeFromEvidence(["exitCode:0"]), 0);
  assert.equal(exitCodeFromEvidence(["exitCode:1"]), 1);
  assert.equal(exitCodeFromEvidence(["exitCode:null"]), null);
  assert.equal(exitCodeFromEvidence(["some.ts:1", "other.ts:2"]), null, "no exitCode: line at all -> null");
  assert.equal(exitCodeFromEvidence([]), null);
}

// hasTerminalCommit: true only when some commit's reason STARTS WITH
// "agent-delegation-drive" (not merely contains it).
{
  assert.equal(hasTerminalCommit(run([], [], [{ reason: "agent-delegation-drive: audited verdict committed" }])), true);
  assert.equal(hasTerminalCommit(run([], [], [{ reason: "manual" }])), false);
  assert.equal(hasTerminalCommit(run([], [], [{ reason: "prefix-agent-delegation-drive-suffix" }])), false, "must be a PREFIX match, not includes()");
  assert.equal(hasTerminalCommit(run([], [], [])), false);
  assert.equal(hasTerminalCommit(run([], [], [{ reason: undefined }])), false, "a commit with no reason string must not throw or match");
}

// terminalOrConfigStep: no selected task, ALL tasks completed, no terminal
// commit yet -> {kind:"commit"} with verdictVerifierNodeId threaded
// through.
{
  const r = run([], [task("verdict:final", "p1", "completed", { verifierNodeId: "v-final" })], []);
  const result = terminalOrConfigStep(r, undefined, true, undefined);
  assert.equal(result.kind, "commit");
  assert.equal(result.verifierNodeId, "v-final");
}

// terminalOrConfigStep: no selected task, all completed, but a terminal
// commit ALREADY exists -> {kind:"complete"} with the exact step shape.
{
  const r = run([], [task("t1", "p1", "completed")], [{ reason: "agent-delegation-drive: x" }]);
  const result = terminalOrConfigStep(r, undefined, true, undefined);
  assert.equal(result.kind, "complete");
  assert.deepEqual(result.step, { schemaVersion: 1, action: "complete", status: "complete", runId: "run-1" });
}

// terminalOrConfigStep: no selected task, NOT all completed (a parked
// task blocks the gate) -> {kind:"blocked"} with the exact reason string.
{
  const r = run([], [task("t1", "p1", "failed")], []);
  const result = terminalOrConfigStep(r, undefined, true, undefined);
  assert.equal(result.kind, "blocked");
  assert.equal(result.step.reason, "no eligible worker (a parked/failed worker blocks the phase gate)");
  assert.equal(result.step.action, "blocked");
  assert.equal(result.step.status, "blocked");
}

// terminalOrConfigStep: a selected task IS present -> proceeds past the
// terminal branch to the token-budget/agent-config checks (covered in the
// companion file); here just confirm it does NOT take the terminal branch
// when both budget and agent config are fine (kind: undefined).
{
  const r = run([phase("p1", ["t1"])], [task("t1", "p1", "pending")], []);
  const selected = r.tasks[0];
  const result = terminalOrConfigStep(r, selected, true, undefined);
  assert.equal(result.kind, undefined, "a ready, configured, in-budget task must fall through to process normally");
}

process.stdout.write("pipelinecore-drivedecide-selecttask-terminal: ok\n");
