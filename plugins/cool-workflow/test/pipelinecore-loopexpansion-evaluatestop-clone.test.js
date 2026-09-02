#!/usr/bin/env node
// pipelinecore-loopexpansion-evaluatestop-clone — evaluateLoopStop's
// budget-target/predicate branches and the atCap ceiling,
// cloneLoopRoundTasks's field reset, and loopControlNodeId's id format.
// SPEC/pipeline-run.md "loop() expansion — src/loop-expansion.ts +
// maybeExpandLoop" (now src/core/pipeline/loop-expansion.ts + src/shell/drive.ts).

const assert = require("node:assert/strict");
const { evaluateLoopStop, cloneLoopRoundTasks, loopControlNodeId, registerLoopPredicate } = require("../dist/core/pipeline/loop-expansion");

function ctx(overrides) {
  return { round: 1, roundResults: [], allResults: [], usageTotals: { totalTokens: 0 }, inputs: {}, ...overrides };
}

// No loop spec at all on the phase -> {done:true, atCap:false, reason:"no
// loop spec"}.
{
  const origin = { id: "p1", name: "P1", status: "pending", taskIds: [] };
  const decision = evaluateLoopStop(origin, 1, ctx());
  assert.deepEqual(decision, { done: true, atCap: false, reason: "no loop spec" });
}

// until:{kind:"budget-target"}: spent >= target -> done, with the exact
// reason string (spent/target format, same wording whether done or not).
{
  const origin = { id: "p1", name: "P1", status: "pending", taskIds: [], loop: { maxRounds: 5, until: { kind: "budget-target", target: 1000 } } };
  const decision = evaluateLoopStop(origin, 2, ctx({ usageTotals: { totalTokens: 1000 } }));
  assert.equal(decision.done, true);
  assert.equal(decision.reason, "budget-target: 1000/1000 recorded tokens");
  assert.equal(decision.atCap, false, "round 2 < maxRounds 5 -> not at cap");
}
{
  const origin = { id: "p1", name: "P1", status: "pending", taskIds: [], loop: { maxRounds: 5, until: { kind: "budget-target", target: 1000 } } };
  const decision = evaluateLoopStop(origin, 2, ctx({ usageTotals: { totalTokens: 500 } }));
  assert.equal(decision.done, false);
  assert.equal(decision.reason, "budget-target: 500/1000 recorded tokens");
}

// until:{kind:"predicate"}: an unregistered ref stops FAIL-CLOSED (done:
// true) with the exact "not registered" reason, never throwing.
{
  const origin = { id: "p1", name: "P1", status: "pending", taskIds: [], loop: { maxRounds: 5, until: { kind: "predicate", ref: "does-not-exist-xyz" } } };
  const decision = evaluateLoopStop(origin, 1, ctx());
  assert.equal(decision.done, true);
  assert.equal(decision.reason, 'loop predicate "does-not-exist-xyz" not registered — stopping fail-closed');
}

// until:{kind:"predicate"}: a registered predicate's own decision is used
// verbatim.
{
  registerLoopPredicate("evaluatestop-test-predicate", () => ({ done: false, reason: "custom reason" }));
  const origin = { id: "p1", name: "P1", status: "pending", taskIds: [], loop: { maxRounds: 5, until: { kind: "predicate", ref: "evaluatestop-test-predicate" } } };
  const decision = evaluateLoopStop(origin, 1, ctx());
  assert.equal(decision.done, false);
  assert.equal(decision.reason, "custom reason");
}

// atCap: round >= maxRounds forces done:true REGARDLESS of the underlying
// predicate/budget decision (`done: decision.done || atCap`), and atCap
// itself is reported true.
{
  registerLoopPredicate("evaluatestop-never-done-predicate", () => ({ done: false, reason: "still going" }));
  const origin = { id: "p1", name: "P1", status: "pending", taskIds: [], loop: { maxRounds: 3, until: { kind: "predicate", ref: "evaluatestop-never-done-predicate" } } };
  const decision = evaluateLoopStop(origin, 3, ctx());
  assert.equal(decision.done, true, "atCap must force done:true even when the predicate itself says not done");
  assert.equal(decision.atCap, true);
  assert.equal(decision.reason, "still going", "the underlying predicate's reason is still surfaced even though atCap overrides done");
}

