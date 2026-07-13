#!/usr/bin/env node
// maruntime-trust-authorize (multiagent-core bucket) — pins
// evaluateMultiAgentAction's pure decision half (denied ops, topic scope,
// op-class membership, required evidence), resolvePolicy's priority chain
// (membership > role > group), and sourceForActor's actor-kind mapping.
//
// Evidence: SPEC/multi-agent.md section D (authorizeMultiAgentAction,
// sourceForActor rows), "Trust denial reasons" exact-outputs block,
// Invariant 5 (trust check before write).

const assert = require("node:assert/strict");
const { evaluateMultiAgentAction, resolvePolicy, sourceForActor, policyForRole } = require("../dist/core/multi-agent/trust-policy");

function basePolicy(overrides) {
  return {
    schemaVersion: 1,
    id: "p-0001",
    policyRef: "multiAgent.roles.role-0001.policy",
    subjectKind: "role",
    subjectId: "role-0001",
    allowedBlackboardTopicIds: ["*"],
    allowedWriteOperations: ["message", "context", "artifact"],
    allowedCandidateOperations: ["score"],
    allowedJudgeOperations: [],
    sandboxProfileHints: [],
    requiredEvidenceRefs: [],
    deniedOperations: [],
    ...overrides,
  };
}

// No policy at all -> denied with "missing role authority or policy".
{
  const result = evaluateMultiAgentAction(undefined, "message", "topic-1", []);
  assert.equal(result.allowed, false);
  assert.equal(result.decision, "denied");
  assert.equal(result.reason, "missing role authority or policy");
}

// Allowed operation within scope -> allowed, with the exact "allowed by
// explicit multi-agent policy" reason string.
{
  const result = evaluateMultiAgentAction(basePolicy(), "message", "topic-1", []);
  assert.equal(result.allowed, true);
  assert.equal(result.decision, "allowed");
  assert.equal(result.reason, "allowed by explicit multi-agent policy");
  assert.equal(result.policyRef, "multiAgent.roles.role-0001.policy");
}

// deniedOperations entries are checked FIRST and short-circuit everything
// else — the reason is verbatim from the policy.
{
  const policy = basePolicy({ deniedOperations: [{ operation: "message", reason: "custom denial text" }] });
  const result = evaluateMultiAgentAction(policy, "message", "topic-1", []);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "custom denial text");
}

// Topic scope: a non-wildcard allowedBlackboardTopicIds list rejects an
// out-of-scope topic id.
{
  const policy = basePolicy({ allowedBlackboardTopicIds: ["topic-a"] });
  const result = evaluateMultiAgentAction(policy, "message", "topic-b", []);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "topic topic-b is outside policy multiAgent.roles.role-0001.policy");
}
{
  const policy = basePolicy({ allowedBlackboardTopicIds: ["topic-a"] });
  const result = evaluateMultiAgentAction(policy, "message", "topic-a", []);
  assert.equal(result.allowed, true, "an in-scope topic passes the scope check");
}
{
  const policy = basePolicy({ allowedBlackboardTopicIds: ["*"] });
  const result = evaluateMultiAgentAction(policy, "message", "any-topic-at-all", []);
  assert.equal(result.allowed, true, "wildcard scope allows any topic");
}
{
  const policy = basePolicy();
  const result = evaluateMultiAgentAction(policy, "message", undefined, []);
  assert.equal(result.allowed, true, "no topicId given skips the topic-scope check entirely");
}

// Candidate operation class: "candidate.<op>" must be in
// allowedCandidateOperations.
{
  const policy = basePolicy({ allowedCandidateOperations: ["score"] });
  const denied = evaluateMultiAgentAction(policy, "candidate.select", "topic-1", []);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "candidate operation select is outside policy multiAgent.roles.role-0001.policy");
  const allowed = evaluateMultiAgentAction(policy, "candidate.score", "topic-1", []);
  assert.equal(allowed.allowed, true);
}

// Judge operation class: "judge.<op>" must be in allowedJudgeOperations.
{
  const policy = basePolicy({ allowedJudgeOperations: ["verdict"] });
  const denied = evaluateMultiAgentAction(policy, "judge.rationale", "topic-1", []);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "judge operation rationale is outside policy multiAgent.roles.role-0001.policy");
}

