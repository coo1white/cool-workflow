#!/usr/bin/env node
// statecore-verify-node-replay (milestone 3) — pins verifyNodeReplay:
// NEVER throws (a drifted source is a pass:false finding, not an
// exception); source-absent gives a specific finding shape; a drifted
// section gives a "drift:<section>" finding. SPEC/state-core.md
// "verifyNodeReplay(run, replay, {now?})".

const assert = require("node:assert/strict");
const { createStateNode } = require("../dist/core/state/state-node");
const { snapshotNode, replayNodeSnapshot, verifyNodeReplay } = require("../dist/core/state/node-snapshot");

function makeRun(nodes) {
  return { id: "run-1", nodes };
}

// A replay of an unchanged source passes with zero findings.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replay = replayNodeSnapshot(run, snap, { persist: false });
  const verdict = verifyNodeReplay(run, replay, {});
  assert.equal(verdict.pass, true);
  assert.equal(verdict.freshness, "valid");
  assert.deepEqual(verdict.findings, []);
}

// source-absent: source node gone entirely — NEVER throws, returns
// pass:false with the exact finding shape.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replay = replayNodeSnapshot(run, snap, { persist: false });
  const emptyRun = makeRun([]);
  const verdict = verifyNodeReplay(emptyRun, replay, {});
  assert.equal(verdict.pass, false);
  assert.equal(verdict.freshness, "absent");
  assert.deepEqual(verdict.findings, [
    { id: "source-absent", severity: "error", category: "source", reason: "source node n1 is gone" },
  ]);
}

// A source that transitioned AFTER the replay was captured (drift) reports
// pass:false with a drift:<section> finding — not a throw.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replay = replayNodeSnapshot(run, snap, { persist: false });
  const transitioned = { ...node, status: "running", updatedAt: "2099-01-01T00:00:00.000Z" };
  const runAfter = makeRun([transitioned]);
  const verdict = verifyNodeReplay(runAfter, replay, {});
  assert.equal(verdict.pass, false, "a drifted source must fail verification, never throw");
  assert.equal(verdict.freshness, "valid", "verifyNodeReplay reports the FRESH snapshot's freshness (valid, taken now), not the replay's own");
  const statusFinding = verdict.findings.find((f) => f.id === "drift:status");
  assert.ok(statusFinding, "a status drift must produce a drift:status finding");
  assert.equal(statusFinding.severity, "error");
  assert.equal(statusFinding.category, "status");
  assert.equal(statusFinding.reason, "replay diverged from source in status");
  assert.equal(statusFinding.baselineRef, replay.snapshotId);
  assert.equal(statusFinding.replayRef, replay.replayId);
}

// pass is true ONLY with zero findings — multiple simultaneous drifts each
// produce their own finding.
{
  const node = createStateNode({ id: "n1", kind: "task", loopStage: "interpret" });
  const run = makeRun([node]);
  const snap = snapshotNode(run, "n1", { persist: false });
  const replay = replayNodeSnapshot(run, snap, { persist: false });
  const drifted = { ...node, status: "running", updatedAt: "2099-01-01T00:00:00.000Z", metadata: { changed: true } };
  const runAfter = makeRun([drifted]);
  const verdict = verifyNodeReplay(runAfter, replay, {});
  assert.equal(verdict.pass, false);
  assert.ok(verdict.findings.length >= 2, "multiple drifted sections must each produce a finding");
  const ids = verdict.findings.map((f) => f.id).sort();
  assert.deepEqual(ids, ["drift:metadata", "drift:status"].sort());
}

process.stdout.write("statecore-verify-node-replay: ok\n");
