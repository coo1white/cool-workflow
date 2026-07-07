#!/usr/bin/env node
// maruntime-candidate-selection-gate (multiagent-core bucket) — pins
// selectionGateFailures's byte-exact gate ordering: not-selectable ->
// verifier-missing/no-evidence/empty-capture -> score-below-threshold.
// Also covers mergeById/mergeEvidence/countBy.
//
// Evidence: SPEC/multi-agent.md section E ("Verifier gate detail",
// "Selection failure messages" exact-outputs block), Invariant 7
// (selection gate ordering), rebuild risk 8 (verdict/gate constants).

const assert = require("node:assert/strict");
const { selectionGateFailures, mergePolicy, mergeById, mergeEvidence, countBy } = require("../dist/core/multi-agent/candidate-scoring");

function baseInput(overrides) {
  return {
    candidateId: "candidate-0001",
    candidateStatus: "scored",
    policy: mergePolicy(),
    verifierNode: { status: "verified", evidence: [{ id: "ev-1" }] },
    verifierNodeIsEmptyCapture: false,
    bestScoreNormalized: 0.9,
    ...overrides,
  };
}

// Happy path: no failures.
{
  const failures = selectionGateFailures(baseInput());
  assert.deepEqual(failures, []);
}

// not-selectable: rejected/failed candidate status, exact message + code.
{
  const failures = selectionGateFailures(baseInput({ candidateStatus: "rejected" }));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "candidate-not-selectable");
  assert.equal(failures[0].message, "Candidate candidate-0001 is rejected");
}
{
  const failures = selectionGateFailures(baseInput({ candidateStatus: "failed" }));
  assert.equal(failures[0].message, "Candidate candidate-0001 is failed");
}

// missing-verifier: no verifierNode at all, or one not in "verified" status.
{
  const failures = selectionGateFailures(baseInput({ verifierNode: undefined }));
  assert.equal(failures[0].code, "candidate-selection-missing-verifier");
  assert.equal(failures[0].message, "Candidate candidate-0001 requires a verified verifier node");
}
{
  const failures = selectionGateFailures(baseInput({ verifierNode: { status: "pending", evidence: [] } }));
  assert.equal(failures[0].code, "candidate-selection-missing-verifier", "a non-verified status also fails the verifier gate");
}

// missing-evidence: verifier node is verified but carries no evidence.
{
  const failures = selectionGateFailures(baseInput({ verifierNode: { status: "verified", evidence: [] } }));
  assert.equal(failures[0].code, "candidate-selection-missing-evidence");
  assert.equal(failures[0].message, "Candidate candidate-0001 verifier node has no evidence");
}

// empty-capture: verified, has evidence, but the caller says it's an
// empty-capture result.
{
  const failures = selectionGateFailures(baseInput({ verifierNodeIsEmptyCapture: true }));
  assert.equal(failures[0].code, "candidate-selection-empty-capture");
  assert.equal(failures[0].message, "Candidate candidate-0001 verifier node has no real evidence (empty-capture result)");
}

// score-below-threshold: only checked when policy.minNormalized is set;
// details carry the exact normalized/minNormalized pair.
{
  const failures = selectionGateFailures(baseInput({ policy: mergePolicy({ minNormalized: 0.95 }), bestScoreNormalized: 0.5 }));
  assert.equal(failures[0].code, "candidate-selection-score-below-threshold");
  assert.equal(failures[0].message, "Candidate candidate-0001 score is below threshold");
  assert.deepEqual(failures[0].details, { normalized: 0.5, minNormalized: 0.95 });
}
{
  const failures = selectionGateFailures(baseInput({ policy: mergePolicy(), bestScoreNormalized: 0.01 }));
  assert.deepEqual(failures, [], "no minNormalized set on the policy means the score-below-threshold check never fires, however low the score");
}
{
  const failures = selectionGateFailures(baseInput({ policy: mergePolicy({ minNormalized: 0.5 }), bestScoreNormalized: undefined }));
  assert.equal(failures[0].code, "candidate-selection-score-below-threshold", "an undefined bestScoreNormalized folds to 0 for the threshold comparison");
  assert.equal(failures[0].details.normalized, 0);
}

// requireVerifierGate=false or allowUnverified=true skips ALL verifier
// checks (missing/no-evidence/empty-capture), but not the other gates.
{
  const failures = selectionGateFailures(baseInput({ policy: mergePolicy({ requireVerifierGate: false }), verifierNode: undefined }));
  assert.deepEqual(failures, [], "requireVerifierGate=false bypasses the verifier gate entirely");
}
{
  const failures = selectionGateFailures(baseInput({ allowUnverified: true, verifierNode: undefined }));
  assert.deepEqual(failures, [], "allowUnverified=true bypasses the verifier gate too");
}

// Gate ORDERING: not-selectable is checked before the verifier gate,
// which is checked before the score gate — multiple failures append in
// that exact order (byte-compat / rebuild risk 8).
{
  const failures = selectionGateFailures(
    baseInput({
      candidateStatus: "rejected",
      verifierNode: undefined,
      policy: mergePolicy({ minNormalized: 0.9 }),
      bestScoreNormalized: 0.1,
    })
  );
  assert.deepEqual(
    failures.map((f) => f.code),
    ["candidate-not-selectable", "candidate-selection-missing-verifier", "candidate-selection-score-below-threshold"],
    "failures append in the exact SPEC gate order: not-selectable -> verifier -> score"
  );
}

// mergeById: right-side entries with a matching id REPLACE left-side
// ones in place; unmatched right-side entries append.
{
  const left = [{ id: "a", value: 1 }, { id: "b", value: 2 }];
  const right = [{ id: "b", value: 20 }, { id: "c", value: 3 }];
  const merged = mergeById(left, right);
  assert.deepEqual(merged, [{ id: "a", value: 1 }, { id: "b", value: 20 }, { id: "c", value: 3 }], "matching id replaces in place at the original position; new id appends");
}

// mergeEvidence: matches on the (id, source, path, locator) tuple, not id
// alone — two entries sharing an id but differing in source/path/locator
// are treated as distinct.
{
  const left = [{ id: "e1", source: "s1", path: "p1" }];
  const right = [{ id: "e1", source: "s1", path: "p1", locator: "new-locator" }];
  const merged = mergeEvidence(left, right);
  assert.equal(merged.length, 2, "a differing locator on the same id/source/path is treated as a NEW evidence entry, not a replacement");
}
{
  const left = [{ id: "e1", source: "s1", path: "p1", locator: "l1" }];
  const right = [{ id: "e1", source: "s1", path: "p1", locator: "l1", summary: "updated" }];
  const merged = mergeEvidence(left, right);
  assert.equal(merged.length, 1, "an exact (id,source,path,locator) match replaces in place");
  assert.equal(merged[0].summary, "updated");
}

// countBy (shared implementation with runtime.ts's helper).
{
  assert.deepEqual(countBy([{ k: "x" }, { k: "y" }, { k: "x" }], (item) => item.k), { x: 2, y: 1 });
}

process.stdout.write("maruntime-candidate-selection-gate: ok\n");
