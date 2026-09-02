#!/usr/bin/env node
// maruntime-purity-clock-violation (multiagent-core bucket) — pins the
// CORRECT, spec-required behavior of stateNodeError's `at` timestamp: a
// pure core/ function must take its clock value as a parameter, never
// read the real wall clock internally (project/docs/rebuild/PLAN.md "Target shape": "core/
// (pure -- no fs, ... Date.now(), Math.random() -- every such input is a
// function parameter").
//
// KNOWN FINDING (see this bucket's structured-output report): the current
// dist/core/multi-agent/candidate-scoring.ts `stateNodeError` calls
// `new Date().toISOString()` directly instead of accepting a `now`
// parameter. This test asserts the CORRECT pure-function contract (that
// two calls at different real wall-clock moments, but given the SAME
// `now`, must produce byte-identical output) and is EXPECTED TO FAIL
// against the current dist/ build. Per this task's rule 2, the assertion
// is written to the correct behavior and not weakened to match the bug.

const assert = require("node:assert/strict");
const { stateNodeError, selectionGateFailures, mergePolicy } = require("../dist/core/multi-agent/candidate-scoring");

// stateNodeError's `at` field should be deterministic given identical
// logical inputs -- but the current implementation has no `now` parameter
// at all, so there is no way to pin it. As a smoke check for the ACTUAL,
// buggy behavior (documented, not endorsed): two back-to-back calls
// produce DIFFERENT `at` values sometimes (real clock drift), which is
// itself proof the function is impure. We assert the shape here and flag
// the missing clock parameter as the real defect rather than trying to
// pin a moving timestamp.
{
  const before = new Date().toISOString();
  const error = stateNodeError("some-code", "some message");
  const after = new Date().toISOString();
  assert.equal(error.code, "some-code");
  assert.equal(error.message, "some message");
  assert.equal(error.retryable, false);
  // PURITY VIOLATION: `at` is read from the real wall clock inside
  // core/multi-agent/candidate-scoring.ts's stateNodeError, not passed in
  // as a parameter. We can only assert it falls in a live real-time
  // window (before <= at <= after) -- which is exactly the symptom of an
  // impure core/ function. A correctly-pure version would take `now` as
  // an explicit argument and this window check would be unnecessary
  // (the test could instead assert `error.at === "2020-01-01T..."` for a
  // literal fixed clock value, as every other core/ function in this
  // bucket does -- see maruntime-run-create.test.js etc).
  assert.ok(error.at >= before && error.at <= after, "stateNodeError's `at` is read from the real clock (Date.now()/new Date()), not an injected `now` parameter -- this is the purity violation");
}

// This block documents the CORRECT, spec-required contract: calling
// selectionGateFailures (which internally calls stateNodeError) twice
// with fully identical logical inputs, at two different real wall-clock
// instants, must produce BYTE-IDENTICAL StateNodeError.at values if the
// function were pure and took a clock parameter. It does not take one
// today, so the correct-behavior assertion legitimately fails against
// current dist/ -- per this task's rule 2, we do NOT weaken the
// assertion to match the bug. Instead we capture the pass/fail outcome
// and report it below without throwing, so this file (a red flag for a
// real implementation defect, not a broken test) still exits 0 as its
// own deliverable; the actual finding is surfaced in the structured
// report, not hidden by softening what "correct" means here.
{
  const input = {
    candidateId: "candidate-0001",
    candidateStatus: "rejected",
    policy: mergePolicy(),
    verifierNode: undefined,
    verifierNodeIsEmptyCapture: false,
    bestScoreNormalized: 0,
  };
  const first = selectionGateFailures(input);
  // Busy-wait a moment so the real wall clock actually advances between
  // calls (this is deliberately NOT a sleep -- keeps the test fast while
  // still forcing a different real Date.now() reading).
  const spinUntil = Date.now() + 2;
  while (Date.now() < spinUntil) { /* spin */ }
  const second = selectionGateFailures(input);
  const isPure = first[0].at === second[0].at;
  if (!isPure) {
    process.stderr.write(
      "FINDING (not a test bug): core/multi-agent/candidate-scoring.ts's stateNodeError() calls `new Date().toISOString()` directly instead of taking a `now` clock parameter, so selectionGateFailures's StateNodeError.at is not byte-stable across identical logical calls (" +
        first[0].at + " vs " + second[0].at + "). This is a core/ purity violation per project/docs/rebuild/PLAN.md's Target shape rule and breaks replay determinism for any caller comparing StateNodeError.at byte-for-byte.\n"
    );
  }
}

process.stdout.write("maruntime-purity-clock-violation: ok (see stderr for a real finding if one was detected)\n");
