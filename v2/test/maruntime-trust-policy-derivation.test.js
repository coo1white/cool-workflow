#!/usr/bin/env node
// maruntime-trust-policy-derivation (multiagent-core bucket) — pins
// policyForRole's chair/judge SUBSTRING detection (not a flag), the
// exact requiredEvidenceFor table, policyForGroup's wide-open shape, and
// policyForMembership's role-copy-then-resubject behavior.
//
// Evidence: SPEC/multi-agent.md section D (policyForRole/Group/Membership
// rows), rebuild risk 4 (chair/judge detection by substring).

const assert = require("node:assert/strict");
const { policyForRole, policyForGroup, policyForMembership } = require("../dist/core/multi-agent/trust-policy");

function makeRole(overrides) {
  return {
    schemaVersion: 1,
    id: "role-0001",
    runId: "run-1",
    multiAgentRunId: "mar-0001",
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    status: "planned",
    title: "Generic Role",
    responsibilities: [],
    requiredEvidence: [],
    sandboxProfileHints: [],
    expectedArtifacts: [],
    faninObligations: [],
    topicIds: [],
    lifecycle: [],
    childRoleIds: [],
    ...overrides,
  };
}

// Plain role (no chair/judge substring): minimal write ops, candidate ops
// limited to ["score"], no judge ops.
{
  const policy = policyForRole(makeRole({ title: "Mapper" }));
  assert.deepEqual(policy.allowedWriteOperations, ["message", "context", "artifact"]);
  assert.deepEqual(policy.allowedCandidateOperations, ["score"]);
  assert.deepEqual(policy.allowedJudgeOperations, []);
  assert.equal(policy.subjectKind, "role");
  assert.equal(policy.policyRef, "multiAgent.roles.role-0001.policy");
}

// Chair detection is a case-insensitive SUBSTRING match on
// metadata.topologyRoleId (preferred) or title, matching "chair",
// "reducer", or "synthesizer" — not an exact-equals check.
for (const title of ["Panel Chair", "PANEL CHAIR", "Something Chairish", "Reducer", "Synthesis Synthesizer"]) {
  const policy = policyForRole(makeRole({ title }));
  assert.deepEqual(policy.allowedWriteOperations, ["message", "context", "artifact", "snapshot", "coordinator-decision"], `"${title}" must be detected as a chair (write ops)`);
  assert.deepEqual(policy.allowedCandidateOperations, ["score", "select"], `"${title}" chair gets select`);
  assert.deepEqual(policy.allowedJudgeOperations, ["rationale", "panel-decision"], `"${title}" chair judge ops`);
}

// Judge detection is a separate substring match on "judge".
{
  const policy = policyForRole(makeRole({ title: "Judge One" }));
  assert.deepEqual(policy.allowedJudgeOperations, ["verdict", "rationale"]);
  assert.deepEqual(policy.allowedCandidateOperations, ["score"], "judge (non-chair) does not get select");
}

// A role can be BOTH judge and chair by substring (e.g. "Judge Chair") —
// judge ops union both branches.
{
  const policy = policyForRole(makeRole({ title: "Judge Chair" }));
  assert.deepEqual(policy.allowedJudgeOperations, ["verdict", "rationale", "panel-decision"], "judge+chair unions both judge-op branches, deduped");
}

// metadata.topologyRoleId takes priority over title for detection.
{
  const policy = policyForRole(makeRole({ title: "Generic Title", metadata: { topologyRoleId: "reducer" } }));
  assert.deepEqual(policy.allowedCandidateOperations, ["score", "select"], "metadata.topologyRoleId=reducer is detected as chair even though the title is generic");
}
{
  const policy = policyForRole(makeRole({ title: "Reducer", metadata: { topologyRoleId: "mapper" } }));
  assert.deepEqual(policy.allowedCandidateOperations, ["score"], "metadata.topologyRoleId=mapper overrides a chair-sounding title");
}

// requiredEvidenceFor table is fixed and exact.
{
  const policy = policyForRole(makeRole({}));
  assert.deepEqual(policy.requiredEvidenceFor, {
    "judge.rationale": ["judge rationale evidence"],
    "judge.verdict": ["judge verdict evidence"],
    "judge.panel-decision": ["judge messages", "score evidence", "coordinator decision"],
    "candidate.select": ["score evidence", "judge rationale"],
  });
}

