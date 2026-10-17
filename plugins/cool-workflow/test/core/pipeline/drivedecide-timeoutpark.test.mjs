#!/usr/bin/env node
// pipelinecore-drivedecide-timeoutpark — retryOrPark's timeout rule (new in
// 0.3.3, operator decision of 2026-10-17 in
// project/docs/intent/2026-10-16-release-gate-ci.md): a hop that ran past
// its time limit parks on its first try, with a next step in plain words;
// any other failure keeps the maxAttempts budget. An explicit
// maxTimeoutAttempts in the policy wins, but never goes above maxAttempts.

import assert from "node:assert/strict";
import { retryOrPark, timeoutAttemptLimit, hopRetryLine, DEFAULT_SCHEDULING_POLICY, TIMEOUT_PARK_NEXT_STEP } from "../../../dist/core/pipeline/drive-decide.js";

const reason = "agent hop refused: map:api: refused (delegation-failed) — agent process timed out after 600000ms and was killed";

// Default policy: a timeout parks at once.
{
  const decided = retryOrPark(0, DEFAULT_SCHEDULING_POLICY, reason, 600000);
  assert.equal(decided.status, "parked", "a timeout is not tried again by default");
  assert.equal(decided.attempts, 1);
  assert.equal(
    decided.parkedReason,
    `${reason} (attempt 1/1; limit 10m) — not tried again: raise CW_AGENT_TIMEOUT_MS (or --agent-timeout-ms) or check the agent command`
  );
  assert.equal(TIMEOUT_PARK_NEXT_STEP, "raise CW_AGENT_TIMEOUT_MS (or --agent-timeout-ms) or check the agent command");
}

// Not a timeout: the old three-try budget, byte for byte.
{
  assert.deepEqual(retryOrPark(0, DEFAULT_SCHEDULING_POLICY, "x"), { status: "retryable", attempts: 1 });
  assert.deepEqual(retryOrPark(0, DEFAULT_SCHEDULING_POLICY, "x", undefined), { status: "retryable", attempts: 1 });
  assert.deepEqual(retryOrPark(0, DEFAULT_SCHEDULING_POLICY, "x", 0), { status: "retryable", attempts: 1 }, "timedOutMs 0 is not a timeout");
  assert.deepEqual(retryOrPark(2, DEFAULT_SCHEDULING_POLICY, "x"), { status: "parked", attempts: 3, parkedReason: "x (attempt 3/3)" });
}

// A timeout after earlier non-timeout failures still parks at once.
{
  const decided = retryOrPark(1, DEFAULT_SCHEDULING_POLICY, reason, 600000);
  assert.equal(decided.status, "parked");
  assert.match(decided.parkedReason, /\(attempt 2; limit 10m\) — not tried again/);
}

// Explicit policy: maxTimeoutAttempts wins, capped by maxAttempts, never below 1.
{
  assert.equal(timeoutAttemptLimit({ maxAttempts: 3 }), 1);
  assert.equal(timeoutAttemptLimit({ maxAttempts: 3, maxTimeoutAttempts: 2 }), 2);
  assert.equal(timeoutAttemptLimit({ maxAttempts: 3, maxTimeoutAttempts: 9 }), 3, "never above maxAttempts");
  assert.equal(timeoutAttemptLimit({ maxAttempts: 5 }), 1, "raising maxAttempts alone does not retry timeouts");
  assert.equal(timeoutAttemptLimit({ maxAttempts: 3, maxTimeoutAttempts: 0 }), 1, "at least one try");
  assert.equal(timeoutAttemptLimit({ maxAttempts: 3, maxTimeoutAttempts: Number.NaN }), 1, "a bad value falls back to 1");
  const policy = { maxAttempts: 3, maxTimeoutAttempts: 2 };
  assert.deepEqual(retryOrPark(0, policy, reason, 600000), { status: "retryable", attempts: 1 });
  const second = retryOrPark(1, policy, reason, 600000);
  assert.equal(second.status, "parked");
  assert.match(second.parkedReason, /\(attempt 2\/2; limit 10m\) — not tried again/);
  assert.equal(hopRetryLine("map:api", "Map", reason, 1, policy, 600000), "✗ map:api (Map) — timed out after 10m; trying again (2/2)");
}

console.log("drivedecide-timeoutpark: ok");