// Plain write operation must be in allowedWriteOperations.
{
  const policy = basePolicy({ allowedWriteOperations: ["message"] });
  const denied = evaluateMultiAgentAction(policy, "snapshot", "topic-1", []);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "blackboard write operation snapshot is outside policy multiAgent.roles.role-0001.policy");
}

// Required evidence: requiredEvidenceFor[operation] non-empty AND no
// evidenceRefs given -> denied with the joined ref list; ANY evidenceRefs
// (even irrelevant ones) satisfies the requirement.
{
  const policy = basePolicy({
    allowedJudgeOperations: ["rationale"],
    requiredEvidenceFor: { "judge.rationale": ["judge rationale evidence", "extra evidence"] },
  });
  const denied = evaluateMultiAgentAction(policy, "judge.rationale", "topic-1", []);
  assert.equal(denied.allowed, false);
  // The message states the actual mechanism: at least one ref of any kind
  // satisfies the check (the expected kinds are prose, not matchable ids).
  assert.equal(denied.reason, "operation judge.rationale requires evidence refs (at least one; expected kinds: judge rationale evidence, extra evidence)");
  assert.deepEqual(denied.missingEvidenceRefs, ["judge rationale evidence", "extra evidence"]);

  const allowed = evaluateMultiAgentAction(policy, "judge.rationale", "topic-1", ["anything"]);
  assert.equal(allowed.allowed, true, "any non-empty evidenceRefs satisfies the requirement, regardless of content");
  assert.deepEqual(allowed.missingEvidenceRefs, []);
}

// resolvePolicy: membership policy wins over role, which wins over group.
{
  const membership = { id: "membership-1", roleId: "role-1", policy: basePolicy({ id: "membership-policy" }) };
  const role = { id: "role-1", policy: basePolicy({ id: "role-policy" }) };
  const group = { id: "group-1", policy: basePolicy({ id: "group-policy" }) };
  const resolved = resolvePolicy(
    { membershipId: "membership-1", roleId: "role-1", groupId: "group-1" },
    { membership: () => membership, role: () => role, group: () => group }
  );
  assert.equal(resolved.id, "membership-policy", "membership policy wins when present");
}

{
  const role = { id: "role-1", policy: basePolicy({ id: "role-policy" }) };
  const group = { id: "group-1", policy: basePolicy({ id: "group-policy" }) };
  const resolved = resolvePolicy(
    { roleId: "role-1", groupId: "group-1" },
    { membership: () => undefined, role: () => role, group: () => group }
  );
  assert.equal(resolved.id, "role-policy", "role policy wins over group when no membership is given");
}

{
  const group = { id: "group-1", policy: basePolicy({ id: "group-policy" }) };
  const resolved = resolvePolicy({ groupId: "group-1" }, { group: () => group });
  assert.equal(resolved.id, "group-policy", "group policy is the last resort");
}

{
  const resolved = resolvePolicy({}, {});
  assert.equal(resolved, undefined, "no ids and no lookups resolves to undefined");
}

// resolvePolicy derives a role's policy on the fly via policyForRole when
// the role has no precomputed .policy.
{
  const role = { id: "role-1", title: "Judge", topicIds: [] };
  const resolved = resolvePolicy({ roleId: "role-1" }, { role: () => role });
  assert.deepEqual(resolved.allowedJudgeOperations, ["verdict", "rationale"], "resolvePolicy falls back to policyForRole when role.policy is unset");
}

// sourceForActor: exact mapping table.
{
  assert.equal(sourceForActor(undefined), "operator-recorded", "no actor -> operator-recorded");
  assert.equal(sourceForActor({ kind: "worker", id: "w1" }), "host-attested");
  assert.equal(sourceForActor({ kind: "operator", id: "op" }), "operator-recorded");
  assert.equal(sourceForActor({ kind: "runtime", id: "r" }), "runtime-derived");
  assert.equal(sourceForActor({ kind: "coordinator", id: "c" }), "runtime-derived");
  assert.equal(sourceForActor({ kind: "verifier", id: "v" }), "runtime-derived");
  assert.equal(sourceForActor({ kind: "role", id: "r1" }), "cw-validated", "else falls to cw-validated");
  assert.equal(sourceForActor({ kind: "membership", id: "m1" }), "cw-validated");
}

process.stdout.write("maruntime-trust-authorize: ok\n");