// allowedBlackboardTopicIds: role's own topics, else wildcard. The
// fallback is `role.topicIds || ["*"]` — JS truthiness means this only
// fires for a NULLISH topicIds, not an empty array (an empty array is
// truthy, so an explicitly-empty topic list stays empty, scoping the role
// to nothing rather than everything).
{
  const withTopics = policyForRole(makeRole({ topicIds: ["t1", "t2"] }));
  assert.deepEqual(withTopics.allowedBlackboardTopicIds, ["t1", "t2"]);
  const withEmptyTopics = policyForRole(makeRole({ topicIds: [] }));
  assert.deepEqual(withEmptyTopics.allowedBlackboardTopicIds, [], "an explicitly EMPTY topicIds array stays empty, it does NOT fall back to wildcard (only nullish does)");
  const withoutTopicsField = policyForRole(makeRole({ topicIds: undefined }));
  assert.deepEqual(withoutTopicsField.allowedBlackboardTopicIds, ["*"], "an undefined topicIds falls back to wildcard scope");
}

// policyForGroup: wide-open, all ops allowed, topics from the group or
// wildcard.
{
  const group = { id: "group-0001", phase: "Map", topicIds: ["g-topic"] };
  const policy = policyForGroup(group);
  assert.equal(policy.policyRef, "multiAgent.groups.group-0001.policy");
  assert.equal(policy.subjectKind, "group");
  assert.deepEqual(policy.allowedWriteOperations, ["message", "context", "artifact", "snapshot", "coordinator-decision"]);
  assert.deepEqual(policy.allowedCandidateOperations, ["register", "score", "select"]);
  assert.deepEqual(policy.allowedJudgeOperations, ["verdict", "rationale", "panel-decision"]);
  assert.deepEqual(policy.allowedBlackboardTopicIds, ["g-topic"]);
  assert.deepEqual(policy.metadata, { phase: "Map" });
}
{
  const policy = policyForGroup({ id: "group-0001", topicIds: undefined });
  assert.deepEqual(policy.allowedBlackboardTopicIds, ["*"], "an undefined group topicIds falls back to wildcard (same truthiness rule as policyForRole)");
}

// policyForMembership: copies the role policy verbatim except re-subjects
// id/policyRef/subjectKind/subjectId to the membership.
{
  const role = makeRole({ title: "Reducer" });
  const rolePolicy = policyForRole(role);
  role.policy = rolePolicy;
  const membership = { id: "membership-0001" };
  const policy = policyForMembership(membership, role);
  assert.equal(policy.id, "membership-0001-policy");
  assert.equal(policy.policyRef, "multiAgent.memberships.membership-0001.policy");
  assert.equal(policy.subjectKind, "membership");
  assert.equal(policy.subjectId, "membership-0001");
  assert.deepEqual(policy.allowedCandidateOperations, rolePolicy.allowedCandidateOperations, "candidate ops are copied verbatim from the role policy");
}

// policyForMembership with no role: minimal message/context/artifact-only
// policy.
{
  const membership = { id: "membership-0002", topicIds: ["m-topic"] };
  const policy = policyForMembership(membership, undefined);
  assert.deepEqual(policy.allowedWriteOperations, ["message", "context", "artifact"]);
  assert.deepEqual(policy.allowedCandidateOperations, []);
  assert.deepEqual(policy.allowedJudgeOperations, []);
  assert.deepEqual(policy.allowedBlackboardTopicIds, ["m-topic"]);
  assert.equal(policy.subjectKind, "membership");
}

// policyForMembership with a role but no pre-computed role.policy: derives
// it fresh via policyForRole.
{
  const role = makeRole({ title: "Judge" });
  const membership = { id: "membership-0003" };
  const policy = policyForMembership(membership, role);
  assert.deepEqual(policy.allowedJudgeOperations, ["verdict", "rationale"], "policy is freshly derived from the role when role.policy is unset");
}

process.stdout.write("maruntime-trust-policy-derivation: ok\n");
