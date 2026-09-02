#!/usr/bin/env node
// pipelinecore-drivedecide-retrypark — retryOrPark and priorAttempts: the
// EXACT attempt-accounting ordering (max of in-memory vs persisted
// retryCount BEFORE adding one). SPEC/pipeline-run.md "Drive internals a
// rebuild must copy" (handleHop, now src/shell/drive.ts) and "Rebuild
// risks" #3 ("Attempt accounting").

const assert = require("node:assert/strict");
const { priorAttempts, retryOrPark, DEFAULT_SCHEDULING_POLICY } = require("../dist/core/pipeline/drive-decide");

// DEFAULT_SCHEDULING_POLICY.maxAttempts is 3.
{
  assert.deepEqual(DEFAULT_SCHEDULING_POLICY, { maxAttempts: 3 });
}

// priorAttempts: max(inMemory, persisted) — persisted WINS when higher
// (this is the resumed-drive case: a killed process's in-memory count
// resets to 0, but the persisted retryCount on the worker scope survives).
{
  assert.equal(priorAttempts(0, 2), 2, "persisted retryCount must win when in-memory count is 0 (a fresh process resuming a killed drive)");
  assert.equal(priorAttempts(1, 0), 1, "in-memory count must win when persisted is 0 (no prior interrupt)");
  assert.equal(priorAttempts(2, 2), 2, "equal values -> that value, not doubled");
  assert.equal(priorAttempts(0, 0), 0);
}

// retryOrPark: THE CRITICAL ORDERING — priorAttempts is computed and
// passed in FIRST (by the caller, via priorAttempts()), THEN retryOrPark
// adds exactly ONE more attempt on top. Never the reverse (never add one
// to a raw in-memory count and then max against persisted afterward,
// which would silently under-count a resumed run by comparing
// already-incremented values against a stale persisted count).
{
  // Simulates: in-memory attempts = 0 (fresh process), persisted
  // retryCount = 2 (two prior attempts survived a kill). The CORRECT
  // order: prior = max(0, 2) = 2, then retryOrPark adds one -> attempts = 3.
  const prior = priorAttempts(0, 2);
  const decision = retryOrPark(prior, DEFAULT_SCHEDULING_POLICY, "agent hop failed");
  assert.equal(decision.attempts, 3, "prior=max(0,2)=2, plus one new attempt = 3");
  assert.equal(decision.status, "parked", "3 >= maxAttempts(3) -> parked");
  assert.equal(decision.parkedReason, "agent hop failed (attempt 3/3)");
}

// retryOrPark: attempts below maxAttempts -> "retryable", parkedReason is
// undefined.
{
  const decision = retryOrPark(0, DEFAULT_SCHEDULING_POLICY, "agent hop failed");
  assert.equal(decision.attempts, 1);
  assert.equal(decision.status, "retryable");
  assert.equal(decision.parkedReason, undefined);
}
{
  const decision = retryOrPark(1, DEFAULT_SCHEDULING_POLICY, "agent hop failed");
  assert.equal(decision.attempts, 2);
  assert.equal(decision.status, "retryable", "2 attempts < maxAttempts(3) -> still retryable");
}

// retryOrPark: attempts EQUAL to maxAttempts parks (>=, not just >).
{
  const decision = retryOrPark(2, DEFAULT_SCHEDULING_POLICY, "agent hop failed");
  assert.equal(decision.attempts, 3);
  assert.equal(decision.status, "parked");
}

// retryOrPark: parkedReason format is EXACTLY "<reason> (attempt
// <n>/<maxAttempts>)".
{
  const decision = retryOrPark(4, { maxAttempts: 3 }, "custom failure reason");
  assert.equal(decision.parkedReason, "custom failure reason (attempt 5/3)", "attempts can exceed maxAttempts if priorAttempts was already over the cap (e.g. a policy change) — the format string still reports the real count over the real cap");
}

// A custom (non-default) policy with maxAttempts:1 parks on the very
// FIRST attempt (0 prior -> 1 after retryOrPark, 1 >= 1).
{
  const decision = retryOrPark(0, { maxAttempts: 1 }, "no retries allowed");
  assert.equal(decision.status, "parked");
  assert.equal(decision.attempts, 1);
  assert.equal(decision.parkedReason, "no retries allowed (attempt 1/1)");
}

// Full resumed-drive scenario end to end: a drive that was killed after 2
// failed hops (persisted retryCount=2), resumed with a fresh in-memory
// count of 0, must park on its VERY NEXT failure (not retry two more
// times as a naive in-memory-only implementation would).
{
  const prior = priorAttempts(0, 2);
  const decision = retryOrPark(prior, DEFAULT_SCHEDULING_POLICY, "resumed hop failed");
  assert.equal(decision.status, "parked", "a resumed drive must count from the PERSISTED attempts, not restart from zero");
}

process.stdout.write("pipelinecore-drivedecide-retrypark: ok\n");
