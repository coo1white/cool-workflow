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

// buildReviewPolicy: the string "false" must land as boolean false (P2 fix).
// CLI options arrive as strings; Boolean("false") is true, which silently
// ENABLED self-approval when the operator passed --allow-self-approval false.
{
  const policy = buildReviewPolicy({ allowSelfApproval: "false", requireAttestedActor: "false" }, undefined, NOW);
  assert.equal(policy.allowSelfApproval, false, 'the string "false" must parse as false, not Boolean-coerce to true');
  assert.equal(policy.requireAttestedActor, false, 'the string "false" must parse as false for requireAttestedActor too');
}

// buildReviewPolicy: the string "true" (and friends) still parse as true.
{
  const policy = buildReviewPolicy({ allowSelfApproval: "true", requireAttestedActor: "1" }, undefined, NOW);
  assert.equal(policy.allowSelfApproval, true, 'the string "true" parses as true');
  assert.equal(policy.requireAttestedActor, true, 'the string "1" parses as true');
}

// buildReviewPolicy: "false" on an UPDATE overrides an existing true — the
// exact operator action the old coercion silently inverted.
{
  const existing = buildReviewPolicy({ requiredApprovals: 1, allowSelfApproval: true }, undefined, NOW);
  const updated = buildReviewPolicy({ allowSelfApproval: "false" }, existing, "2026-07-04T00:00:00.000Z");
  assert.equal(updated.allowSelfApproval, false, 'updating with the string "false" turns the flag OFF, never on');
}

// buildReviewPolicy: an unrecognized boolean string throws — fail closed,
// never guess a gate-policy flag's value.
{
  assert.throws(() => buildReviewPolicy({ allowSelfApproval: "maybe" }, undefined, NOW), /Invalid boolean value/, "an unrecognized flag string must throw, not silently coerce");
}

process.stdout.write("macollab-review-policy-defaults: ok\n");
