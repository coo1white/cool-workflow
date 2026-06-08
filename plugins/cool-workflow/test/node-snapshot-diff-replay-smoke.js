"use strict";
// node-snapshot-diff-replay-smoke (v0.1.35). Proves the per-node snapshot/diff/
// replay mechanism over a REAL persisted StateNode (created via the production
// createStateNode path, not a hand-rolled blob):
//   1. snapshot is derived + sha256-fingerprinted; re-snapshotting an unchanged
//      node yields identical fingerprint + byte-identical body (only capturedAt,
//      a now-derived field, differs).
//   2. two replays with DIFFERENT injected `now` are byte-identical in body +
//      outputFingerprint (zero wall-clock leaks into the deterministic payload).
//   3. verify replay-vs-source passes for an unchanged node.
//   4. structural diff after a transition is stable and reports the change.
//   5. FAIL CLOSED: replaying a snapshot whose source has changed refuses
//      (`snapshot-stale`); an absent node surfaces `absent`.
//   6. the disk-loaded run path + the orchestrator entries are reachable.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { createRunPaths, ensureRunDirs, saveCheckpoint, loadRunFromCwd } = require(path.join(pluginRoot, "dist/state.js"));
const { appendRunNode, createStateNode, transitionStateNode } = require(path.join(pluginRoot, "dist/state-node.js"));
const ns = require(path.join(pluginRoot, "dist/node-snapshot.js"));
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-node-snapshot-")));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "ns-smoke"));
ensureRunDirs(paths);
const artifact = path.join(paths.resultsDir, "result.md");
fs.writeFileSync(artifact, "verified result\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "ns-smoke",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  cwd: tmp,
  workflow: { id: "ns-smoke", title: "NS Smoke", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: {},
  loopStage: "observe",
  phases: [],
  tasks: [],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: []
};
appendRunNode(
  run,
  createStateNode({
    id: "node:result",
    kind: "result",
    status: "completed",
    loopStage: "observe",
    artifacts: [{ id: "result", kind: "markdown", path: artifact }],
    evidence: [{ id: "e1", source: "cw:result", locator: "file.ts:1" }]
  })
);
saveCheckpoint(run);

const EPOCH = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-12-31T23:59:59.999Z";

// 1. snapshot determinism
const s1 = ns.snapshotNode(run, "node:result", { now: EPOCH });
const s2 = ns.snapshotNode(run, "node:result", { now: FUTURE });
assert.equal(s1.sourceFingerprint, s2.sourceFingerprint, "re-snapshot fingerprint identical");
assert.equal(JSON.stringify(s1.body), JSON.stringify(s2.body), "re-snapshot body byte-identical");
assert.notEqual(s1.capturedAt, s2.capturedAt, "capturedAt is now-derived (differs)");
assert.ok(s1.sourceFingerprint.startsWith("sha256:"), "snapshot carries a sha256 fingerprint");

// 2. replay determinism (no wall-clock leak)
const r1 = ns.replayNodeSnapshot(run, s1, { now: EPOCH, persist: false });
const r2 = ns.replayNodeSnapshot(run, s1, { now: FUTURE, persist: false });
assert.equal(r1.outputFingerprint, r2.outputFingerprint, "two replays: outputFingerprint identical");
assert.equal(JSON.stringify(r1.body), JSON.stringify(r2.body), "two replays: body byte-identical");
assert.notEqual(r1.replayedAt, r2.replayedAt, "replayedAt is injected (differs)");

// 3. verify replay vs source
const verdict = ns.verifyNodeReplay(run, r1, { now: EPOCH });
assert.equal(verdict.pass, true, "replay matches source");
assert.equal(verdict.findings.length, 0, "no drift findings");

// 4. structural diff after a transition
run.nodes[0] = transitionStateNode(run.nodes[0], { status: "verified", loopStage: "adjust" });
const s3 = ns.snapshotNode(run, "node:result", { now: EPOCH, persist: false });
const diffA = ns.diffNodeSnapshots(s1, s3);
const diffB = ns.diffNodeSnapshots(s1, s3);
assert.equal(diffA.changed, true, "diff after transition reports a change");
assert.equal(diffA.sections.find((x) => x.section === "status").change, "changed", "status section changed");
assert.equal(JSON.stringify(diffA), JSON.stringify(diffB), "diff is byte-stable across repeated runs");

// 5. FAIL CLOSED — replaying the now-stale s1 against the changed source refuses
assert.throws(
  () => ns.replayNodeSnapshot(run, s1, { persist: false }),
  (e) => e.code === "snapshot-stale" && e.freshness === "stale",
  "stale snapshot replay refuses"
);
run.nodes = [];
assert.equal(ns.loadNodeSnapshot(run, s1).freshness, "absent", "absent node surfaces absent");

// 6. disk-loaded run path + orchestrator entries reachable
const reloaded = loadRunFromCwd("ns-smoke", tmp);
const onDisk = ns.snapshotNode(reloaded, "node:result", { now: EPOCH, persist: false });
assert.equal(onDisk.sourceFingerprint, s1.sourceFingerprint, "disk-loaded run snapshots identically");
for (const m of ["nodeSnapshot", "nodeDiff", "nodeReplay", "nodeReplayVerify"]) {
  assert.equal(typeof CoolWorkflowRunner.prototype[m], "function", `orchestrator exposes ${m}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("node-snapshot-diff-replay-smoke: ok (deterministic snapshot/replay, stable diff, fail-closed stale/absent, orchestrator wired)\n");
