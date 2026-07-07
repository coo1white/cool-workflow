#!/usr/bin/env node
// macollab-collaboration-actor-target — collaboration.ts's normalizeActor,
// normalizeTarget, createCollabId, and the buildApproval/buildComment/
// buildHandoff record builders.
//
// Evidence: SPEC/multi-agent.md section F ("normalizeActor" row,
// "recordApproval/Comment/Handoff" rows), thrown-string list.

const assert = require("node:assert/strict");
const { normalizeActor, normalizeTarget, createCollabId, buildApproval, buildComment, buildHandoff, UNATTRIBUTED_ACTOR } = require("../dist/core/multi-agent/collaboration");

const NOW = "2026-07-03T00:00:00.000Z";

// normalizeActor: no actor id -> the unattributed actor (a fresh copy, not the same reference).
{
  const actor = normalizeActor(undefined);
  assert.deepEqual(actor, UNATTRIBUTED_ACTOR, "no input -> UNATTRIBUTED_ACTOR shape");
  assert.notEqual(actor, UNATTRIBUTED_ACTOR, "returned actor is a fresh copy, not the shared constant reference");
  const empty = normalizeActor({ actor: "   " });
  assert.equal(empty.kind, "unattributed", "whitespace-only actor id trims to empty and falls back to unattributed");
}

// normalizeActor: unknown kind falls back to "role" (when a role id is given) or "operator".
{
  const withRole = normalizeActor({ actor: "a-1", actorKind: "bogus-kind", roleId: "role-1" });
  assert.equal(withRole.kind, "role", "unknown kind + a role id given -> falls back to role");
  const withoutRole = normalizeActor({ actor: "a-1", actorKind: "bogus-kind" });
  assert.equal(withoutRole.kind, "operator", "unknown kind + no role id -> falls back to operator");
}

// normalizeActor: attestation resolution — explicit attestation wins, then attested flag -> host-attested, else operator-recorded.
{
  const explicit = normalizeActor({ actor: "a-1", attestation: "cw-validated" });
  assert.equal(explicit.attestation, "cw-validated", "explicit attestation field wins outright");
  const attestedFlag = normalizeActor({ actor: "a-1", attested: true });
  assert.equal(attestedFlag.attestation, "host-attested", "attested:true with no explicit attestation -> host-attested");
  assert.equal(attestedFlag.attested, true, "attested boolean field mirrors host-attested resolution");
  const plain = normalizeActor({ actor: "a-1" });
  assert.equal(plain.attestation, "operator-recorded", "no attestation/attested given -> operator-recorded");
  assert.equal(plain.attested, false, "operator-recorded attestation -> attested boolean is false");
}

// normalizeActor: roleId falls back to role (alias); source is derived from attestation via sourceForAttestation.
{
  const actor = normalizeActor({ actor: "a-1", role: "reviewer" });
  assert.equal(actor.roleId, "reviewer", "role alias field is used when roleId is absent");
  assert.equal(actor.source, "operator-recorded", "default operator-recorded attestation maps source to operator-recorded");
  const hostAttested = normalizeActor({ actor: "a-1", attested: true });
  assert.equal(hostAttested.source, "host-attested", "host-attested attestation maps source to host-attested");
  const other = normalizeActor({ actor: "a-1", attestation: "cw-validated" });
  assert.equal(other.source, "runtime-derived", "any attestation other than host-attested/operator-recorded falls back to runtime-derived source");
}

// normalizeTarget: valid kind/id passes through; missing either throws; unknown kind throws.
{
  assert.deepEqual(normalizeTarget({ kind: "commit", id: "c-1" }), { kind: "commit", id: "c-1" }, "valid target passes through unchanged");
  assert.throws(() => normalizeTarget({ kind: "commit", id: "" }), /Collaboration target requires a kind and id/, "empty id throws");
  assert.throws(() => normalizeTarget({ kind: undefined, id: "c-1" }), /Collaboration target requires a kind and id/, "missing kind throws");
  assert.throws(() => normalizeTarget({ kind: "bogus", id: "c-1" }), /Unknown collaboration target kind: bogus/, "unknown kind throws its own exact message");
}
{
  for (const kind of ["run", "task", "candidate", "selection", "commit", "node"]) {
    assert.doesNotThrow(() => normalizeTarget({ kind, id: "x" }), `${kind} is a valid collaboration target kind`);
  }
}

// createCollabId: deterministic, position based (count+1, zero-padded 4), safeFileName-sanitized kind.
{
  assert.equal(createCollabId("approval", 0), "collab-approval-0001", "count 0 -> seq 0001 (count+1)");
  assert.equal(createCollabId("approval", 9), "collab-approval-0010", "count 9 -> seq 0010");
  assert.equal(createCollabId("review policy", 0), "collab-review_policy-0001", "kind with a space is sanitized by safeFileName to an underscore");
}

