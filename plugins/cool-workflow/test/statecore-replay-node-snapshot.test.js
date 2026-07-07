#!/usr/bin/env node
// statecore-replay-node-snapshot (milestone 3) — pins replayNodeSnapshot's
// fail-closed behavior: throws snapshot-stale/snapshot-absent BEFORE any
// replay bytes are built when freshness isn't valid; replayId format;
// outputFingerprint formula. SPEC/state-core.md "replayNodeSnapshot(run,
// snapshot, {now?, persist?}) — fail-closed on drift".

const assert = require("node:assert/strict");
const { createStateNode } = require("../dist/core/state/state-node");
const { snapshotNode, replayNodeSnapshot, NodeSnapshotError } = require("../dist/core/state/node-snapshot");
const { fingerprintStrings } = require("../dist/core/hash");
const { replayStableStringify } = require("../dist/core/state/node-projection");

function makeRun(nodes) {
  return { id: "run-1", nodes };
}

// A valid (unchanged) snapshot replays successfully.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replay = replayNodeSnapshot(run, snap, { persist: false });
  assert.equal(replay.freshness, "valid");
  assert.equal(replay.snapshotId, snap.snapshotId);
  assert.equal(replay.nodeId, "n1");
  assert.equal(replay.runId, "run-1");
  assert.equal(replay.schemaVersion, 1);
}

// snapshot-stale: node transitioned since capture — throws BEFORE building
// any replay bytes.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const transitioned = { ...node, status: "running", updatedAt: "2099-01-01T00:00:00.000Z" };
  const runAfter = makeRun([transitioned]);
  assert.throws(
    () => replayNodeSnapshot(runAfter, snap, { persist: false }),
    (err) => {
      assert.ok(err instanceof NodeSnapshotError);
      assert.equal(err.code, "snapshot-stale");
      assert.equal(err.freshness, "stale");
      return true;
    },
    "replaying a stale snapshot must throw snapshot-stale"
  );
}

// snapshot-absent: source node is gone.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const emptyRun = makeRun([]);
  assert.throws(
    () => replayNodeSnapshot(emptyRun, snap, { persist: false }),
    (err) => {
      assert.ok(err instanceof NodeSnapshotError);
      assert.equal(err.code, "snapshot-absent");
      assert.equal(err.freshness, "absent");
      return true;
    },
    "replaying a snapshot whose source node is gone must throw snapshot-absent"
  );
}

// replayId format: "replay-" + snapshotId + "-" + first 8 hex chars of
// outputFingerprint.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replay = replayNodeSnapshot(run, snap, { persist: false });
  const expectedFingerprint = fingerprintStrings([replayStableStringify(snap.body)]);
  const expectedReplayId = `replay-${snap.snapshotId}-${expectedFingerprint.replace("sha256:", "").slice(0, 8)}`;
  assert.equal(replay.replayId, expectedReplayId, "replayId must match the exact formula");
  assert.equal(replay.outputFingerprint, expectedFingerprint, "outputFingerprint must be fingerprintStrings([replayStableStringify(body)])");
}

// contractValidated reflects Boolean(snapshot.body.contractId).
{
  const withContract = { ...createStateNode({ id: "n1", kind: "task", loopStage: "interpret" }), contractId: "c1" };
  const run1 = makeRun([withContract]);
  const snap1 = snapshotNode(run1, "n1", { persist: false });
  const replay1 = replayNodeSnapshot(run1, snap1, { persist: false });
  assert.equal(replay1.contractValidated, true, "contractValidated must be true when the body has a contractId");

  const withoutContract = createStateNode({ id: "n2", kind: "task", loopStage: "interpret" });
  const run2 = makeRun([withoutContract]);
  const snap2 = snapshotNode(run2, "n2", { persist: false });
  const replay2 = replayNodeSnapshot(run2, snap2, { persist: false });
  assert.equal(replay2.contractValidated, false, "contractValidated must be false when the body has no contractId");
}

// replayedAt uses the explicit `now` option; defaults to epoch-0 ISO when
// omitted (never a real clock read).
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replayWithNow = replayNodeSnapshot(run, snap, { now: "2020-03-03T00:00:00.000Z", persist: false });
  assert.equal(replayWithNow.replayedAt, "2020-03-03T00:00:00.000Z");
  const replayDefault = replayNodeSnapshot(run, snap, { persist: false });
  assert.equal(replayDefault.replayedAt, "1970-01-01T00:00:00.000Z", "replayedAt must default to the fixed epoch constant");
}

// Replaying the SAME snapshot twice produces byte-identical replay bodies
// (determinism).
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replayA = replayNodeSnapshot(run, snap, { persist: false });
  const replayB = replayNodeSnapshot(run, snap, { persist: false });
  assert.deepEqual(replayA.body, replayB.body);
  assert.equal(replayA.outputFingerprint, replayB.outputFingerprint);
}

process.stdout.write("statecore-replay-node-snapshot: ok\n");
