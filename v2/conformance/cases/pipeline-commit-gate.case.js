#!/usr/bin/env node
"use strict";

// The manual `cw commit <run-id>` CLI wrapper fails closed: a bare commit
// with no --verifier/--candidate/--selection and no
// --allow-unverified-checkpoint exits non-zero with a fixed message.
// --allow-unverified-checkpoint writes a NON-gated checkpoint commit
// (verifierGated:false, checkpoint:true) instead.

const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const plan = run(["plan", "end-to-end-golden-path", "--question", "prove it", "--repo", repo, "--json"], {
    cwd: repo,
  });
  assert.equal(plan.status, 0);
  const planPayload = JSON.parse(plan.stdout);

  // Bare commit: fails closed, non-zero exit, fixed stderr message.
  const bare = run(["commit", planPayload.runId, "--json"], { cwd: repo });
  assert.equal(bare.status, 1);
  assert.equal(bare.stdout, "");
  assert.match(bare.stderr, /Verifier-gated commit requires --verifier, --candidate, or --selection/);

  // --allow-unverified-checkpoint succeeds and writes a checkpoint (not a
  // verifier-gated commit).
  const checkpoint = run(["commit", planPayload.runId, "--allow-unverified-checkpoint", "--json"], {
    cwd: repo,
  });
  assert.equal(checkpoint.status, 0);
  const checkpointPayload = JSON.parse(checkpoint.stdout);
  assert.equal(checkpointPayload.commit.verifierGated, false);
  assert.equal(checkpointPayload.commit.checkpoint, true);
  assert.match(checkpointPayload.commit.stateNodeId, /:checkpoint:state-\d+$/);

  const snapshot = readJson(checkpointPayload.commit.snapshotPath);
  assert.equal(snapshot.commit.id, checkpointPayload.commit.id);
  assert.equal(snapshot.commit.reason, "manual");
});
