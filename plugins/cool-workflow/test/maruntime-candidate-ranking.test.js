#!/usr/bin/env node
// maruntime-candidate-ranking (multiagent-core bucket) — pins
// bestScore's tie-break, compareRankRows's sort order (normalized desc,
// then tieBreaker), detectTies's grouping-by-String(normalized),
// rankCandidateRows's end-to-end ranking.json shape, and this file's own
// NON-SORTING `unique()` (byte-compat item 3 counter-case, same family as
// topology.ts).
//
// Evidence: SPEC/multi-agent.md section E (rankCandidates row),
// "ranking.json shape" exact-outputs block, Edge cases (unique() family
// list), rebuild risk 1.

const assert = require("node:assert/strict");
const {
  unique,
  compareBytes,
  bestScore,
  compareRankRows,
  detectTies,
  rankCandidateRows,
  mergePolicy,
} = require("../dist/core/multi-agent/candidate-scoring");

// candidate-scoring.ts's unique(): same family as topology.ts — dedup
// only, insertion order preserved, does NOT sort.
{
  assert.deepEqual(unique(["z", "a", "z", "m"]), ["z", "a", "m"], "candidate-scoring unique() preserves insertion order, does NOT sort");
  assert.notDeepEqual(unique(["z", "a", "m"]), ["a", "m", "z"], "a sorted result here would mean this got wrongly collapsed with the kernel's sorting unique()");
}

// compareBytes: plain byte/string comparator, -1/0/1.
{
  assert.equal(compareBytes("a", "b"), -1);
  assert.equal(compareBytes("b", "a"), 1);
  assert.equal(compareBytes("a", "a"), 0);
}

function score(normalized, createdAt, id) {
  return { id: id || `score-${normalized}`, candidateId: "c1", createdAt, normalized, verdict: normalized >= 0.7 ? "pass" : "fail", total: 0, maxTotal: 1, criteria: {}, evidence: [], artifacts: [], schemaVersion: 1, scorer: "test" };
}

// bestScore: highest normalized wins; ties broken by createdAt ascending
// byte-compare, so on a tie the EARLIEST createdAt is treated as "best"
// (the sort itself is stable ascending on the tie-break key, only the
// primary normalized key sorts descending).
{
  const scores = [score(0.5, "2020-01-01T00:00:00.000Z"), score(0.9, "2020-01-02T00:00:00.000Z"), score(0.3, "2020-01-03T00:00:00.000Z")];
  const best = bestScore(scores);
  assert.equal(best.normalized, 0.9);
}
{
  const tieA = score(0.8, "2020-01-01T00:00:00.000Z", "score-a");
  const tieB = score(0.8, "2020-01-02T00:00:00.000Z", "score-b");
  const best = bestScore([tieA, tieB]);
  assert.equal(best.id, "score-a", "on a normalized tie, bestScore prefers the EARLIEST createdAt (ascending byte-compare tie-break)");
}
{
  assert.equal(bestScore([]), undefined, "no scores -> no best score");
}
{
  const scores = [score(0.9, "2020-01-01T00:00:00.000Z")];
  bestScore(scores);
  assert.equal(scores.length, 1, "bestScore does not mutate the input array's length");
}

