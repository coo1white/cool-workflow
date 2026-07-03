#!/usr/bin/env node
"use strict";

// Node snapshot/replay/diff/verify round trip against a real committed
// StateNode. Pins:
//   - snapshotId = "snap-" + safeFileName(nodeId) + "-" + 12 hex
//   - sourceFingerprint = "sha256:" + 32 hex (the fingerprintStrings family,
//     NOT the 64-hex content-digest family used elsewhere)
//   - replayId = "replay-" + snapshotId + "-" + 8 hex; outputFingerprint is
//     also the 32-hex family
//   - body is normalized: run id and timestamps are scrubbed to
//     "<run-dir>"/"<timestamp>" placeholders, so replay is byte-stable
//   - node diff of a snapshot against itself: 8 sections, all "same"
//   - node verify of a fresh replay: pass:true, freshness:"valid", exit 0
//   - snapshot of a missing node fails closed with the exact message

const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

const FP32 = /^sha256:[0-9a-f]{32}$/;

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const runId = payload.runId;

  // find a completed commit node via `cw node list`
  const listResult = run(["node", "list", runId], { cwd: repo });
  assert.equal(listResult.status, 0);
  const nodes = JSON.parse(listResult.stdout);
  const commitNode = nodes.find((n) => n.kind === "commit" && n.status === "completed");
  assert.ok(commitNode, "expected a completed commit node");

  const snap = run(["node", "snapshot", runId, commitNode.id], { cwd: repo });
  assert.equal(snap.status, 0);
  const snapshot = JSON.parse(snap.stdout);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.runId, runId);
  assert.equal(snapshot.nodeId, commitNode.id);
  assert.match(snapshot.sourceFingerprint, FP32, "sourceFingerprint must be sha256: + 32 hex");
  assert.equal(
    snapshot.snapshotId,
    `snap-${commitNode.id}-${snapshot.sourceFingerprint.slice(7, 19)}`
  );
  // body is normalized: no raw run id / real timestamps leak through
  assert.equal(snapshot.body.id.includes(runId), false, "body.id must scrub the raw run id");
  assert.match(snapshot.body.id, /<timestamp>/);

  const replay = run(["node", "replay", runId, snapshot.snapshotId], { cwd: repo });
  assert.equal(replay.status, 0);
  const replayRun = JSON.parse(replay.stdout);
  assert.equal(replayRun.schemaVersion, 1);
  assert.equal(replayRun.freshness, "valid");
  assert.match(replayRun.outputFingerprint, FP32, "outputFingerprint must be sha256: + 32 hex");
  assert.equal(
    replayRun.replayId,
    `replay-${snapshot.snapshotId}-${replayRun.outputFingerprint.slice(7, 15)}`
  );
  assert.deepEqual(replayRun.body, snapshot.body, "replay body must match the snapshot body exactly");

  const verify = run(["node", "verify", runId, replayRun.replayId], { cwd: repo });
  assert.equal(verify.status, 0);
  const verdict = JSON.parse(verify.stdout);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.freshness, "valid");
  assert.deepEqual(verdict.findings, []);

  // diff a snapshot against itself: all 8 sections in fixed order, all same
  const diff = run(["node", "diff", runId, snapshot.snapshotId, snapshot.snapshotId], { cwd: repo });
  assert.equal(diff.status, 0);
  const diffResult = JSON.parse(diff.stdout);
  assert.equal(diffResult.changed, false);
  assert.deepEqual(
    diffResult.sections.map((s) => s.section),
    ["status", "inputs", "outputs", "artifacts", "evidence", "errors", "links", "metadata"]
  );
  for (const section of diffResult.sections) assert.equal(section.change, "same");

  // snapshotting a node that doesn't exist fails closed with the exact message
  const missing = run(["node", "snapshot", runId, "no-such-node"], { cwd: repo });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, `cw: Cannot snapshot: node no-such-node not found in run ${runId}\n`);
});
