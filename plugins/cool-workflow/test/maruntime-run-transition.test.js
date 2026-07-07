#!/usr/bin/env node
// maruntime-run-transition (multiagent-core bucket) — pins
// transitionMultiAgentRun + assertLifecycleTransition's lifecycle table
// + the completion gate (assertMultiAgentRunCompletionReady) + completion
// cascade onto owned roles/groups/fanouts/fanins.
//
// Evidence: SPEC/multi-agent.md Invariants 2 (lifecycle table), 3
// (completion gate), section A transitionMultiAgentRun row.

const assert = require("node:assert/strict");
const { createMultiAgentRun, transitionMultiAgentRun, createAgentRole, createAgentGroup } = require("../dist/core/multi-agent/runtime");
const { policyForRole, policyForGroup } = require("../dist/core/multi-agent/trust-policy");

function makeRun(id) {
  return {
    schemaVersion: 1,
    id,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    cwd: "/tmp/x",
    workflow: { id: "wf", title: "t", summary: "s", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: { runDir: "/tmp/x/.cw/runs/" + id, state: "s", report: "r", tasksDir: "t", resultsDir: "r", dispatchesDir: "d", artifactsDir: "a", commitsDir: "c", stateNodesDir: "n", feedbackDir: "f" },
  };
}

const NOW = "2020-01-01T00:00:00.000Z";

// Legal transition table: planned -> forming|running|failed|cancelled.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const updated = transitionMultiAgentRun(run, mar.id, "forming", {}, NOW);
  assert.equal(updated.status, "forming");
  assert.equal(updated.lifecycle.length, 2, "transition appends a lifecycle event");
  assert.deepEqual(
    { from: updated.lifecycle[1].from, to: updated.lifecycle[1].to, actor: updated.lifecycle[1].actor },
    { from: "planned", to: "forming", actor: "cw" },
    "lifecycle event records the from/to/actor"
  );
}

// Illegal transition throws the exact kernel error string and does NOT
// mutate status.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  assert.throws(
    () => transitionMultiAgentRun(run, mar.id, "verifying", {}, NOW),
    /Invalid MultiAgentRun lifecycle transition: planned -> verifying/,
    "planned -> verifying is not in the table"
  );
  assert.equal(mar.status, "planned", "status is unchanged after a rejected transition");
}

// Same-status transition is a legal no-op check but STILL appends a
// lifecycle event (Invariant 2).
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const updated = transitionMultiAgentRun(run, mar.id, "planned", { reason: "re-affirm" }, NOW);
  assert.equal(updated.status, "planned");
  assert.equal(updated.lifecycle.length, 2, "a same-status transition still appends a lifecycle event");
}

// Terminal states have no onward transitions.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  transitionMultiAgentRun(run, mar.id, "failed", {}, NOW);
  assert.throws(
    () => transitionMultiAgentRun(run, mar.id, "forming", {}, NOW),
    /Invalid MultiAgentRun lifecycle transition: failed -> forming/,
    "failed is terminal — no onward transition"
  );
}

// Completion gate: a group with memberships/fanouts but no fanin record
// blocks completion with the exact reason string.
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const group = createAgentGroup(run, { multiAgentRunId: mar.id, title: "G" }, NOW, policyForGroup);
  group.membershipIds = ["membership-0001"]; // simulate a membership without a fanin record
  transitionMultiAgentRun(run, mar.id, "running", {}, NOW);
  assert.throws(
    () => transitionMultiAgentRun(run, mar.id, "completed", {}, NOW),
    new RegExp(`Cannot complete MultiAgentRun ${mar.id}: group ${group.id} has no fanin record`),
    "completion is blocked when a group with memberships has no fanin record"
  );
}

// Completion succeeds and cascades "completed" onto owned roles/groups,
// skipping ones already terminal (cancelled roles stay cancelled).
{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id, title: "R" }, NOW, policyForRole);
  role.status = "cancelled"; // simulate an already-terminal role
  transitionMultiAgentRun(run, mar.id, "running", {}, NOW);
  const completed = transitionMultiAgentRun(run, mar.id, "completed", { reason: "done" }, NOW);
  assert.equal(completed.status, "completed");
  assert.equal(role.status, "cancelled", "an already-terminal role is NOT overwritten by the completion cascade");
}

{
  const run = makeRun("run-1");
  const mar = createMultiAgentRun(run, {}, NOW);
  const role = createAgentRole(run, { multiAgentRunId: mar.id, title: "R" }, NOW, policyForRole);
  transitionMultiAgentRun(run, mar.id, "running", {}, NOW);
  transitionMultiAgentRun(run, mar.id, "completed", {}, NOW);
  assert.equal(role.status, "completed", "a non-terminal role cascades to completed");
  assert.equal(role.lifecycle[role.lifecycle.length - 1].reason, "multi-agent run completed", "cascade lifecycle reason default");
}

process.stdout.write("maruntime-run-transition: ok\n");
