#!/usr/bin/env node
// macollab-derive-review-state — collaboration.ts's deriveReviewState:
// the pure review-state projection. Status ladder (approved/rejected/
// pending/blocked/unattributed), disqualification reasons (unattributed,
// unauthorized-role, self-approval, superseded), first-approval-per-actor
// counting, veto semantics, createdAt-then-id processing order.
//
// BYTE-COMPAT invariant 8 [load-bearing]: "Review gate fail-closed" — only
// distinct/attested/authorized/non-self/non-superseded approvals count.
//
// Evidence: SPEC/multi-agent.md section F "deriveReviewState" row,
// invariant 8/9, edge cases ("approvals processed in createdAt-then-id
// order; only the first approval per actor id counts", "reject with
// disqualify reason self-approval still counts as a veto").

const assert = require("node:assert/strict");
const { deriveReviewState, buildReviewPolicy } = require("../dist/core/multi-agent/collaboration");

const NOW = "2026-07-03T00:00:00.000Z";
const TARGET = { kind: "commit", id: "commit-1" };

function approval(id, actorId, decision, createdAt, extra = {}) {
  return {
    schemaVersion: 1,
    id,
    runId: "run-1",
    createdAt,
    actor: { kind: "role", id: actorId, attestation: "operator-recorded", attested: false, roleId: "reviewer", source: "operator-recorded" },
    decision,
    target: TARGET,
    auditEventIds: [],
    ...extra,
  };
}

// Not gated (no policy) -> always approved, regardless of any approvals present.
{
  const state = deriveReviewState("run-1", [], TARGET);
  assert.equal(state.status, "approved", "no policy at all -> approved (not gated)");
  assert.equal(state.gated, false, "gated is false with no policy");
  assert.deepEqual(state.missing, [], "not gated -> no missing entries");
}

// Not gated because requiredApprovals is 0 even with a policy present.
{
  const policy = buildReviewPolicy({ requiredApprovals: 0 }, undefined, NOW);
  const state = deriveReviewState("run-1", [], TARGET, { policy });
  assert.equal(state.gated, false, "policy with requiredApprovals 0 is not gated");
  assert.equal(state.status, "approved", "requiredApprovals 0 -> approved");
}

// Not gated because appliesTo does not include this target's kind.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["selection"] }, undefined, NOW);
  const state = deriveReviewState("run-1", [], TARGET, { policy });
  assert.equal(state.gated, false, "policy applies to selection, not commit -> not gated for a commit target");
}

// Gated, zero approvals -> pending.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const state = deriveReviewState("run-1", [], TARGET, { policy });
  assert.equal(state.gated, true, "policy requiring approvals and applying to commit -> gated");
  assert.equal(state.status, "pending", "gated with zero approvals recorded -> pending");
  assert.match(state.missing[0], /1 more approval\(s\) from authorized role\(s\) \[\*\] required \(have 0\/1\)/, "missing message matches the exact template");
}

// Quorum met -> approved; approvers list is sorted.
{
  const policy = buildReviewPolicy({ requiredApprovals: 2, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [approval("collab-approval-0001", "zoe", "approve", "2026-01-01T00:00:00.000Z"), approval("collab-approval-0002", "amy", "approve", "2026-01-02T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.status, "approved", "2 distinct approvals meets requiredApprovals 2 -> approved");
  assert.deepEqual(state.approvers, ["amy", "zoe"], "approvers list is sorted alphabetically regardless of approval order");
  assert.deepEqual(state.missing, [], "approved status has no missing entries");
}

// Any rejection (veto) -> rejected, regardless of approval count.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [
    approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z"),
    approval("collab-rejection-0002", "zoe", "reject", "2026-01-02T00:00:00.000Z", { rationale: "not ready" }),
  ];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.status, "rejected", "any veto rejects the target even with quorum otherwise met");
  assert.deepEqual(state.missing, ["rejected by zoe (not ready)"], "missing message includes the actor id and rationale in parens");
}

// A rejection with no rationale omits the parenthetical.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [approval("collab-rejection-0001", "zoe", "reject", "2026-01-01T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.deepEqual(state.missing, ["rejected by zoe"], "no rationale -> no parenthetical in the missing message");
}

// Only the FIRST approval per actor id counts (a second one from the same actor is silently ignored, not disqualified).
{
  const policy = buildReviewPolicy({ requiredApprovals: 2, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [
    approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z"),
    approval("collab-approval-0002", "amy", "approve", "2026-01-02T00:00:00.000Z"),
  ];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.recordedApprovals, 1, "the same actor approving twice only counts once");
  assert.equal(state.disqualified.length, 0, "the second approval from the same actor is silently not-counted, NOT disqualified");
  assert.equal(state.status, "pending", "still short of the required 2 distinct approvers");
}

// Unattributed actor is disqualified with reason "unattributed"; zero counted + all-unattributed disqualifications -> status "unattributed".
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [{ ...approval("collab-approval-0001", "unattributed", "approve", "2026-01-01T00:00:00.000Z"), actor: { kind: "unattributed", id: "unattributed", attestation: "unattributed", attested: false, source: "runtime-derived" } }];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.disqualified[0].reason, "unattributed", "unattributed actor disqualified with reason unattributed");
  assert.equal(state.status, "unattributed", "zero counted approvals, all blocking disqualifications unattributed -> status unattributed");
  assert.match(state.missing.join(" "), /1 unattributed approval\(s\) ignored/, "missing includes the unattributed count line");
}

// requireAttestedActor: a non-attested actor is disqualified as "unattributed" even though it has a real id.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"], requireAttestedActor: true }, undefined, NOW);
  const approvals = [approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.disqualified[0].reason, "unattributed", "requireAttestedActor policy disqualifies a non-attested actor as unattributed, not a separate reason");
}

