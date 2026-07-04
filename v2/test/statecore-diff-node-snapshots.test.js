#!/usr/bin/env node
// statecore-diff-node-snapshots (milestone 3) — pins diffNodeSnapshots'
// structural diff: 8 sections in fixed order (status, inputs, outputs,
// artifacts, evidence, errors, links, metadata), each same|added|removed|
// changed. SPEC/state-core.md "diffNodeSnapshots(baseline, candidate)".

const assert = require("node:assert/strict");
const { createStateNode } = require("../dist/core/state/state-node");
const { snapshotNode, diffNodeSnapshots } = require("../dist/core/state/node-snapshot");

function makeRun(nodes) {
  return { id: "run-1", nodes };
}

function snap(node) {
  return snapshotNode(makeRun([node]), node.id, { persist: false });
}

// Two identical snapshots: all 8 sections are "same", changed = false.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const baseline = snap(node);
  const candidate = snap(node);
  const diff = diffNodeSnapshots(baseline, candidate);
  assert.equal(diff.changed, false);
  assert.equal(diff.sections.length, 8, "must always report exactly 8 sections");
  const order = diff.sections.map((s) => s.section);
  assert.deepEqual(order, ["status", "inputs", "outputs", "artifacts", "evidence", "errors", "links", "metadata"], "sections must appear in this FIXED order");
  for (const section of diff.sections) {
    assert.equal(section.change, "same", `${section.section} must be same for identical snapshots`);
    assert.equal("baseline" in section, false, "a same section must not carry a baseline value");
    assert.equal("candidate" in section, false, "a same section must not carry a candidate value");
  }
}

// A status change is reported as "changed" with baseline/candidate values,
// and changed=true at the top level.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const baseline = snap(node);
  const candidate = snap({ ...node, status: "running" });
  const diff = diffNodeSnapshots(baseline, candidate);
  assert.equal(diff.changed, true);
  const statusSection = diff.sections.find((s) => s.section === "status");
  assert.equal(statusSection.change, "changed");
  assert.equal(statusSection.baseline, "pending");
  assert.equal(statusSection.candidate, "running");
}

// links section compares {parents, children} together as one unit.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const baseline = snap(node);
  const candidate = snap({ ...node, children: ["child-1"] });
  const diff = diffNodeSnapshots(baseline, candidate);
  const linksSection = diff.sections.find((s) => s.section === "links");
  assert.equal(linksSection.change, "changed");
  assert.deepEqual(linksSection.baseline, { parents: [], children: [] });
  assert.deepEqual(linksSection.candidate, { parents: [], children: ["child-1"] });
}

// artifacts/evidence/errors/metadata sections each detect their own
// changes independently — changing only metadata leaves the others "same".
// A default-created node has metadata undefined, so going from undefined
// to a real object classifies as "added" (baselineValue === undefined),
// not "changed" — the classification rule cares whether the BASELINE side
// was undefined, not just "did the value change".
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const baseline = snap(node);
  const candidate = snap({ ...node, metadata: { note: "changed" } });
  const diff = diffNodeSnapshots(baseline, candidate);
  const bySection = Object.fromEntries(diff.sections.map((s) => [s.section, s.change]));
  assert.equal(bySection.metadata, "added", "metadata going from undefined to a real object classifies as added");
  assert.equal(bySection.status, "same");
  assert.equal(bySection.artifacts, "same");
  assert.equal(bySection.evidence, "same");
  assert.equal(bySection.errors, "same");
}

// A genuine metadata VALUE change (both sides already defined, non-empty)
// classifies as "changed", not "added".
{
  const node = { ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }), metadata: { note: "before" } };
  const baseline = snap(node);
  const candidate = snap({ ...node, metadata: { note: "after" } });
  const diff = diffNodeSnapshots(baseline, candidate);
  const metadataSection = diff.sections.find((s) => s.section === "metadata");
  assert.equal(metadataSection.change, "changed", "a defined-to-defined metadata change must classify as changed");
  assert.deepEqual(metadataSection.baseline, { note: "before" });
  assert.deepEqual(metadataSection.candidate, { note: "after" });
}

// The diff carries baselineSnapshotId/candidateSnapshotId/
// baselineNodeId/candidateNodeId/runId from the two snapshots verbatim.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const baseline = snap(node);
  const candidate = snap(node);
  const diff = diffNodeSnapshots(baseline, candidate);
  assert.equal(diff.runId, baseline.runId);
  assert.equal(diff.baselineSnapshotId, baseline.snapshotId);
  assert.equal(diff.candidateSnapshotId, candidate.snapshotId);
  assert.equal(diff.baselineNodeId, baseline.nodeId);
  assert.equal(diff.candidateNodeId, candidate.nodeId);
  assert.equal(diff.schemaVersion, 1);
}

process.stdout.write("statecore-diff-node-snapshots: ok\n");
