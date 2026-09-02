#!/usr/bin/env node
// stateexplosion-collapse-kinds-allowlist — pins the COLLAPSIBLE KINDS
// allowlist: only blackboard-message, blackboard-context, agent-
// membership, worker, score, blackboard-snapshot, agent-role may ever be
// folded into a synthetic summary node. Every other kind (decisions,
// artifacts, fanins, candidates, selections, commits, feedback, task,
// dispatch, ...) must NEVER collapse, even with a large same-kind bucket.
//
// Evidence: SPEC/state-core.md "State-explosion collapse rules": "Collapsible
// kinds ONLY: blackboard-message, blackboard-context, agent-membership,
// worker, score, blackboard-snapshot, agent-role ... decisions, artifacts,
// fanins, candidates, selections, commits, feedback are never collapsed";
// project/docs/rebuild/PLAN.md byte-compat item 9.

const assert = require("node:assert/strict");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");

function bigBucket(kind, n = 10) {
  return Array.from({ length: n }, (_, i) => ({ id: `run-1:${kind}:${i}`, kind, status: "completed", label: `${kind}${i}` }));
}

const COLLAPSIBLE_KINDS = ["blackboard-message", "blackboard-context", "agent-membership", "worker", "score", "blackboard-snapshot", "agent-role"];
const NEVER_COLLAPSE_KINDS = ["decision", "artifact", "fanin", "candidate", "selection", "commit", "feedback", "task", "dispatch"];

// Every allowlisted kind, given a bucket >= 6, DOES collapse.
for (const kind of COLLAPSIBLE_KINDS) {
  const full = { nodes: bigBucket(kind, 10), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.ok(summary, `kind "${kind}" with a 10-node bucket must collapse into a synthetic summary`);
  assert.equal(summary.synthetic.collapsedNodeCount, 10, `kind "${kind}": all 10 nodes collapse`);
}

// Every NON-allowlisted kind, even with a large same-kind bucket, NEVER collapses.
for (const kind of NEVER_COLLAPSE_KINDS) {
  const full = { nodes: bigBucket(kind, 10), edges: [] };
  const record = buildCompactGraphFromView("run-1", full, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const summary = record.nodes.find((n) => n.kind === "summary");
  assert.equal(summary, undefined, `kind "${kind}" must NEVER collapse, even with 10 same-kind nodes`);
  assert.equal(record.nodes.length, 10, `kind "${kind}": all 10 nodes stay expanded as real nodes`);
}

process.stdout.write("stateexplosion-collapse-kinds-allowlist: ok\n");
