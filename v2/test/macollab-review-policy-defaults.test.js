#!/usr/bin/env node
// macollab-review-policy-defaults — collaboration.ts's buildReviewPolicy:
// exact defaults, and how existing policy values carry forward when a
// new input is partial.
//
// Evidence: SPEC/multi-agent.md section F "setReviewPolicy" row:
// requiredApprovals 0, authorizedRoles ["*"], allowSelfApproval false,
// requireAttestedActor false, appliesTo ["commit"].

const assert = require("node:assert/strict");
const { buildReviewPolicy, createCollabId } = require("../dist/core/multi-agent/collaboration");

const NOW = "2026-07-03T00:00:00.000Z";

// buildReviewPolicy: exact defaults with no existing policy and empty input.
{
  const policy = buildReviewPolicy({}, undefined, NOW);
  assert.equal(policy.requiredApprovals, 0, "default requiredApprovals is 0");
  assert.deepEqual(policy.authorizedRoles, ["*"], "default authorizedRoles is [*]");
  assert.equal(policy.allowSelfApproval, false, "default allowSelfApproval is false");
  assert.equal(policy.requireAttestedActor, false, "default requireAttestedActor is false");
  assert.deepEqual(policy.appliesTo, ["commit"], "default appliesTo is [commit]");
  assert.equal(policy.id, createCollabId("policy", 0), "no existing policy -> a fresh policy id (count 0)");
  assert.equal(policy.updatedAt, NOW, "updatedAt is the passed clock value");
}

// buildReviewPolicy: requiredApprovals is floored and clamped at 0 minimum.
{
  const policy = buildReviewPolicy({ requiredApprovals: 2.9 }, undefined, NOW);
  assert.equal(policy.requiredApprovals, 2, "requiredApprovals is floored, not rounded");
  const negative = buildReviewPolicy({ requiredApprovals: -5 }, undefined, NOW);
  assert.equal(negative.requiredApprovals, 0, "negative requiredApprovals clamps to 0");
}

// buildReviewPolicy: non-numeric requiredApprovals falls back to the existing value (or 0).
{
  const policy = buildReviewPolicy({ requiredApprovals: "not-a-number" }, undefined, NOW);
  assert.equal(policy.requiredApprovals, 0, "non-numeric requiredApprovals input falls back to 0 with no existing policy");
}

// buildReviewPolicy: authorizedRoles accepts a comma-separated string and dedupes/cleans it.
{
  const policy = buildReviewPolicy({ authorizedRoles: "reviewer, lead ,reviewer" }, undefined, NOW);
  assert.deepEqual(policy.authorizedRoles, ["reviewer", "lead"], "comma-separated string is split, trimmed, and deduped");
}

// buildReviewPolicy: appliesTo accepts an array or comma string, filters to valid target kinds only.
{
  const policy = buildReviewPolicy({ appliesTo: "commit,bogus-kind,selection" }, undefined, NOW);
  assert.deepEqual(policy.appliesTo, ["commit", "selection"], "invalid target kinds are dropped from appliesTo, valid ones kept");
}

// buildReviewPolicy: existing policy id/values carry forward when input is partial (this is an UPDATE, not a fresh create).
{
  const existing = buildReviewPolicy({ requiredApprovals: 2, authorizedRoles: ["lead"], allowSelfApproval: true }, undefined, NOW);
  const updated = buildReviewPolicy({ requireAttestedActor: true }, existing, "2026-07-04T00:00:00.000Z");
  assert.equal(updated.id, existing.id, "updating an existing policy keeps its id");
  assert.equal(updated.requiredApprovals, 2, "unset requiredApprovals in the new input carries the existing value forward");
  assert.deepEqual(updated.authorizedRoles, ["lead"], "unset authorizedRoles carries the existing value forward");
  assert.equal(updated.allowSelfApproval, true, "unset allowSelfApproval carries the existing value forward");
  assert.equal(updated.requireAttestedActor, true, "the one field actually given in this update is applied");
  assert.equal(updated.updatedAt, "2026-07-04T00:00:00.000Z", "updatedAt reflects the new clock value, not the old one");
}

// buildReviewPolicy: an empty/whitespace-only authorizedRoles/appliesTo input falls back to the existing/default list, not an empty array.
{
  const policy = buildReviewPolicy({ authorizedRoles: "   ,  " }, undefined, NOW);
  assert.deepEqual(policy.authorizedRoles, ["*"], "an authorizedRoles input that cleans to nothing falls back to the default [*], not []");
}

process.stdout.write("macollab-review-policy-defaults: ok\n");