// Unauthorized role -> disqualified "unauthorized-role"; zero counted + only that reason -> status "blocked" (not "unattributed").
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"], authorizedRoles: ["lead"] }, undefined, NOW);
  const approvals = [approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.disqualified[0].reason, "unauthorized-role", "role not in authorizedRoles disqualifies as unauthorized-role");
  assert.equal(state.status, "blocked", "zero counted + a non-unattributed blocking disqualification -> status blocked");
  assert.match(state.missing.join(" "), /1 approval\(s\) from unauthorized role\(s\) ignored/, "missing includes the unauthorized-role count line");
}

// Self-approval disqualification when policy forbids it; excluded via selfActorIds option.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"], allowSelfApproval: false }, undefined, NOW);
  const approvals = [approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy, selfActorIds: ["amy"] });
  assert.equal(state.disqualified[0].reason, "self-approval", "actor id present in selfActorIds is disqualified as self-approval");
  assert.equal(state.status, "blocked", "zero counted + self-approval disqualification -> blocked");
  assert.match(state.missing.join(" "), /1 self-approval\(s\) ignored \(policy forbids self-approval\)/, "missing includes the self-approval count line");
}

// allowSelfApproval:true means the same actor is NOT disqualified.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"], allowSelfApproval: true }, undefined, NOW);
  const approvals = [approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy, selfActorIds: ["amy"] });
  assert.equal(state.disqualified.length, 0, "allowSelfApproval:true means self-approval is counted normally, not disqualified");
  assert.equal(state.status, "approved", "self-approval allowed and meets quorum -> approved");
}

// A reject with disqualify reason "self-approval" STILL counts as a veto (rejects), unlike other disqualify reasons on a reject.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"], allowSelfApproval: false }, undefined, NOW);
  const approvals = [approval("collab-rejection-0001", "amy", "reject", "2026-01-01T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy, selfActorIds: ["amy"] });
  assert.equal(state.status, "rejected", "a self-rejection is still a blocking veto, not silently disqualified");
  assert.equal(state.rejections.length, 1, "the self-reject is recorded in rejections, not disqualified");
}

// A reject from an unauthorized/unattributed actor IS disqualified instead of counting as a veto.
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"], authorizedRoles: ["lead"] }, undefined, NOW);
  const approvals = [approval("collab-rejection-0001", "amy", "reject", "2026-01-01T00:00:00.000Z")];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.rejections.length, 0, "a reject from an unauthorized role is NOT counted as a veto");
  assert.equal(state.disqualified[0].reason, "unauthorized-role", "instead it is disqualified with reason unauthorized-role");
  assert.equal(state.status, "blocked", "no veto, no counted approvals -> blocked (not rejected)");
}

// Superseded approvals are excluded via the supersedes chain, and marked disqualified reason "superseded".
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const original = approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z");
  const superseding = approval("collab-approval-0002", "amy", "approve", "2026-01-02T00:00:00.000Z", { supersedes: original.id });
  const state = deriveReviewState("run-1", [original, superseding], TARGET, { policy });
  assert.equal(state.disqualified.some((entry) => entry.approvalId === original.id && entry.reason === "superseded"), true, "the superseded record is disqualified with reason superseded");
  assert.equal(state.recordedApprovals, 1, "only the superseding (non-superseded) approval counts");
  assert.equal(state.status, "approved", "the live superseding approval alone meets quorum");
}

// createdAt-then-id processing order: approvals are sorted before evaluation (order in the input array does not matter).
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  // Pass them out of chronological order in the array; result must be identical either way.
  const inOrder = [approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z"), approval("collab-approval-0002", "zoe", "approve", "2026-01-02T00:00:00.000Z")];
  const reversed = [inOrder[1], inOrder[0]];
  const stateA = deriveReviewState("run-1", inOrder, TARGET, { policy });
  const stateB = deriveReviewState("run-1", reversed, TARGET, { policy });
  assert.deepEqual(stateA.approvers, stateB.approvers, "input array order does not affect the derived approvers set");
  assert.equal(stateA.status, stateB.status, "input array order does not affect the derived status");
}

// relatedTargets: approvals recorded against any related target count toward the derived state (e.g. candidate + its selection).
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["selection"] }, undefined, NOW);
  const candidateTarget = { kind: "candidate", id: "candidate-1" };
  const selectionTarget = { kind: "selection", id: "selection-1" };
  const approvals = [{ ...approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z"), target: candidateTarget }];
  const state = deriveReviewState("run-1", approvals, selectionTarget, { policy, relatedTargets: [candidateTarget, selectionTarget] });
  assert.equal(state.recordedApprovals, 1, "an approval recorded against a related target (candidate) counts toward the selection's review state");
  assert.equal(state.status, "approved", "quorum met via the related-target approval");
}

// approvals against an UNRELATED target never count (default relatedTargets is just [normalized target] itself).
{
  const policy = buildReviewPolicy({ requiredApprovals: 1, appliesTo: ["commit"] }, undefined, NOW);
  const approvals = [{ ...approval("collab-approval-0001", "amy", "approve", "2026-01-01T00:00:00.000Z"), target: { kind: "commit", id: "some-other-commit" } }];
  const state = deriveReviewState("run-1", approvals, TARGET, { policy });
  assert.equal(state.recordedApprovals, 0, "an approval against a different commit id does not count toward this target");
  assert.equal(state.status, "pending", "no matching approvals -> still pending");
}

process.stdout.write("macollab-derive-review-state: ok\n");
