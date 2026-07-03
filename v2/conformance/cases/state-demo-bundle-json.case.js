#!/usr/bin/env node
"use strict";

// `cw demo bundle --json` -- the offline, hermetic bundle-tamper proof.
// This is deterministic (fixed hops, fixed clock, only the ephemeral key
// varies and never leaves the process), so the whole JSON shape is
// checked field by field rather than pinned as one fixture. Two runs in
// a row must give byte-identical JSON.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const first = run(["demo", "bundle", "--json"]);
  assert.equal(first.status, 0);
  const second = run(["demo", "bundle", "--json"]);
  assert.equal(second.status, 0);
  assert.equal(first.stdout, second.stdout, "cw demo bundle must be byte-identical across runs");

  const result = JSON.parse(first.stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.runId, "demo-bundle-run");
  assert.equal(result.workers, 3);
  assert.equal(result.trustKey, "ephemeral-ed25519");
  assert.equal(result.proven, true, "the bundle demo must prove every forgery caught");

  assert.equal(result.baseline.ok, true);
  assert.equal(result.baseline.telemetryVerified, true);
  assert.equal(result.baseline.signaturesReverified, 2);

  assert.equal(result.layers.length, 2, "chain layer + signature layer");
  const [chainLayer, sigLayer] = result.layers;
  assert.equal(chainLayer.layer, "chain");
  assert.equal(chainLayer.before.ok, true);
  assert.equal(chainLayer.after.ok, false);
  assert.ok(chainLayer.failures.length >= 1);

  assert.equal(sigLayer.layer, "signature");
  assert.equal(sigLayer.before.ok, true);
  assert.equal(sigLayer.after.ok, false);
  assert.ok(sigLayer.failures.length >= 1);

  // human render (no --json) is exit 0 too, and states the same verdict
  const human = run(["demo", "bundle"]);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /VERDICT: bundle verification holds/);
});