// atCap: round exceeding maxRounds (not just equal) is also at-cap.
{
  const origin = { id: "p1", name: "P1", status: "pending", taskIds: [], loop: { maxRounds: 2, until: { kind: "budget-target", target: 999999 } } };
  const decision = evaluateLoopStop(origin, 5, ctx());
  assert.equal(decision.atCap, true);
  assert.equal(decision.done, true);
}

// cloneLoopRoundTasks: clones each template task with id suffixed
// "@r<nextRound>", status reset to "pending", loopStage reset to
// "interpret", loopRound set, and all run-specific fields cleared.
{
  const templateTasks = [
    {
      id: "map:a",
      status: "completed",
      loopStage: "act",
      dispatchId: "dispatch-0001",
      dispatchedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      result: { summary: "x", findings: [], evidence: [] },
      stateNodeId: "run-1:task:map:a",
      resultNodeId: "run-1:result:map:a",
      verifierNodeId: "run-1:verifier:map:a",
      workerId: "worker-1",
      workerManifestPath: "/run/workers/worker-1/manifest.json",
      taskPath: "/run/tasks/map-a.md",
      resultPath: "/run/results/map-a.md",
      phase: "map",
      kind: "map",
      prompt: "do it",
    },
  ];
  const origin = { id: "map", name: "Map", status: "completed", taskIds: ["map:a"], mode: "parallel" };
  const { phase, tasks } = cloneLoopRoundTasks(origin, templateTasks, 2);

  assert.equal(tasks.length, 1);
  const cloned = tasks[0];
  assert.equal(cloned.id, "map:a@r2");
  assert.equal(cloned.status, "pending");
  assert.equal(cloned.loopStage, "interpret");
  assert.equal(cloned.loopRound, 2);
  assert.equal(cloned.dispatchId, undefined);
  assert.equal(cloned.dispatchedAt, undefined);
  assert.equal(cloned.startedAt, undefined);
  assert.equal(cloned.completedAt, undefined);
  assert.equal(cloned.result, undefined);
  assert.equal(cloned.stateNodeId, undefined);
  assert.equal(cloned.resultNodeId, undefined);
  assert.equal(cloned.verifierNodeId, undefined);
  assert.equal(cloned.workerId, undefined);
  assert.equal(cloned.workerManifestPath, undefined);
  assert.equal(cloned.taskPath, "");
  assert.equal(cloned.resultPath, "");
  assert.equal(cloned.phase, "Map (round 2)", "phase is explicitly set to the new round's phase name (kind/prompt are not reset and still survive the clone)");
  assert.equal(cloned.kind, "map");
  assert.equal(cloned.prompt, "do it");

  assert.equal(phase.id, "map@r2");
  assert.equal(phase.name, "Map (round 2)");
  assert.equal(phase.status, "pending");
  assert.deepEqual(phase.taskIds, ["map:a@r2"]);
  assert.equal(phase.mode, "parallel", "mode must be copied from the origin phase");
  assert.equal(phase.loopOrigin, "map");
  assert.equal(phase.loopRound, 2);
}

// cloneLoopRoundTasks: multiple template tasks each get the SAME round
// suffix, and the new phase's taskIds lists them in the SAME order as the
// input template tasks.
{
  const templateTasks = [
    { id: "map:a", status: "completed", loopStage: "act", taskPath: "", resultPath: "" },
    { id: "map:b", status: "completed", loopStage: "act", taskPath: "", resultPath: "" },
  ];
  const origin = { id: "map", name: "Map", status: "completed", taskIds: ["map:a", "map:b"] };
  const { phase, tasks } = cloneLoopRoundTasks(origin, templateTasks, 3);
  assert.deepEqual(tasks.map((t) => t.id), ["map:a@r3", "map:b@r3"]);
  assert.deepEqual(phase.taskIds, ["map:a@r3", "map:b@r3"]);
}

// loopControlNodeId: exact format <runId>:loop-control:<originPhaseId>:r<round>.
{
  assert.equal(loopControlNodeId("run-1", "map", 2), "run-1:loop-control:map:r2");
}

process.stdout.write("pipelinecore-loopexpansion-evaluatestop-clone: ok\n");
