#!/usr/bin/env node
// maruntime-candidate-tie-bucket-performance — perf follow-up to cycle
// P1-1's review-fix (the bucket-collapse loop in buildCompactGraphFromView,
// core/state/state-explosion/graph.ts). The SAME
// `map.set(key, [...(map.get(key) || []), id])` anti-pattern was found by
// grep in detectTies (core/multi-agent/candidate-scoring.ts): every
// candidate appended to its tie-bucket rebuilt (copied) the whole
// accumulated array, so one large bucket (many candidates sharing a
// normalized score) cost O(N^2) instead of O(N). Fixed by growing each
// bucket's array with `.push()`.
//
// Measured directly against the ORIGINAL (unfixed) code before picking the
// budget below: a single cold detectTies call over 20000 same-scored
// candidates took 469ms; the push-based fix does the same call in a few ms.

const assert = require("node:assert/strict");
const { detectTies } = require("../dist/core/multi-agent/candidate-scoring");

const N = 20000;
const BUDGET_MS = 200;

// Worst case for the old bug: every candidate shares one normalized score,
// so they all land in a single ever-growing bucket.
const rows = Array.from({ length: N }, (_, i) => ({ candidateId: `c${i}`, normalized: 0.5 }));

// Correctness: one giant tie group, in original append order, nothing
// dropped or duplicated.
{
  const ties = detectTies(rows);
  assert.equal(ties.length, 1, "every candidate shares the same normalized score, so there is exactly one tie group");
  assert.deepEqual(ties[0], rows.map((row) => row.candidateId), "the fix must not change grouping or append order");
}

// A mix of scores still separates singleton candidates from real ties.
{
  const mixed = [
    { candidateId: "a1", normalized: 0.5 },
    { candidateId: "a2", normalized: 0.5 },
    { candidateId: "b1", normalized: 0.9 },
  ];
  assert.deepEqual(detectTies(mixed), [["a1", "a2"]], "a singleton-score candidate must not appear in the tie list");
}

// Performance: the ORIGINAL (unfixed) code measured 469ms (cold, single
// call) at this N; the push-based fix does it in a few ms. A 200ms budget
// fails hard on the old O(N^2) shape while leaving wide margin (tens of
// times the fixed measured time) against a slow/loaded CI box.
{
  const start = process.hrtime.bigint();
  detectTies(rows);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < BUDGET_MS, `detectTies over ${N} same-scored candidates took ${elapsedMs.toFixed(1)}ms, expected < ${BUDGET_MS}ms`);
}

process.stdout.write("maruntime-candidate-tie-bucket-performance: ok\n");
