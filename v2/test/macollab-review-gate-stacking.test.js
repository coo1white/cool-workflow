#!/usr/bin/env node
// macollab-review-gate-stacking — collaboration.ts's reviewGateErrors and
// commitReviewProvenance: THE load-bearing stacking rule.
//
// BYTE-COMPAT / REBUILD RISK 8 [load-bearing, per the source file's own
// header comment]: reviewGateErrors STACKS on top of a verifier/selection
// gate — it can only ADD StateNodeErrors, never replace or suppress one.
// A caller (candidate-scoring/commit-gate) is expected to APPEND this
// function's return value to its own failure list, never swap it in.
// This test asserts the concatenation semantics directly: a verifier
// error plus a review-gate error must BOTH survive in the combined list,
// and reviewGateErrors alone must never erase/mask a verifier error it
// knows nothing about (it only ever returns entries about ITSELF).
//
// Evidence: SPEC/multi-agent.md invariant 7 ("Selection gate... the review
// gate... stacks ON TOP and can only add errors"), rebuild risk 8.

const assert = require("node:assert/strict");
const { reviewGateErrors, commitReviewProvenance, buildReviewPolicy } = require("../dist/core/multi-agent/collaboration");

const NOW = "2026-07-03T00:00:00.000Z";

function approval(id, actorId, decision, createdAt) {
  return {
    schemaVersion: 1,
    id,
    runId: "run-1",
    createdAt,
    actor: { kind: "role", id: actorId, attestation: "operator-recorded", attested: false, roleId: "reviewer", source: "operator-recorded" },
    decision,
    target: { kind: "commit", id: "commit-1" },
    auditEventIds: [],
  };
}

// Simulated "verifier gate" failure a caller (candidate-scoring/commit-gate) would already have produced.
const VERIFIER_ERROR = { code: "candidate-verifier-not-verified", message: "Candidate x requires a verified verifier node", at: NOW, retryable: false };

// reviewGateErrors: no policy at all -> empty array (never gated, nothing to stack).
{
  const errors = reviewGateErrors("run-1", [], { targetKind: "commit", commitId: "commit-1" }, NOW);
  assert.deepEqual(errors, [], "no policy -> reviewGateErrors contributes nothing");
}

// reviewGateErrors: policy present but requiredApprovals 0 -> empty array (not gated).
{
  const policy = buildReviewPolicy({ requiredApprovals: 0 }, undefined, NOW);
  const errors = reviewGateErrors("run-1", [], { targetKind: "commit", commitId: "commit-1", policy }, NOW);
  assert.deepEqual(errors, [], "requiredApprovals 0 -> reviewGateErrors contributes nothing");
}

// reviewGateErrors: policy present but appliesTo excludes this targetKind -> empty array.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["selection"] }, undefined, NOW);
  const errors = reviewGateErrors("run-1", [], { targetKind: "commit", commitId: "commit-1", policy }, NOW);
  assert.deepEqual(errors, [], "policy does not apply to this target kind -> no errors contributed");
}

// reviewGateErrors: gated + satisfied (quorum met) -> empty array (an approved gate contributes nothing).
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z")];
  const errors = reviewGateErrors("run-1", approvals, { targetKind: "commit", commitId: "commit-1", policy }, NOW);
  assert.deepEqual(errors, [], "satisfied review gate contributes nothing, even though it IS gated");
}

// reviewGateErrors: gated + NOT satisfied -> exactly one StateNodeError with the fixed code and a message built from state.missing.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const errors = reviewGateErrors("run-1", [], { targetKind: "commit", commitId: "commit-1", policy }, NOW);
  assert.equal(errors.length, 1, "unsatisfied gate contributes exactly one error");
  assert.equal(errors[0].code, "review-gate-missing-approvals", "the fixed error code is review-gate-missing-approvals");
  assert.match(errors[0].message, /^Review gate blocked \(pending\): /, "message starts with 'Review gate blocked (<status>): '");
  assert.equal(errors[0].retryable, false, "review gate errors are never retryable");
  assert.equal(errors[0].at, NOW, "error timestamp is the passed clock value, not a real clock read");
}

