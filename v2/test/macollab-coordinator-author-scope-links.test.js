#!/usr/bin/env node
// macollab-coordinator-author-scope-links — coordinator.ts's identity
// normalization: normalizeAuthor, normalizeScope, compactLinks,
// roleLinkFromAuthor, shouldEnforcePolicy.
//
// Evidence: SPEC/multi-agent.md section C "Author defaults", invariant 1
// (fail closed on identity), invariant 5 (trust check before write).

const assert = require("node:assert/strict");
const { normalizeAuthor, normalizeScope, compactLinks, roleLinkFromAuthor, shouldEnforcePolicy } = require("../dist/core/multi-agent/coordinator");

// normalizeAuthor: runtime/coordinator kind with no id defaults to "cw".
{
  const a = normalizeAuthor(undefined, "runtime");
  assert.deepEqual(a, { kind: "runtime", id: "cw", displayName: undefined }, "no input + runtime fallback kind -> id cw");
  const b = normalizeAuthor({ kind: "coordinator" }, "operator");
  assert.equal(b.id, "cw", "explicit coordinator kind with no id -> id cw");
}

// normalizeAuthor: operator kind with no id defaults to "operator".
{
  const a = normalizeAuthor({ kind: "operator" }, "runtime");
  assert.equal(a.id, "operator", "operator kind with no id -> id operator");
}

// normalizeAuthor: any OTHER kind with no id throws (fail closed on identity).
{
  assert.throws(() => normalizeAuthor({ kind: "worker" }, "runtime"), /Blackboard author requires an explicit id/, "worker kind with no id throws");
  assert.throws(() => normalizeAuthor({ kind: "role" }, "runtime"), /Blackboard author requires an explicit id/, "role kind with no id throws");
}

// normalizeAuthor: explicit id + kind passes through; fallbackKind used only when input.kind absent.
{
  const a = normalizeAuthor({ kind: "worker", id: "w-1", displayName: "Worker One" }, "operator");
  assert.deepEqual(a, { kind: "worker", id: "w-1", displayName: "Worker One" }, "explicit worker author passes through with displayName");
  const b = normalizeAuthor({ id: "custom-id" }, "operator");
  assert.equal(b.kind, "operator", "no kind given uses the fallbackKind");
  assert.equal(b.id, "custom-id", "explicit id is preserved even when kind falls back");
}

// normalizeScope: uses input kind/id, else the fallback; missing either throws.
{
  const scope = normalizeScope({ kind: "task", id: "t-1" }, { kind: "run", id: "r-1" });
  assert.deepEqual(scope, { kind: "task", id: "t-1" }, "explicit scope wins over fallback");
  const fallback = normalizeScope(undefined, { kind: "run", id: "r-1" });
  assert.deepEqual(fallback, { kind: "run", id: "r-1" }, "no input scope falls back entirely");
  const partial = normalizeScope({ kind: "task" }, { kind: "run", id: "r-1" });
  assert.deepEqual(partial, { kind: "task", id: "r-1" }, "partial input scope: given kind + fallback id");
}
{
  assert.throws(() => normalizeScope({}, { kind: "", id: "" }), /Blackboard scope requires kind and id/, "empty kind and id (input and fallback) throws");
}

// compactLinks: runId always present; auditEventIds/evidenceRefs are unique()'d (sorted); undefined/empty fields dropped.
{
  const links = compactLinks("run-1", { auditEventIds: ["b", "a", "a"], evidenceRefs: [], agentGroupId: "group-1" });
  assert.equal(links.workflowRunId, "run-1", "workflowRunId always set from runId param");
  assert.deepEqual(links.auditEventIds, ["a", "b"], "auditEventIds deduped and sorted via unique()");
  assert.equal(links.evidenceRefs, undefined, "empty evidenceRefs array is dropped by compact()");
  assert.equal(links.agentGroupId, "group-1", "explicit fields pass through");
  assert.equal(links.agentRoleId, undefined, "unset fields are absent, not present as undefined key... verified via 'in' below");
  assert.ok(!("agentRoleId" in links), "unset optional link fields are not present as keys at all");
}

// roleLinkFromAuthor: maps author.kind to the matching link field; no id -> {}.
{
  assert.deepEqual(roleLinkFromAuthor(undefined), {}, "no author -> empty link");
  assert.deepEqual(roleLinkFromAuthor({ kind: "role", id: "role-1" }), { agentRoleId: "role-1" }, "role kind maps to agentRoleId");
  assert.deepEqual(roleLinkFromAuthor({ kind: "group", id: "group-1" }), { agentGroupId: "group-1" }, "group kind maps to agentGroupId");
  assert.deepEqual(roleLinkFromAuthor({ kind: "membership", id: "m-1" }), { agentMembershipId: "m-1" }, "membership kind maps to agentMembershipId");
  assert.deepEqual(roleLinkFromAuthor({ kind: "worker", id: "w-1" }), { workerId: "w-1" }, "worker kind maps to workerId");
  assert.deepEqual(roleLinkFromAuthor({ kind: "operator", id: "op" }), {}, "operator kind maps to no link field");
}

// shouldEnforcePolicy: true for agent-scoped author kinds OR when links carry an agent role/group/membership id.
{
  assert.equal(shouldEnforcePolicy({ kind: "role", id: "r" }, {}), true, "role author kind alone enforces policy");
  assert.equal(shouldEnforcePolicy({ kind: "group", id: "g" }, {}), true, "group author kind alone enforces policy");
  assert.equal(shouldEnforcePolicy({ kind: "membership", id: "m" }, {}), true, "membership author kind alone enforces policy");
  assert.equal(shouldEnforcePolicy({ kind: "worker", id: "w" }, {}), true, "worker author kind alone enforces policy");
  assert.equal(shouldEnforcePolicy({ kind: "operator", id: "op" }, {}), false, "operator author with no agent links does not enforce policy");
  assert.equal(shouldEnforcePolicy({ kind: "operator", id: "op" }, { agentRoleId: "role-1" }), true, "operator author but agent-linked scope still enforces policy");
}

process.stdout.write("macollab-coordinator-author-scope-links: ok\n");
