#!/usr/bin/env node
// maruntime-candidate-scoring-math (multiagent-core bucket) — pins
// candidate-scoring.ts's pure math: mergePolicy defaults, verdictFor's
// 0.7/0.4/minNormalized thresholds, sumCriteria, computeScoreMath
// (maxTotal default max(total,1)), inferCandidateKind, id minting
// (createCandidateId/createScoreId/createSelectionId).
//
// Evidence: SPEC/multi-agent.md section E (scoreCandidate row),
// "Candidate scoring exact outputs" (verdict thresholds), rebuild risk 8.

const assert = require("node:assert/strict");
const {
  VERDICT_PASS_THRESHOLD,
  VERDICT_WARN_THRESHOLD,
  mergePolicy,
  verdictFor,
  sumCriteria,
  computeScoreMath,
  inferCandidateKind,
  createCandidateId,
  createScoreId,
  createSelectionId,
} = require("../dist/core/multi-agent/candidate-scoring");

// Thresholds are the exact SPEC constants.
{
  assert.equal(VERDICT_PASS_THRESHOLD, 0.7);
  assert.equal(VERDICT_WARN_THRESHOLD, 0.4);
}

// mergePolicy defaults.
{
  const policy = mergePolicy();
  assert.equal(policy.id, "cw.candidate.default");
  assert.equal(policy.title, "Default Candidate Scoring");
  assert.equal(policy.requireEvidence, true);
  assert.equal(policy.requireVerifierGate, true);
  assert.equal(policy.minNormalized, undefined);
  assert.equal(policy.tieBreaker, "createdAt");
}
{
  const policy = mergePolicy({ requireEvidence: false, tieBreaker: "candidateId", minNormalized: 0.5 });
  assert.equal(policy.requireEvidence, false);
  assert.equal(policy.tieBreaker, "candidateId");
  assert.equal(policy.minNormalized, 0.5);
}

// verdictFor: >= 0.7 pass, >= 0.4 warn, else fail; minNormalized override
// takes priority and forces fail below its own floor even if >= 0.7.
{
  const policy = mergePolicy();
  assert.equal(verdictFor(0.7, policy), "pass", "exactly at the pass threshold is pass");
  assert.equal(verdictFor(1, policy), "pass");
  assert.equal(verdictFor(0.69, policy), "warn", "just under pass threshold is warn");
  assert.equal(verdictFor(0.4, policy), "warn", "exactly at the warn threshold is warn");
  assert.equal(verdictFor(0.39, policy), "fail", "just under warn threshold is fail");
  assert.equal(verdictFor(0, policy), "fail");
}
{
  const policy = mergePolicy({ minNormalized: 0.9 });
  assert.equal(verdictFor(0.8, policy), "fail", "below minNormalized forces fail even though 0.8 >= 0.7 pass threshold");
  assert.equal(verdictFor(0.95, policy), "pass", "above minNormalized and above pass threshold still passes");
}

// sumCriteria: sums values, treats non-numeric/missing as 0.
{
  assert.equal(sumCriteria({ correctness: 1, evidence: 2 }), 3);
  assert.equal(sumCriteria({}), 0);
  assert.equal(sumCriteria({ a: undefined }), 0, "undefined criterion value folds to 0");
}

// computeScoreMath: maxTotal defaults to max(total, 1); normalized clamps
// to [0,1]; verdictOverride bypasses verdictFor entirely.
{
  const policy = mergePolicy();
  const result = computeScoreMath({ a: 3, b: 4 }, undefined, policy, undefined);
  assert.equal(result.total, 7);
  assert.equal(result.maxTotal, 7, "maxTotal defaults to the total itself (max(total,1))");
  assert.equal(result.normalized, 1);
  assert.equal(result.verdict, "pass");
}
{
  const policy = mergePolicy();
  const result = computeScoreMath({}, undefined, policy, undefined);
  assert.equal(result.total, 0);
  assert.equal(result.maxTotal, 1, "an all-zero criteria set still gets maxTotal floor of 1, never 0 (avoids divide-by-zero)");
  assert.equal(result.normalized, 0);
}
{
  const policy = mergePolicy();
  const result = computeScoreMath({ a: 5 }, 3, policy, undefined);
  assert.equal(result.maxTotal, 3, "an explicit maxTotal overrides the default");
  assert.equal(result.normalized, 1, "normalized is clamped to 1 even though 5/3 > 1");
}
{
  const policy = mergePolicy();
  const result = computeScoreMath({ a: 1 }, 10, policy, "warn");
  assert.equal(result.verdict, "warn", "an explicit verdictOverride bypasses verdictFor entirely");
}

// inferCandidateKind: workerId -> worker-output; resultNodeId/resultPath
// -> result; else manual.
{
  assert.equal(inferCandidateKind({ workerId: "w1" }), "worker-output");
  assert.equal(inferCandidateKind({ resultNodeId: "n1" }), "result");
  assert.equal(inferCandidateKind({ resultPath: "r.md" }), "result");
  assert.equal(inferCandidateKind({}), "manual");
  assert.equal(inferCandidateKind({ workerId: "w1", resultNodeId: "n1" }), "worker-output", "workerId takes priority over resultNodeId");
}

// createCandidateId: `candidate-<safeKind>-<safeSeed?>-<4-digit seq>`.
{
  assert.equal(createCandidateId(0, "manual"), "candidate-manual-0001", "no seed omits the seed segment");
  assert.equal(createCandidateId(0, "worker-output", "worker-1"), "candidate-worker-output-worker-1-0001");
  assert.equal(createCandidateId(9, "result", "node/1"), "candidate-result-node_1-0010", "seed is safe-file-named (slash becomes underscore)");
}

// createScoreId: `score-<safeCandidateId>-<4-digit seq>` (seq = existing
// score count + 1).
{
  assert.equal(createScoreId({ id: "candidate-manual-0001", scores: [] }), "score-candidate-manual-0001-0001");
  assert.equal(createScoreId({ id: "candidate-manual-0001", scores: ["score-1", "score-2"] }), "score-candidate-manual-0001-0003");
}

// createSelectionId: `selection-<safeCandidateId>-<4-digit seq>`.
{
  assert.equal(createSelectionId(0, "candidate-manual-0001"), "selection-candidate-manual-0001-0001");
  assert.equal(createSelectionId(3, "candidate-manual-0001"), "selection-candidate-manual-0001-0004");
}

process.stdout.write("maruntime-candidate-scoring-math: ok\n");
