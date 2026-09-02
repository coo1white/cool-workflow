#!/usr/bin/env node
// pipelinecore-commitgate-selection-candidate-errors — resolveCommitGate:
// the selection-pass and candidate-pass error codes (commit-selection-*,
// commit-candidate-*, commit-verifier-linkage-mismatch), each fired under
// its own precise condition. SPEC/pipeline-run.md "Commit gate —
// src/commit.ts" (now src/core/pipeline/commit-gate.ts).

const assert = require("node:assert/strict");
const { resolveCommitGate } = require("../dist/core/pipeline/commit-gate");

const NOW = "2026-07-04T00:00:00.000Z";

function baseRun(overrides) {
  return { id: "run-1", tasks: [], nodes: [], candidates: [], candidateSelections: [], ...overrides };
}

// commit-selection-not-found: a selectionId that does not resolve.
{
  const run = baseRun({});
  const res = resolveCommitGate(run, { reason: "manual", selectionId: "sel-missing" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-selection-not-found");
  assert.ok(err);
  assert.equal(err.message, "Commit selection not found: sel-missing");
}

// commit-selection-node-missing: the selection exists but no state node
// carries metadata.selectionId matching it.
{
  const run = baseRun({ candidateSelections: [{ id: "sel-1", candidateId: "cand-1", scoreId: "score-1" }] });
  const res = resolveCommitGate(run, { reason: "manual", selectionId: "sel-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-selection-node-missing");
  assert.ok(err);
  assert.equal(err.message, "Selection sel-1 has no state node");
}

// commit-selection-not-verified (via the selection pass): the selection
// node exists but is not kind:"candidate"/status:"verified".
{
  const selNode = { id: "n1", kind: "candidate", status: "pending", evidence: [], metadata: { selectionId: "sel-1" } };
  const run = baseRun({ candidateSelections: [{ id: "sel-1", candidateId: "cand-1", scoreId: "score-1" }], nodes: [selNode] });
  const res = resolveCommitGate(run, { reason: "manual", selectionId: "sel-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-selection-not-verified");
  assert.ok(err);
  assert.equal(err.message, "Selection sel-1 is not a verified candidate selection");
}

// commit-candidate-unscored (via the selection pass): the selection has no
// scoreId.
{
  const selNode = { id: "n1", kind: "candidate", status: "verified", evidence: [], metadata: { selectionId: "sel-1" } };
  const run = baseRun({ candidateSelections: [{ id: "sel-1", candidateId: "cand-1" }], nodes: [selNode] });
  const res = resolveCommitGate(run, { reason: "manual", selectionId: "sel-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-unscored");
  assert.ok(err);
  assert.equal(err.message, "Selection sel-1 has no score evidence");
}

// commit-verifier-linkage-mismatch (selection pass): an explicit
// verifierNodeId differs from the selection's own linked verifierNodeId.
{
  const selNode = { id: "n1", kind: "candidate", status: "verified", evidence: [], metadata: { selectionId: "sel-1" } };
  const run = baseRun({
    candidateSelections: [{ id: "sel-1", candidateId: "cand-1", scoreId: "score-1", verifierNodeId: "verifier-real" }],
    nodes: [selNode],
  });
  const res = resolveCommitGate(run, { reason: "manual", selectionId: "sel-1", verifierNodeId: "verifier-fake" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-verifier-linkage-mismatch");
  assert.ok(err);
  assert.equal(err.message, "Requested verifier verifier-fake is not linked to selection sel-1");
  assert.equal(err.details.requestedVerifierNodeId, "verifier-fake");
  assert.equal(err.details.linkedVerifierNodeId, "verifier-real");
}

// commit-candidate-not-found: an explicit candidateId that does not
// resolve.
{
  const run = baseRun({});
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-missing" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-not-found");
  assert.ok(err);
  assert.equal(err.message, "Commit candidate not found: cand-missing");
}

// commit-candidate-not-selectable: the candidate's status is "rejected" or
// "failed".
{
  const run = baseRun({ candidates: [{ id: "cand-1", status: "rejected", scores: ["s1"] }] });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-not-selectable");
  assert.ok(err);
  assert.equal(err.message, "Candidate cand-1 is rejected");
}
{
  const run = baseRun({ candidates: [{ id: "cand-1", status: "failed", scores: ["s1"] }] });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-not-selectable");
  assert.ok(err);
  assert.equal(err.message, "Candidate cand-1 is failed");
}

// commit-candidate-unscored (candidate pass): candidate.scores is empty.
{
  const run = baseRun({ candidates: [{ id: "cand-1", status: "verified", scores: [] }] });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-unscored");
  assert.ok(err);
  assert.equal(err.message, "Candidate cand-1 has no score evidence");
}

// commit-candidate-not-verified: candidate.status is not "verified".
{
  const run = baseRun({ candidates: [{ id: "cand-1", status: "pending", scores: ["s1"] }] });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-not-verified");
  assert.ok(err);
  assert.equal(err.message, "Candidate cand-1 is not verifier-gated");
}

// commit-candidate-selection-missing: no selection at all for the
// candidate (neither an explicit selectionId nor any selection whose
// candidateId matches).
{
  const run = baseRun({ candidates: [{ id: "cand-1", status: "verified", scores: ["s1"] }], candidateSelections: [] });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-selection-missing");
  assert.ok(err);
  assert.equal(err.message, "Candidate cand-1 has no verified selection");
}

// commit-selection-not-verified (candidate pass wording): a selection IS
// found for the candidate, but its state node is missing/not verified.
{
  const run = baseRun({
    candidates: [{ id: "cand-1", status: "verified", scores: ["s1"] }],
    candidateSelections: [{ id: "sel-1", candidateId: "cand-1", scoreId: "score-1", selectedAt: "2026-01-01T00:00:00.000Z" }],
  });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-selection-not-verified");
  assert.ok(err);
  assert.equal(err.message, "Candidate cand-1 selection sel-1 is not verified");
  assert.equal(err.details.status, "missing", "an absent selection node reports status 'missing' in details");
}

// commit-candidate-unscored (candidate-pass wording): the resolved
// selection has no scoreId.
{
  const selNode = { id: "n1", kind: "candidate", status: "verified", evidence: [], metadata: { selectionId: "sel-1" } };
  const run = baseRun({
    candidates: [{ id: "cand-1", status: "verified", scores: ["s1"] }],
    candidateSelections: [{ id: "sel-1", candidateId: "cand-1", selectedAt: "2026-01-01T00:00:00.000Z" }],
    nodes: [selNode],
  });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-candidate-unscored");
  assert.ok(err);
  assert.equal(err.message, "Candidate cand-1 selection sel-1 has no score evidence");
}

// commit-verifier-linkage-mismatch (candidate pass): requested
// verifierNodeId differs from the selection's OR candidate's linked one.
{
  const selNode = { id: "n1", kind: "candidate", status: "verified", evidence: [], metadata: { selectionId: "sel-1" } };
  const run = baseRun({
    candidates: [{ id: "cand-1", status: "verified", scores: ["s1"], verifierNodeId: "verifier-candidate-linked" }],
    candidateSelections: [{ id: "sel-1", candidateId: "cand-1", scoreId: "score-1", selectedAt: "2026-01-01T00:00:00.000Z" }],
    nodes: [selNode],
  });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1", verifierNodeId: "verifier-other" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-verifier-linkage-mismatch");
  assert.ok(err);
  assert.equal(err.message, "Requested verifier verifier-other is not linked to candidate cand-1");
}

// latestSelectionForCandidate: with no explicit selectionId, the
// candidate pass picks the selection with the LATEST selectedAt (byte
// compare), not the first or last by array order.
{
  const olderSel = { id: "sel-old", candidateId: "cand-1", scoreId: "s1", selectedAt: "2026-01-01T00:00:00.000Z" };
  const newerSel = { id: "sel-new", candidateId: "cand-1", scoreId: "s1", selectedAt: "2026-06-01T00:00:00.000Z", verifierNodeId: "verifier-1" };
  const newerNode = { id: "n-new", kind: "candidate", status: "verified", evidence: [], metadata: { selectionId: "sel-new" } };
  const verifierNode = { id: "verifier-1", kind: "verifier", status: "verified", evidence: [{ id: "e1", path: "src/a.ts:1" }] };
  const run = baseRun({
    candidates: [{ id: "cand-1", status: "verified", scores: ["s1"], workerId: "worker-1" }],
    candidateSelections: [olderSel, newerSel],
    nodes: [newerNode, verifierNode],
    workers: [{ id: "worker-1", sandboxProfileId: "profile-1" }],
  });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  assert.equal(res.selectionId, "sel-new", "the newest selection by selectedAt must be picked");
  assert.deepEqual(res.errors, []);
}

// A fully valid candidate + selection combo (with a matching verifierNode)
// produces zero errors and returns candidateId/selectionId/selectionNodeId.
{
  const verifierNode = { id: "verifier-1", kind: "verifier", status: "verified", evidence: [{ id: "e1", path: "src/a.ts:1" }] };
  const selNode = { id: "n1", kind: "candidate", status: "verified", evidence: [], metadata: { selectionId: "sel-1" } };
  const run = baseRun({
    candidates: [{ id: "cand-1", status: "verified", scores: ["s1"], verifierNodeId: "verifier-1", workerId: "worker-1" }],
    candidateSelections: [{ id: "sel-1", candidateId: "cand-1", scoreId: "score-1", verifierNodeId: "verifier-1", selectedAt: "2026-01-01T00:00:00.000Z" }],
    nodes: [selNode, verifierNode],
    workers: [{ id: "worker-1", sandboxProfileId: "profile-1" }],
  });
  const res = resolveCommitGate(run, { reason: "manual", candidateId: "cand-1" }, { now: NOW });
  assert.deepEqual(res.errors, []);
  assert.equal(res.candidateId, "cand-1");
  assert.equal(res.selectionId, "sel-1");
  assert.equal(res.selectionNodeId, "n1");
  assert.equal(res.verifierNodeId, "verifier-1");
}

process.stdout.write("pipelinecore-commitgate-selection-candidate-errors: ok\n");
