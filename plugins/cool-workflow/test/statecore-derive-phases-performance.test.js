#!/usr/bin/env node
// statecore-derive-phases-performance — perf follow-up to cycle P1-1's
// review-fix (the bucket-collapse loop in buildCompactGraphFromView,
// core/state/state-explosion/graph.ts). The SAME
// `map.set(key, [...(map.get(key) || []), id])` anti-pattern was found by
// grep in derivePhases (core/state/migrations.ts): every task appended to
// its phase's taskIds rebuilt (copied) the whole accumulated array, so one
// large phase (many tasks sharing a phase name) cost O(N^2) instead of
// O(N). Fixed by growing each phase's taskIds with `.push()`.
//
// derivePhases is exercised directly (it is now exported for this reason)
// instead of through migrateRunState/normalizeRunState: this same phase
// grouping also feeds tasksForPhaseCompleted, which does its own
// `tasks.find()` per task id and is a SEPARATE, pre-existing O(N^2) not
// touched by this fix. At the N needed to show the array-rebuild bug
// clearly, that unrelated cost dominates a migrateRunState call cold and
// would mask whether THIS fix helped. Calling derivePhases directly keeps
// the test's before/after signal attributable to the one line changed
// here. See statecore-derive-phases.test.js for derivePhases' correctness
// coverage through the public migrateRunState surface.
//
// Measured directly against the ORIGINAL (unfixed) code before picking the
// budget below: a single cold derivePhases call over 20000 same-phase
// tasks took 664ms; the push-based fix does the same call in a few ms.

const assert = require("node:assert/strict");
const { derivePhases } = require("../dist/core/state/migrations");

const N = 20000;
const BUDGET_MS = 150;

// Worst case for the old bug: every task shares one phase, so its taskIds
// array grows to N via N separate spread-rebuilds.
const tasks = Array.from({ length: N }, (_, i) => ({ id: `t${i}`, phase: "solo-phase" }));

// Correctness: one phase, every task id present in original append order.
{
  const phases = derivePhases(tasks);
  assert.equal(phases.length, 1, "every task shares one phase name");
  assert.equal(phases[0].name, "solo-phase");
  assert.deepEqual(phases[0].taskIds, tasks.map((task) => task.id), "the fix must not drop, duplicate, or reorder any task id");
}

// Multiple phases still separate correctly, each keeping its own order.
{
  const mixed = [
    { id: "a1", phase: "alpha" },
    { id: "b1", phase: "beta" },
    { id: "a2", phase: "alpha" },
  ];
  const phases = derivePhases(mixed);
  const alpha = phases.find((phase) => phase.name === "alpha");
  const beta = phases.find((phase) => phase.name === "beta");
  assert.deepEqual(alpha.taskIds, ["a1", "a2"], "a phase's taskIds must stay in append order even when interleaved with other phases");
  assert.deepEqual(beta.taskIds, ["b1"]);
}

// Performance: the ORIGINAL (unfixed) code measured 664ms (cold, single
// call) at this N; the push-based fix does it in a few ms. A 150ms budget
// fails hard on the old O(N^2) shape while leaving wide margin (well over
// 100x the fixed measured time) against a slow/loaded CI box.
{
  const start = process.hrtime.bigint();
  derivePhases(tasks);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < BUDGET_MS, `derivePhases over ${N} same-phase tasks took ${elapsedMs.toFixed(1)}ms, expected < ${BUDGET_MS}ms`);
}

process.stdout.write("statecore-derive-phases-performance: ok\n");
