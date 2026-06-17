#!/usr/bin/env node
// demo-bundle-smoke: `cw demo bundle` must be a hermetic, no-API proof that the
// PORTABLE BUNDLE guarantee holds — a sealed report bundle verifies offline with
// only its embedded public key, and forging it (chain layer OR signature layer) is
// caught even when the archive's own file digests stay valid. It must FAIL CLOSED:
// if any forgery ever went undetected, proven=false and the CLI exits 1, so the
// onboarding demo can never green a broken guarantee. This is the Track-A
// "runnable from the README in seconds, no agent" proof for the report bundle.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { runBundleDemo } = require("../dist/telemetry-demo");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

// --- 1. Programmatic: the demo proves itself, hermetically ---
{
  const r = runBundleDemo();
  assert.equal(r.proven, true, "the bundle guarantee is proven");
  assert.equal(r.trustKey, "ephemeral-ed25519", "uses an ephemeral key (no real key touched)");
  assert.equal(r.baseline.ok, true, "the clean sealed bundle verifies offline");
  assert.equal(r.baseline.telemetryVerified, true, "clean telemetry chain verifies");
  assert.equal(r.baseline.signaturesReverified, 2, "both attested hops reverify with only the embedded public key");
  assert.equal(r.layers.length, 2, "both a chain forgery and a signature forgery are demonstrated");

  const chain = r.layers.find((l) => l.layer === "chain");
  assert.ok(chain, "chain forgery layer present");
  assert.equal(chain.before.ok, true, "chain layer starts from a verifying bundle");
  assert.equal(chain.after.ok, false, "the chain forgery is caught");
  assert.ok(chain.failures.length > 0, "the chain forgery names its failed checks");

  const sig = r.layers.find((l) => l.layer === "signature");
  assert.ok(sig, "signature forgery layer present");
  assert.equal(sig.before.ok, true, "signature layer starts from a verifying bundle");
  assert.equal(sig.after.ok, false, "the signature forgery is caught");
  assert.ok(sig.failures.length > 0, "the signature forgery names its failed checks");
}

// --- 2. CLI: --json exits 0 and proves it; human output carries the verdict ---
{
  const out = JSON.parse(execFileSync(process.execPath, [cli, "demo", "bundle", "--json"], { cwd: pluginRoot, encoding: "utf8" }));
  assert.equal(out.proven, true, "CLI demo bundle --json proves the guarantee");

  const human = spawnSync(process.execPath, [cli, "demo", "bundle"], { cwd: pluginRoot, encoding: "utf8" });
  assert.equal(human.status, 0, "demo bundle exits 0 when the proof holds");
  assert.match(human.stdout, /VERDICT: bundle verification holds/, "human output renders the holding verdict");
  assert.match(human.stdout, /DETECTED/, "human output shows each forgery being detected");
}

process.stdout.write("demo-bundle-smoke: ok\n");
