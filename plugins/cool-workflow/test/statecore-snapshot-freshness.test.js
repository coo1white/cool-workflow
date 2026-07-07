#!/usr/bin/env node
// statecore-snapshot-freshness (milestone 3) — pins loadNodeSnapshot's
// freshness recomputation: valid | stale | absent, with the exact reason
// strings from SPEC/state-core.md "NodeSnapshotError codes and shapes":
// "source node <id> is gone from run <runId>", "referenced artifact path
// is unreadable: <artifactId>", "source node <id> changed since capture".

const assert = require("node:assert/strict");
const { createStateNode } = require("../dist/core/state/state-node");
const { snapshotNode, loadNodeSnapshot } = require("../dist/core/state/node-snapshot");

function makeRun(nodes) {
  return { id: "run-1", nodes };
}

// valid: node unchanged since capture.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const result = loadNodeSnapshot(run, snap);
  assert.equal(result.freshness, "valid");
  assert.equal(result.reason, undefined, "valid freshness must carry no reason");
}

// absent: source node no longer exists in the run.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const runWithoutNode = makeRun([]);
  const result = loadNodeSnapshot(runWithoutNode, snap);
  assert.equal(result.freshness, "absent");
  assert.equal(result.reason, "source node n1 is gone from run run-1");
}

// absent: a referenced artifact's path no longer exists on disk (per the
// caller-supplied pathExists check).
{
  const node = {
    ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }),
    artifacts: [{ id: "art-1", kind: "file", path: "/tmp/gone.json" }],
  };
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const result = loadNodeSnapshot(run, snap, () => false);
  assert.equal(result.freshness, "absent");
  assert.equal(result.reason, "referenced artifact path is unreadable: art-1");
}

// stale: node has transitioned (status/updatedAt changed) since capture.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const transitioned = { ...node, status: "running", updatedAt: "2099-01-01T00:00:00.000Z" };
  const runAfter = makeRun([transitioned]);
  const result = loadNodeSnapshot(runAfter, snap);
  assert.equal(result.freshness, "stale");
  assert.equal(result.reason, "source node n1 changed since capture");
}

// An artifact with no path is not checked against pathExists (short
// circuits via `artifact.path &&`), so it never causes absent by itself.
{
  const node = {
    ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }),
    artifacts: [{ id: "art-1", kind: "file", path: "" }],
  };
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const result = loadNodeSnapshot(run, snap, () => false);
  assert.equal(result.freshness, "valid", "an artifact with an empty path must not trigger the artifact-missing check");
}

// pathExists defaults to always-true when omitted, so a real (nonexistent)
// path does not fail without an explicit checker.
{
  const node = {
    ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }),
    artifacts: [{ id: "art-1", kind: "file", path: "/definitely/does/not/exist" }],
  };
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const result = loadNodeSnapshot(run, snap);
  assert.equal(result.freshness, "valid", "pathExists must default to always-true when omitted");
}

process.stdout.write("statecore-snapshot-freshness: ok\n");