// buildApproval: decision defaults to "approve" unless input.decision is exactly "reject"; id prefix differs by decision.
{
  const approval = buildApproval({ target: { kind: "commit", id: "c-1" }, decision: "approve", actor: "reviewer-1" }, 0, "run-1", NOW, "audit-0000");
  assert.equal(approval.decision, "approve", "decision approve passes through");
  assert.equal(approval.id, "collab-approval-0001", "approval id uses the 'approval' prefix");
  const rejection = buildApproval({ target: { kind: "commit", id: "c-1" }, decision: "reject", actor: "reviewer-1" }, 1, "run-1", NOW, "audit-0001");
  assert.equal(rejection.decision, "reject", "explicit reject decision preserved");
  assert.equal(rejection.id, "collab-rejection-0002", "rejection id uses the 'rejection' prefix but the SAME shared counter (count=1 -> seq 0002)");
  const bogusDecision = buildApproval({ target: { kind: "commit", id: "c-1" }, decision: "something-else", actor: "reviewer-1" }, 2, "run-1", NOW, "audit-0002");
  assert.equal(bogusDecision.decision, "approve", "any decision value other than exactly 'reject' normalizes to approve");
}

// buildApproval: compact() drops rationale/supersedes/metadata when absent; auditEventIds is a single-element array.
{
  const approval = buildApproval({ target: { kind: "commit", id: "c-1" }, decision: "approve", actor: "reviewer-1" }, 0, "run-1", NOW, "audit-0000");
  assert.ok(!("rationale" in approval), "no rationale given -> key absent entirely (compact drops undefined)");
  assert.deepEqual(approval.auditEventIds, ["audit-0000"], "auditEventIds wraps the single passed-in audit event id");
  assert.ok(!("roleId" in approval), "no roleId on the actor -> compact() drops the undefined roleId key entirely");
}

// buildComment: body required (throws on empty/whitespace); threadId default is "<kind>:<id>".
{
  assert.throws(() => buildComment({ target: { kind: "task", id: "t-1" }, body: "   ", actor: "a-1" }, 0, "run-1", NOW, "audit-0000"), /Comment body is required/, "whitespace-only body throws");
  const comment = buildComment({ target: { kind: "task", id: "t-1" }, body: "looks good", actor: "a-1" }, 0, "run-1", NOW, "audit-0000");
  assert.equal(comment.threadId, "task:t-1", "default threadId is <kind>:<id>");
  assert.equal(comment.id, "collab-comment-0001", "comment id uses the comment prefix + count+1");
  const explicitThread = buildComment({ target: { kind: "task", id: "t-1" }, body: "reply", threadId: "custom-thread", actor: "a-1" }, 1, "run-1", NOW, "audit-0001");
  assert.equal(explicitThread.threadId, "custom-thread", "explicit threadId overrides the default");
}

// buildHandoff: requires a to-actor; default reason is "handoff"; recorder is the fromActor fallback when fromActor is absent.
{
  assert.throws(() => buildHandoff({ target: { kind: "run", id: "r-1" }, reason: "x", actor: "a-1" }, 0, "run-1", NOW, "audit-0000"), /Handoff requires a to-actor \(--to\)/, "no toActor throws");
  const handoff = buildHandoff({ target: { kind: "run", id: "r-1" }, actor: "recorder-1", toActor: "receiver-1" }, 0, "run-1", NOW, "audit-0000");
  assert.equal(handoff.reason, "handoff", "no reason given -> default 'handoff'");
  assert.equal(handoff.fromActor.id, "recorder-1", "no explicit fromActor -> fromActor falls back to the recorder");
  assert.equal(handoff.toActor.id, "receiver-1", "toActor resolves from the toActor field");
  assert.equal(handoff.id, "collab-handoff-0001", "handoff id uses the handoff prefix");
}

// buildHandoff: explicit fromActor is independently normalized (its own kind/role), distinct from the recorder.
{
  const handoff = buildHandoff({ target: { kind: "run", id: "r-1" }, actor: "recorder-1", fromActor: "sender-1", fromActorKind: "worker", toActor: "receiver-1" }, 0, "run-1", NOW, "audit-0000");
  assert.equal(handoff.fromActor.id, "sender-1", "explicit fromActor id used instead of the recorder");
  assert.equal(handoff.fromActor.kind, "worker", "explicit fromActorKind is honored");
  assert.equal(handoff.actor.id, "recorder-1", "the recording actor field stays distinct from fromActor");
}

process.stdout.write("macollab-collaboration-actor-target: ok\n");
