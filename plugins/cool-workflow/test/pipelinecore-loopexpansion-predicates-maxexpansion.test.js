#!/usr/bin/env node
// pipelinecore-loopexpansion-predicates-maxexpansion — registerLoopPredicate/
// getLoopPredicate/hasLoopPredicate registry, the built-in "no-new-findings"
// and "single-round" predicates, and maxLoopExpansion's static worst-case
// formula. SPEC/pipeline-run.md "loop() expansion — src/loop-expansion.ts +
// maybeExpandLoop" (now src/core/pipeline/loop-expansion.ts).

const assert = require("node:assert/strict");
const { registerLoopPredicate, getLoopPredicate, hasLoopPredicate, maxLoopExpansion } = require("../dist/core/pipeline/loop-expansion");

// hasLoopPredicate/getLoopPredicate: the two built-ins are pre-registered.
{
  assert.equal(hasLoopPredicate("no-new-findings"), true);
  assert.equal(hasLoopPredicate("single-round"), true);
  assert.equal(hasLoopPredicate("does-not-exist"), false);
  assert.equal(getLoopPredicate("does-not-exist"), undefined);
}

// "single-round" always stops, with its exact reason string.
{
  const predicate = getLoopPredicate("single-round");
  const decision = predicate({ round: 1, roundResults: [], allResults: [], usageTotals: { totalTokens: 0 }, inputs: {} });
  assert.deepEqual(decision, { done: true, reason: "single-round: stop after one round" });
}

// "no-new-findings": every result in the round has NO findings -> done,
// with the exact "still has findings"-negation reason string.
{
  const predicate = getLoopPredicate("no-new-findings");
  const decision = predicate({
    round: 2,
    roundResults: [{ findings: [] }, { findings: [] }],
    allResults: [],
    usageTotals: { totalTokens: 0 },
    inputs: {},
  });
  assert.deepEqual(decision, { done: true, reason: "no-new-findings: the latest round produced no findings" });
}

// "no-new-findings": at least one result HAS findings -> not done.
{
  const predicate = getLoopPredicate("no-new-findings");
  const decision = predicate({
    round: 2,
    roundResults: [{ findings: [] }, { findings: [{ id: "f1" }] }],
    allResults: [],
    usageTotals: { totalTokens: 0 },
    inputs: {},
  });
  assert.deepEqual(decision, { done: false, reason: "no-new-findings: the latest round still has findings" });
}

// "no-new-findings": an undefined result entry or a non-array findings
// field both count as "no findings" (the `!r || !Array.isArray(r.findings)
// || r.findings.length === 0` guard).
{
  const predicate = getLoopPredicate("no-new-findings");
  const decision = predicate({
    round: 1,
    roundResults: [undefined, { findings: "not-an-array" }],
    allResults: [],
    usageTotals: { totalTokens: 0 },
    inputs: {},
  });
  assert.equal(decision.done, true, "undefined entries and non-array findings must both count as empty");
}

// "no-new-findings": an EMPTY roundResults array is vacuously "every result
// has no findings" -> done.
{
  const predicate = getLoopPredicate("no-new-findings");
  const decision = predicate({ round: 1, roundResults: [], allResults: [], usageTotals: { totalTokens: 0 }, inputs: {} });
  assert.equal(decision.done, true);
}

// registerLoopPredicate: re-registering a name OVERWRITES the previous
// function (registry semantics, not "first registration wins").
{
  registerLoopPredicate("custom-test-predicate", () => ({ done: false, reason: "v1" }));
  assert.equal(getLoopPredicate("custom-test-predicate")({}).reason, "v1");
  registerLoopPredicate("custom-test-predicate", () => ({ done: true, reason: "v2" }));
  assert.equal(getLoopPredicate("custom-test-predicate")({}).reason, "v2", "re-registering the same name must overwrite, not stack");
}

// maxLoopExpansion: zero with no loop phases at all.
{
  const run = { phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"] }] };
  assert.equal(maxLoopExpansion(run), 0);
}

// maxLoopExpansion: a single loop phase contributes (maxRounds - 1) *
// taskIds.length "extra" tasks.
{
  const run = {
    phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"], loop: { maxRounds: 3 } }],
  };
  assert.equal(maxLoopExpansion(run), (3 - 1) * 2, "extra = (maxRounds-1) * taskIds.length");
}

// maxLoopExpansion: sums across MULTIPLE loop-origin phases.
{
  const run = {
    phases: [
      { id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"], loop: { maxRounds: 3 } },
      { id: "p2", name: "p2", status: "pending", taskIds: ["t3"], loop: { maxRounds: 5 } },
      { id: "p3", name: "p3", status: "pending", taskIds: ["t4", "t5", "t6"] },
    ],
  };
  assert.equal(maxLoopExpansion(run), (3 - 1) * 2 + (5 - 1) * 1, "must sum contributions across all loop-origin phases, ignoring non-loop phases");
}

// maxLoopExpansion: a phase with loop.maxRounds <= 1 contributes ZERO (the
// `maxRounds > 1` guard) even though it technically has a loop spec.
{
  const run = { phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1", "t2"], loop: { maxRounds: 1 } }] };
  assert.equal(maxLoopExpansion(run), 0, "maxRounds of exactly 1 contributes no extra expansion");
}

// maxLoopExpansion: a phase whose loop.maxRounds is not a number (e.g.
// missing) is skipped, not NaN-poisoned into the sum.
{
  const run = { phases: [{ id: "p1", name: "p1", status: "pending", taskIds: ["t1"], loop: {} }] };
  assert.equal(maxLoopExpansion(run), 0);
}

// maxLoopExpansion: empty phases array -> 0.
{
  assert.equal(maxLoopExpansion({ phases: [] }), 0);
}

process.stdout.write("pipelinecore-loopexpansion-predicates-maxexpansion: ok\n");
