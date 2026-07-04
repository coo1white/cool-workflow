#!/usr/bin/env node
// macollab-coordinator-classifiers — coordinator.ts's status/source
// classifiers: coordinatorStatusToNodeStatus, decisionStatus,
// auditDecision, sourceForAuthor.
//
// BYTE-COMPAT / REBUILD RISK 7 [load-bearing]: coordinatorStatusToNodeStatus
// is a SEPARATE table from multi-agent/runtime.ts's statusToNodeStatus —
// different default ("completed" here vs "pending" there). Collapsing them
// changes graph output and eval dependency_parity.
//
// Evidence: SPEC/multi-agent.md "Status -> state-node mapping" section,
// rebuild risk 7.

const assert = require("node:assert/strict");
const { coordinatorStatusToNodeStatus, decisionStatus, auditDecision, sourceForAuthor } = require("../dist/core/multi-agent/coordinator");

// coordinatorStatusToNodeStatus: exact table from SPEC "Coordinator side differs".
{
  assert.equal(coordinatorStatusToNodeStatus("active"), "running", "active -> running");
  assert.equal(coordinatorStatusToNodeStatus("open"), "running", "open -> running");
  assert.equal(coordinatorStatusToNodeStatus("resolved"), "completed", "resolved -> completed");
  assert.equal(coordinatorStatusToNodeStatus("superseded"), "completed", "superseded -> completed");
  assert.equal(coordinatorStatusToNodeStatus("conflicting"), "blocked", "conflicting -> blocked");
  assert.equal(coordinatorStatusToNodeStatus("rejected"), "rejected", "rejected -> rejected");
}

// REBUILD RISK 7: default (unknown status) is "completed" here — NOT "pending".
// This is the opposite default from multi-agent/runtime.ts's statusToNodeStatus.
{
  assert.equal(coordinatorStatusToNodeStatus("some-unknown-status"), "completed", "unknown status defaults to completed, not pending (coordinator-side default)");
  assert.equal(coordinatorStatusToNodeStatus(""), "completed", "empty string status also falls to the completed default");
}

// decisionStatus: outcome -> BlackboardRecordStatus.
{
  assert.equal(decisionStatus("conflicting"), "conflicting", "conflicting outcome -> conflicting status");
  assert.equal(decisionStatus("blocked"), "conflicting", "blocked outcome ALSO maps to conflicting status (not a separate blocked status)");
  assert.equal(decisionStatus("rejected"), "rejected", "rejected outcome -> rejected status");
  assert.equal(decisionStatus("superseded"), "superseded", "superseded outcome -> superseded status");
  assert.equal(decisionStatus("accepted"), "active", "accepted (or any other outcome) falls through to active");
}

// auditDecision: outcome -> accepted/rejected/failed.
{
  assert.equal(auditDecision("rejected"), "rejected", "rejected outcome -> rejected audit decision");
  assert.equal(auditDecision("blocked"), "failed", "blocked outcome -> failed audit decision");
  assert.equal(auditDecision("conflicting"), "failed", "conflicting outcome -> failed audit decision");
  assert.equal(auditDecision("accepted"), "accepted", "accepted (or any other outcome) -> accepted audit decision");
  assert.equal(auditDecision("superseded"), "accepted", "superseded outcome is not rejected/blocked/conflicting, so it audits as accepted");
}

// sourceForAuthor: author kind -> provenance source string.
{
  assert.equal(sourceForAuthor({ kind: "runtime", id: "cw" }), "runtime-derived", "runtime author -> runtime-derived");
  assert.equal(sourceForAuthor({ kind: "coordinator", id: "cw" }), "runtime-derived", "coordinator author -> runtime-derived");
  assert.equal(sourceForAuthor({ kind: "worker", id: "w-1" }), "cw-validated", "worker author -> cw-validated");
  assert.equal(sourceForAuthor({ kind: "verifier", id: "v-1" }), "cw-validated", "verifier author -> cw-validated");
  assert.equal(sourceForAuthor({ kind: "operator", id: "op" }), "operator-recorded", "operator author -> operator-recorded");
  assert.equal(sourceForAuthor({ kind: "role", id: "role-1" }), "operator-recorded", "any other kind (role/group/membership) falls back to operator-recorded");
}

process.stdout.write("macollab-coordinator-classifiers: ok\n");