// compareRankRows: sort by normalized descending; tie -> tieBreaker
// "createdAt" (default: createdAt then id byte-compare) or "candidateId".
{
  const policy = mergePolicy();
  const rowA = { candidate: { id: "c-a", status: "scored", createdAt: "2020-01-01T00:00:00.000Z", scores: [] }, normalized: 0.9 };
  const rowB = { candidate: { id: "c-b", status: "scored", createdAt: "2020-01-01T00:00:00.000Z", scores: [] }, normalized: 0.5 };
  assert.ok(compareRankRows(rowA, rowB, policy) < 0, "higher normalized sorts first");
}
{
  const policy = mergePolicy({ tieBreaker: "candidateId" });
  const rowA = { candidate: { id: "c-a", status: "scored", createdAt: "2020-01-02T00:00:00.000Z", scores: [] }, normalized: 0.5 };
  const rowB = { candidate: { id: "c-b", status: "scored", createdAt: "2020-01-01T00:00:00.000Z", scores: [] }, normalized: 0.5 };
  assert.ok(compareRankRows(rowA, rowB, policy) < 0, "candidateId tieBreaker compares ids directly, ignoring createdAt order");
}
{
  const policy = mergePolicy({ tieBreaker: "createdAt" });
  const rowA = { candidate: { id: "c-z", status: "scored", createdAt: "2020-01-01T00:00:00.000Z", scores: [] }, normalized: 0.5 };
  const rowB = { candidate: { id: "c-a", status: "scored", createdAt: "2020-01-02T00:00:00.000Z", scores: [] }, normalized: 0.5 };
  assert.ok(compareRankRows(rowA, rowB, policy) < 0, "createdAt tieBreaker: earlier createdAt sorts first");
}
{
  const policy = mergePolicy({ tieBreaker: "createdAt" });
  const rowA = { candidate: { id: "c-z", status: "scored", createdAt: "2020-01-01T00:00:00.000Z", scores: [] }, normalized: 0.5 };
  const rowB = { candidate: { id: "c-a", status: "scored", createdAt: "2020-01-01T00:00:00.000Z", scores: [] }, normalized: 0.5 };
  assert.ok(compareRankRows(rowA, rowB, policy) > 0, "full tie falls through to candidate id byte-compare");
}

// detectTies: groups candidate ids sharing String(normalized); singleton
// groups are excluded.
{
  const rows = [
    { candidateId: "c1", normalized: 0.5 },
    { candidateId: "c2", normalized: 0.5 },
    { candidateId: "c3", normalized: 0.9 },
  ];
  assert.deepEqual(detectTies(rows), [["c1", "c2"]], "only the 0.5-normalized pair forms a tie group");
}
{
  assert.deepEqual(detectTies([{ candidateId: "c1", normalized: 0.5 }]), [], "a single candidate has no tie group");
}

// rankCandidateRows end-to-end: excludes rejected unless includeRejected,
// sorts by normalized desc, assigns 1-based rank, computes ties.
{
  const policy = mergePolicy();
  const candidates = [
    { id: "c-low", status: "scored", createdAt: "2020-01-01T00:00:00.000Z", scores: ["s1"] },
    { id: "c-high", status: "scored", createdAt: "2020-01-02T00:00:00.000Z", scores: ["s2"] },
    { id: "c-rejected", status: "rejected", createdAt: "2020-01-03T00:00:00.000Z", scores: [] },
  ];
  const scoresByCandidate = (id) => {
    if (id === "c-low") return [score(0.3, "2020-01-01T00:00:00.000Z")];
    if (id === "c-high") return [score(0.9, "2020-01-02T00:00:00.000Z")];
    return [];
  };
  const ranking = rankCandidateRows("run-1", "2020-06-01T00:00:00.000Z", candidates, scoresByCandidate, policy, false);
  assert.equal(ranking.schemaVersion, 1);
  assert.equal(ranking.runId, "run-1");
  assert.equal(ranking.createdAt, "2020-06-01T00:00:00.000Z");
  assert.equal(ranking.candidates.length, 2, "rejected candidate excluded by default");
  assert.equal(ranking.candidates[0].candidateId, "c-high", "highest normalized ranks first");
  assert.equal(ranking.candidates[0].rank, 1);
  assert.equal(ranking.candidates[1].candidateId, "c-low");
  assert.equal(ranking.candidates[1].rank, 2);
  assert.deepEqual(ranking.ties, [], "no ties in this fixture");
}

{
  const policy = mergePolicy();
  const candidates = [{ id: "c-rejected", status: "rejected", createdAt: "2020-01-01T00:00:00.000Z", scores: [] }];
  const ranking = rankCandidateRows("run-1", "2020-06-01T00:00:00.000Z", candidates, () => [], policy, true);
  assert.equal(ranking.candidates.length, 1, "includeRejected=true keeps the rejected candidate");
}

process.stdout.write("maruntime-candidate-ranking: ok\n");