// THE STACKING RULE: reviewGateErrors is agnostic of any OTHER (e.g. verifier) error a caller already
// collected. Concatenating its result onto an existing verifier-error list must preserve BOTH —
// the review-gate error never replaces, and never even inspects, a verifier error.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const callerCollectedErrors = [VERIFIER_ERROR]; // what a real caller (commit-gate) already has before consulting the review gate
  const gateErrors = reviewGateErrors("run-1", [], { targetKind: "commit", commitId: "commit-1", policy }, NOW);
  const combined = [...callerCollectedErrors, ...gateErrors];

  assert.equal(combined.length, 2, "stacking APPENDS the review-gate error onto the existing verifier error — total is 2, not 1");
  assert.equal(combined[0].code, "candidate-verifier-not-verified", "the verifier error survives unmodified as the first entry");
  assert.equal(combined[1].code, "review-gate-missing-approvals", "the review-gate error is appended as an ADDITIONAL entry, not swapped in for the verifier error");
  assert.ok(
    combined.some((e) => e.code === "candidate-verifier-not-verified") && combined.some((e) => e.code === "review-gate-missing-approvals"),
    "both a verifier failure and a review-gate failure can and must coexist in the same combined error list"
  );
}

// Genuine negative check: a SATISFIED review gate does NOT silently clear a pre-existing verifier error either —
// reviewGateErrors has no mechanism to remove entries from a caller's list; it only ever contributes its own.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z")];
  const callerCollectedErrors = [VERIFIER_ERROR];
  const gateErrors = reviewGateErrors("run-1", approvals, { targetKind: "commit", commitId: "commit-1", policy }, NOW);
  const combined = [...callerCollectedErrors, ...gateErrors];
  assert.equal(gateErrors.length, 0, "a satisfied gate contributes zero new errors");
  assert.equal(combined.length, 1, "the pre-existing verifier error is still present — an approved review gate cannot erase it");
  assert.equal(combined[0].code, "candidate-verifier-not-verified", "the verifier error is untouched by a satisfied review gate");
}

// commitReviewProvenance: undefined when not gated or not approved — this is the OTHER half of the same
// stacking discipline: provenance is only ever recorded for a gate that passed, never fabricated.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const notApproved = commitReviewProvenance("run-1", [], { targetKind: "commit", commitId: "commit-1", policy }, NOW);
  assert.equal(notApproved, undefined, "unsatisfied gate -> commitReviewProvenance is undefined, not a partial/fabricated record");

  const noPolicy = commitReviewProvenance("run-1", [], { targetKind: "commit", commitId: "commit-1" }, NOW);
  assert.equal(noPolicy, undefined, "no policy -> commitReviewProvenance is undefined (nothing to attest to)");
}

// commitReviewProvenance: approved gate -> a full record with sorted approvalIds.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [approval("collab-approval-0002", "amy", "approve", "2026-01-01T00:00:00.000Z"), approval("collab-approval-0001", "zoe", "approve", "2026-01-02T00:00:00.000Z")];
  const provenance = commitReviewProvenance("run-1", approvals, { targetKind: "commit", commitId: "commit-1", policy });
  assert.equal(provenance.policyId, policy.id, "provenance carries the policy id used to approve");
  assert.deepEqual(provenance.approvers, ["amy", "zoe"], "approvers sorted alphabetically");
  assert.deepEqual(provenance.approvalIds, [...provenance.approvalIds].sort(), "approvalIds is stored pre-sorted");
  assert.deepEqual(provenance.target, { kind: "commit", id: "commit-1" }, "provenance target matches the gated target");
}

// reviewGateErrors: different targetKinds resolve to their own target id fields (candidate/selection/node/task/run).
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["candidate"] }, undefined, NOW);
  const errors = reviewGateErrors("run-1", [], { targetKind: "candidate", candidateId: "candidate-1", policy }, NOW);
  assert.equal(errors.length, 1, "candidate targetKind is gated by an appliesTo:[candidate] policy");
  assert.equal(errors[0].details.targetKind, "candidate", "error details record the targetKind used for gating");
}

process.stdout.write("macollab-review-gate-stacking: ok\n");
