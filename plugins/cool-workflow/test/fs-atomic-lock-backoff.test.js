#!/usr/bin/env node
"use strict";

// fs-atomic-lock-backoff — pins the retry PACING of withFileLock's acquire
// loop (fs-atomic.ts). The loop no longer sleeps a flat 25ms between every
// miss for a fixed 240 tries; it sleeps a short, doubling backoff (capped),
// bounded by a wall-clock budget. This lets a briefly-held lock be re-grabbed
// in a few ms instead of paying a full 25ms floor per miss, while keeping the
// worst-case block at ~6s (a fixed try count with backoff would have roughly
// doubled it — the wall-clock bound is what prevents that).
//
// This test pins ONLY the deterministic backoff schedule (nextBackoffMs); the
// per-sleep jitter is random and not asserted here. The BEHAVIOURAL contracts
// — serialized RMW loses no update, a stale lock is stolen, a stolen lock
// throws, and exhausting the budget throws the exact message — are unchanged
// and stay covered by fs-atomic-file-lock.test.js, the *-lock-concurrency
// smokes, and fs-atomic-lock-steal-race-smoke.js.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const path = require("node:path");

const { nextBackoffMs } = require(path.join(__dirname, "..", "dist", "shell", "fs-atomic.js"));

// Exported at all? (Fails-first against the pre-change dist, where it does not
// exist and this require yields `undefined` -> not a function.)
assert.equal(typeof nextBackoffMs, "function", "nextBackoffMs must be exported from shell/fs-atomic");

// --- Doubles below the cap.
for (const prev of [1, 2, 4, 8, 16]) {
  assert.equal(nextBackoffMs(prev), prev * 2, `backoff doubles: ${prev} -> ${prev * 2}`);
}

// --- Caps at 50 (FILE_LOCK_BACKOFF_MAX_MS) and never climbs past it.
assert.equal(nextBackoffMs(32), 50, "32 doubles to 64 but is capped at 50");
assert.equal(nextBackoffMs(40), 50, "already-large value is capped at 50, not 80");
assert.equal(nextBackoffMs(50), 50, "at the cap it stays at the cap");
assert.equal(nextBackoffMs(1000), 50, "any input is capped at 50");

// --- Ramps from the base (1ms), reaches the cap fast, then stays there and
// never exceeds it. "Fast" is the point: the whole ramp must cost far less
// than the old flat 25ms-per-miss floor for the same number of early retries.
let prev = 1; // FILE_LOCK_BACKOFF_BASE_MS
const ceilings = [prev];
for (let i = 0; i < 12; i++) {
  const next = nextBackoffMs(prev);
  assert.ok(next >= prev, "backoff is non-decreasing");
  assert.ok(next <= 50, "backoff never exceeds the 50ms cap");
  ceilings.push(next);
  prev = next;
}
assert.equal(prev, 50, "the ramp reaches the 50ms cap");
assert.ok(ceilings.indexOf(50) <= 7, "the cap is reached within ~7 steps (a quick ramp)");

// The first five retry ceilings (1+2+4+8+16 = 31ms) sum to less than the old
// code's ~125ms (five flat 25ms sleeps) — this is the measurable win: brief
// contention clears in single-digit-to-low-tens of ms, not 25ms per miss.
const firstFiveCeilingSum = ceilings.slice(0, 5).reduce((a, b) => a + b, 0);
assert.ok(
  firstFiveCeilingSum < 40,
  `five early retries cost <40ms of ceiling (got ${firstFiveCeilingSum}), well under the old ~125ms floor`
);

process.stdout.write("fs-atomic-lock-backoff: ok (doubling + capped backoff schedule)\n");
