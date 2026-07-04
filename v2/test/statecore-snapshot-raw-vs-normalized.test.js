#!/usr/bin/env node
// statecore-snapshot-raw-vs-normalized (milestone 3) — pins the RAW vs
// NORMALIZED fingerprint split, v2/PLAN.md byte-compat item 8 / rebuild
// risk #5: "NodeSnapshot.sourceFingerprint is RAW (includes updatedAt,
// real paths) so any transition invalidates it; the snapshot body and
// outputFingerprint are NORMALIZED (no timestamps, scrubbed paths) so
// replay output is byte-stable. These two code paths must stay visibly
// distinct functions ... never merged into one 'fingerprint' call."

const assert = require("node:assert/strict");
const { createStateNode } = require("../dist/core/state/state-node");
const { snapshotNode, sourceFingerprint } = require("../dist/core/state/node-snapshot");

function makeRun(nodes) {
  return { id: "run-1", nodes };
}

// sourceFingerprint is RAW: changing ONLY updatedAt (nothing else) flips
// the fingerprint — this is exactly what freshness detection depends on.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const fp1 = sourceFingerprint(node);
  const fp2 = sourceFingerprint({ ...node, updatedAt: "2099-01-01T00:00:00.000Z" });
  assert.notEqual(fp1, fp2, "sourceFingerprint MUST change when only updatedAt changes (it is RAW)");
}

// sourceFingerprint includes real artifact/evidence PATHS raw (not
// scrubbed) — a path-only change (same id) still flips it.
{
  const node = {
    ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }),
    artifacts: [{ id: "a1", kind: "file", path: "/tmp/run-a/out.json" }],
  };
  const fp1 = sourceFingerprint(node);
  const fp2 = sourceFingerprint({ ...node, artifacts: [{ id: "a1", kind: "file", path: "/tmp/run-b/out.json" }] });
  assert.notEqual(fp1, fp2, "sourceFingerprint must reflect the RAW artifact path (not scrubbed to <tmp>)");
}

// snapshotNode's body is NORMALIZED: a snapshot taken via `now` at two
// different (fake, explicit) clock values, of nodes that differ ONLY in
// updatedAt/paths, produces the SAME body bytes — replay stability.
{
  const nodeA = {
    ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }),
    updatedAt: "2020-01-01T00:00:00.000Z",
    artifacts: [{ id: "a1", kind: "file", path: "/tmp/run-a/out.json" }],
  };
  const nodeB = {
    ...nodeA,
    updatedAt: "2022-02-02T00:00:00.000Z",
    artifacts: [{ id: "a1", kind: "file", path: "/tmp/run-b/out.json" }],
  };
  const snapA = snapshotNode(makeRun([nodeA]), "n1", { persist: false });
  const snapB = snapshotNode(makeRun([nodeB]), "n1", { persist: false });
  assert.deepEqual(snapA.body, snapB.body, "the snapshot BODY must be normalized (byte-identical) even when updatedAt/paths differ");
}

// But the SAME two snapshots have DIFFERENT sourceFingerprint values (since
// sourceFingerprint is raw and updatedAt/path genuinely differ) — this is
// the crux of the "two visibly distinct code paths" requirement.
{
  const nodeA = {
    ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }),
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const nodeB = { ...nodeA, updatedAt: "2022-02-02T00:00:00.000Z" };
  const snapA = snapshotNode(makeRun([nodeA]), "n1", { persist: false });
  const snapB = snapshotNode(makeRun([nodeB]), "n1", { persist: false });
  assert.notEqual(snapA.sourceFingerprint, snapB.sourceFingerprint, "sourceFingerprint must differ when updatedAt differs");
  assert.deepEqual(snapA.body, snapB.body, "body must be identical despite sourceFingerprint differing");
}

// The snapshot body never contains createdAt/updatedAt/schemaVersion (it
// is the 13-field projection, normalized).
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const snap = snapshotNode(makeRun([node]), "n1", { persist: false });
  assert.equal("createdAt" in snap.body, false);
  assert.equal("updatedAt" in snap.body, false);
  assert.equal("schemaVersion" in snap.body, false);
}

// snapshotId format: "snap-" + safeFileName(nodeId) + "-" + first 12 hex of
// the RAW source fingerprint (not the normalized body's hash).
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const fp = sourceFingerprint(node);
  const expectedId = `snap-n1-${fp.replace("sha256:", "").slice(0, 12)}`;
  assert.equal(snap.snapshotId, expectedId, "snapshotId must be derived from the RAW sourceFingerprint's first 12 hex chars");
}

// capturedAt uses the explicit `now` option (clock passed in, never
// Date.now() read internally) — pure given (run, clock).
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const snap = snapshotNode(makeRun([node]), "n1", { now: "2020-05-05T00:00:00.000Z", persist: false });
  assert.equal(snap.capturedAt, "2020-05-05T00:00:00.000Z", "capturedAt must use the explicit now option, not a real clock read");
}

// capturedAt defaults to epoch-0 ISO when `now` is omitted (a fixed
// constant, not Date.now()).
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const snap = snapshotNode(makeRun([node]), "n1", { persist: false });
  assert.equal(snap.capturedAt, "1970-01-01T00:00:00.000Z", "capturedAt must default to the fixed epoch-0 constant, not a real clock read");
}

process.stdout.write("statecore-snapshot-raw-vs-normalized: ok\n");
