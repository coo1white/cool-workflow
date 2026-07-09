#!/usr/bin/env node
"use strict";

// Regression test for a real O(N) per-call disk-write bug in
// persistBlackboardState (shell/coordinator-io.ts) and persistTopologyState
// (shell/topology-io.ts): both used to rewrite EVERY topic/context/artifact/
// snapshot/decision (or topology run) record to its own file on EVERY call,
// unconditionally — so one unrelated write cost O(N) real file writes, and
// building up to N records via N such calls cost O(N^2) disk writes overall.
// Measured live before the fix: with 200,000 pre-existing artifacts injected
// into blackboard state, a single postBlackboardMessage call referencing
// just one artifact took 41 seconds of pure per-record file writes.
//
// The fix adds dirty-id tracking (see markBlackboardDirty/dirtySetsFor in
// coordinator-io.ts, dirtyTopologyIds in topology-io.ts) so a persist call
// only rewrites the records actually added or touched since the last
// persist. This test proves that two ways, matching this repo's existing
// convention of proving a hot-path fix via a deterministic call-count (see
// run-registry-control-plane-smoke.js's countedReadFileSync) rather than
// wall-clock timing, which is unreliable under concurrent test-suite load:
//
//   1. write-count: an unrelated call amid thousands of untouched stale
//      records causes writeJson calls ONLY for the record(s) it actually
//      touched, never for the untouched ones (the performance fix).
//   2. on-disk content: records that get a LATE mutation happening AFTER an
//      inner, nested persist call already flushed and cleared the dirty set
//      (context.decisionId, artifact.trustAuditEventIds — both assigned
//      after recordCoordinatorDecision's own nested persistBlackboardState
//      call) still land on disk correctly (a correctness safety net against
//      the exact failure mode this kind of dirty tracking risks: silently
//      dropping a write for a record that changed but wasn't re-marked).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const coordinator = require(path.join(pluginRoot, "dist", "shell", "coordinator-io.js"));
const topologyIo = require(path.join(pluginRoot, "dist", "shell", "topology-io.js"));
const fsAtomic = require(path.join(pluginRoot, "dist", "shell", "fs-atomic.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));
const { plan: planApp } = require(path.join(pluginRoot, "dist", "shell", "pipeline.js"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist", "shell", "workflow-app-loader.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-persist-dirty-"));

// Records every writeJson(file, ...) call made while `fn` runs, as resolved
// absolute paths. tsc-compiled CommonJS calls through the live module-
// namespace object ((0, fs_atomic_1.writeJson)(...)), so patching the
// property on the required module here intercepts every call site in both
// coordinator-io.js and topology-io.js (same precedent already used by this
// repo's blackboard-state-explosion-management-smoke.js for a different
// module).
function countWrites(fn) {
  const calls = [];
  const original = fsAtomic.writeJson;
  fsAtomic.writeJson = function counted(file, ...rest) {
    calls.push(path.resolve(String(file)));
    return original.call(this, file, ...rest);
  };
  try {
    fn();
  } finally {
    fsAtomic.writeJson = original;
  }
  return calls;
}

function countMatching(calls, pattern) {
  return calls.filter((file) => pattern.test(file)).length;
}

(function main() {
  const plan = planApp(loadWorkflowApp("architecture-review"), {
    repo: tmp,
    question: "Prove persistBlackboardState/persistTopologyState dirty tracking."
  });
  const runId = plan.id;
  const run = loadRunFromCwd(runId, tmp);
  const blackboardDir = path.join(tmp, ".cw", "runs", runId, "blackboard");
  const topologyRunsDir = path.join(tmp, ".cw", "runs", runId, "topologies", "runs");

  // ---- Minimal legitimate setup (real creates) -----------------------------
  coordinator.resolveBlackboard(run, { id: "bb-dirty", title: "Dirty Tracking" });
  coordinator.createBlackboardTopic(run, { id: "topic-1", blackboardId: "bb-dirty", title: "Topic 1" });

  // ---- Seed a large amount of STALE pre-existing state, bypassing the real
  // create functions — this stands in for records that were already written
  // to disk by many earlier, unrelated calls. None of it should be rewritten
  // by a later call that never touches it. ---------------------------------
  const SEED_N = 2000;
  for (let i = 0; i < SEED_N; i++) {
    run.blackboard.artifacts.push({ id: `seed-artifact-${i}` });
    run.blackboard.contexts.push({ id: `seed-context-${i}` });
    run.blackboard.snapshots.push({ id: `seed-snapshot-${i}` });
    run.blackboard.decisions.push({ id: `seed-decision-${i}` });
    run.blackboard.topics.push({ id: `seed-topic-${i}` });
  }

  // ---- 1. The reported repro: one unrelated write must not rewrite the
  // SEED_N * 5 untouched stale records. --------------------------------------
  const messageWrites = countWrites(() => {
    coordinator.postBlackboardMessage(run, { topicId: "topic-1", blackboardId: "bb-dirty", body: "hello world" });
  });
  assert.equal(countMatching(messageWrites, /\/blackboard\/artifacts\//), 0, "postBlackboardMessage must not rewrite any artifact file");
  assert.equal(countMatching(messageWrites, /\/blackboard\/contexts\//), 0, "postBlackboardMessage must not rewrite any context file");
  assert.equal(countMatching(messageWrites, /\/blackboard\/snapshots\//), 0, "postBlackboardMessage must not rewrite any snapshot file");
  assert.equal(countMatching(messageWrites, /\/blackboard\/decisions\//), 0, "postBlackboardMessage must not rewrite any decision file");
  assert.equal(countMatching(messageWrites, /\/blackboard\/topics\/seed-topic-/), 0, "postBlackboardMessage must not rewrite any UNRELATED topic file");
  const topicWrites = messageWrites.filter((file) => /\/blackboard\/topics\//.test(file));
  assert.equal(topicWrites.length, 1, "postBlackboardMessage rewrites exactly the ONE topic it touched, not every topic");
  assert.ok(topicWrites[0].endsWith(`${path.sep}topic-1.json`), "the one topic write is topic-1's own file");
  assert.equal(countMatching(messageWrites, /\/blackboard\/index\.json$/), 1, "the aggregate index.json is still rewritten every call, unaffected by this fix");

  // ---- 2. Positive control + the exact "late mutation after a nested
  // persist flush" correctness case: putBlackboardContext's superseded-
  // context touch, and its OWN context.decisionId assignment which happens
  // AFTER the nested recordCoordinatorDecision call already flushed the
  // dirty set once. ----------------------------------------------------------
  const first = coordinator.putBlackboardContext(run, {
    topicId: "topic-1",
    blackboardId: "bb-dirty",
    kind: "fact",
    key: "release",
    value: "v1"
  });
  assert.ok(first.decisionId, "putBlackboardContext sets decisionId on the new context");

  let second;
  const supersedeWrites = countWrites(() => {
    second = coordinator.putBlackboardContext(run, {
      topicId: "topic-1",
      blackboardId: "bb-dirty",
      kind: "fact",
      key: "release",
      value: "v2",
      supersedesContextIds: [first.id]
    });
  });
  assert.equal(countMatching(supersedeWrites, /\/blackboard\/contexts\/seed-context-/), 0, "putBlackboardContext must not rewrite unrelated stale contexts");
  const contextFilesWritten = new Set(supersedeWrites.filter((file) => /\/blackboard\/contexts\//.test(file)));
  assert.equal(contextFilesWritten.size, 2, "exactly the superseded context and the new context are rewritten, not every context");

  const firstOnDisk = JSON.parse(fs.readFileSync(path.join(blackboardDir, "contexts", `${first.id}.json`), "utf8"));
  assert.equal(firstOnDisk.status, "superseded", "the superseded context's on-disk file reflects the mutation (dirty mark inside the supersedesContextIds loop fired)");
  assert.equal(firstOnDisk.supersededByContextId, second.id, "the superseded context's on-disk file records who superseded it");

  const secondOnDisk = JSON.parse(fs.readFileSync(path.join(blackboardDir, "contexts", `${second.id}.json`), "utf8"));
  assert.equal(secondOnDisk.decisionId, second.decisionId, "decisionId (set AFTER the nested recordCoordinatorDecision persist call already flushed) still reached disk");

  // ---- 3. Same correctness case for addBlackboardArtifact's late
  // artifact.trustAuditEventIds assignment (also set after a nested persist
  // flush inside recordCoordinatorDecision). --------------------------------
  let artifact;
  const artifactWrites = countWrites(() => {
    artifact = coordinator.addBlackboardArtifact(run, { blackboardId: "bb-dirty", topicId: "topic-1", kind: "note", locator: "note://dirty-tracking-proof" });
  });
  assert.equal(countMatching(artifactWrites, /\/blackboard\/artifacts\/seed-artifact-/), 0, "addBlackboardArtifact must not rewrite unrelated stale artifacts");
  const thisArtifactWrites = artifactWrites.filter((file) => file.includes(`${path.sep}artifacts${path.sep}`) && file.endsWith(`${path.sep}${artifact.id}.json`));
  assert.ok(thisArtifactWrites.length >= 1, "the new artifact's own file IS written");

  const artifactOnDisk = JSON.parse(fs.readFileSync(path.join(blackboardDir, "artifacts", `${artifact.id}.json`), "utf8"));
  assert.ok(artifactOnDisk.trustAuditEventIds.length >= 2, "the late trustAuditEventIds mutation (set after the nested decision persist) reached disk");

  // ---- 4. Same performance fix for persistTopologyState -------------------
  const topoA = topologyIo.applyTopology(run, "map-reduce", { id: "topo-a", taskIds: ["map:server-api"] });
  assert.ok(fs.existsSync(path.join(topologyRunsDir, `${topoA.id}.json`)), "the first topology run's own file exists");

  const TOPO_SEED_N = 1000;
  for (let i = 0; i < TOPO_SEED_N; i++) run.topologies.runs.push({ id: `seed-topo-run-${i}` });

  const topoWrites = countWrites(() => {
    topologyIo.applyTopology(run, "debate", { id: "topo-b", taskIds: ["map:web-client"] });
  });
  assert.equal(countMatching(topoWrites, /[/\\]topologies[/\\]runs[/\\]seed-topo-run-/), 0, "applyTopology must not rewrite unrelated stale topology run files");
  assert.equal(countMatching(topoWrites, /[/\\]topologies[/\\]runs[/\\]topo-a\.json$/), 0, "applyTopology must not rewrite the earlier, untouched topo-a run file");
  const topoRunFilesWritten = new Set(topoWrites.filter((file) => /[/\\]topologies[/\\]runs[/\\]/.test(file)));
  assert.equal(topoRunFilesWritten.size, 1, "applyTopology rewrites exactly the ONE new topology run file, not every topology run");
  assert.ok([...topoRunFilesWritten][0].endsWith(`${path.sep}topo-b.json`), "the one topology run write is the new run's own file");
  assert.equal(countMatching(topoWrites, /[/\\]topologies[/\\]index\.json$/), 1, "the topology aggregate index.json is still rewritten every call, unaffected by this fix");

  process.stdout.write("coordinator-topology-persist-dirty-tracking-smoke: ok\n");
})();
