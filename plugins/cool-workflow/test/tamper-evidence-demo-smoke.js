#!/usr/bin/env node
"use strict";

// tamper-evidence-demo-smoke — the CI guard for `cw demo tamper` + `cw telemetry
// verify`. This is self-guarding: it proves the tamper-evidence GUARANTEE still
// holds (every forgery caught), so the integrity property cannot be silently
// broken by a future change. The demo is the project's headline differentiator;
// a regression here is a false-green about false-green detection itself.
//
// Hermetic: the demo builds its own ephemeral-key ledger in a tmpdir; no network,
// no model, no agent.
//
// Proves:
//   1. runTamperDemo(): clean ledger verifies + signatures valid; the LEDGER-layer
//      forgery (verdict flip + re-sealed local hash) is caught by the chain
//      (chain-link break); the SIGNATURE-layer forgery (inflated tokens, reused
//      signature) is caught by ed25519 verify; the RESULT-layer forgery (edit a
//      signed finding) is caught because CW re-derives sha256(result) and the
//      signed 5-field payload no longer joins; proven === true overall.
//   2. The demo leaves no tmp dir behind (default cleanup).
//   3. telemetryVerify(): a clean real run verifies; flipping one byte in its
//      telemetry.json on disk makes the SAME verb report verified:false with a
//      specific failing check — the operator-facing half of the same guarantee.
//   4. demoTamper exits nonzero shape: result.proven gates the CLI exit code
//      (asserted structurally — proven true here).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { runTamperDemo } = require(path.join(pluginRoot, "dist/telemetry-demo.js"));
const { telemetryVerify, demoTamper } = require(path.join(pluginRoot, "dist/capability-core.js"));
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { appendTelemetryAttestation } = require(path.join(pluginRoot, "dist/telemetry-ledger.js"));

function main() {
  // ---- 1. the demo proves both layers ---------------------------------------
  const tmpBefore = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("cw-tamper-demo-")).length;
  const demo = runTamperDemo();
  assert.equal(demo.proven, true, "tamper-evidence proof holds end to end");
  assert.equal(demo.baseline.ledgerVerified, true, "clean ledger verifies");
  assert.equal(demo.baseline.signaturesValid, 2, "both signed hops verify against the public key");
  assert.equal(demo.layers.length, 3, "ledger + signature + result layers all demonstrated");

  const ledger = demo.layers.find((l) => l.layer === "ledger");
  assert.ok(ledger.before.verified && !ledger.after.verified, "ledger: verified before, detected after");
  assert.ok(ledger.failures.some((f) => /chain-link|digest-mismatch/.test(f)), `ledger forgery caught by the chain: ${ledger.failures.join(",")}`);

  const sig = demo.layers.find((l) => l.layer === "signature");
  assert.ok(sig.before.verified && !sig.after.verified, "signature: valid before, rejected after");
  assert.ok(sig.failures.some((f) => /signature/.test(f)), "signature forgery caught by ed25519 verify");

  // The RESULT layer is the headline of this cycle: editing a SIGNED FINDING is now
  // caught, because the executor binds sha256(result) into the ed25519 payload and CW
  // re-derives the digest at verify time. before must be result-COVERING (a genuine
  // 5-field signature), else the "edit a finding is detected" claim is vacuous.
  const result = demo.layers.find((l) => l.layer === "result");
  assert.ok(result, "result layer demonstrated");
  assert.ok(result.before.verified && !result.after.verified, "result: signed finding verifies before, rejected after edit");
  assert.ok(result.failures.some((f) => /result/.test(f)), "edited finding caught by the result-bound ed25519 verify");
  console.log("tamper-demo: ledger + signature + result layers all catch the forgery, proof holds ok");

  // ---- 2. no tmpdir leak -----------------------------------------------------
  const tmpAfter = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("cw-tamper-demo-")).length;
  assert.ok(tmpAfter <= tmpBefore, "runTamperDemo cleans its tmp dir by default");
  console.log("tamper-demo: no tmp dir leak ok");

  // ---- 3. demoTamper capability returns the provable result ------------------
  const viaCap = demoTamper(null, {});
  assert.equal(viaCap.proven, true, "demoTamper capability returns proven:true (CLI gates exit code on this)");
  console.log("tamper-demo: demoTamper capability ok");

  // ---- 4. telemetry verify on a real run, clean then tampered ---------------
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-telverify-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# t\n", "utf8");
  const cwd0 = process.cwd();
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const run = runner.plan("architecture-review", { repo: work, question: "q" });
    // Seed a small real ledger directly through the production append API.
    appendTelemetryAttestation(run, { workerId: "w1", taskId: "map:a", promptDigest: "d1", reportedUsage: { input_tokens: 5, output_tokens: 3 }, attestation: "unattested", now: "2026-01-01T00:00:00.000Z" });
    appendTelemetryAttestation(run, { workerId: "w2", taskId: "map:b", promptDigest: "d2", reportedUsage: { input_tokens: 7, output_tokens: 2 }, attestation: "unattested", now: "2026-01-01T00:00:01.000Z" });

    const clean = telemetryVerify(runner, { runId: run.id });
    assert.equal(clean.present, true, "ledger present");
    assert.equal(clean.verified, true, "clean ledger verifies through the verb");
    assert.equal(clean.records, 2, "both records counted");
    assert.equal(clean.failedChecks.length, 0, "no failing checks when clean");

    // Tamper on disk: flip record[0] reportedUsageDigest.
    const ledgerPath = path.join(run.paths.runDir, "telemetry.json");
    const j = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    j.records[0].reportedUsageDigest = "deadbeef";
    fs.writeFileSync(ledgerPath, JSON.stringify(j, null, 2));

    const tampered = telemetryVerify(runner, { runId: run.id });
    assert.equal(tampered.verified, false, "tampered ledger fails verification through the verb");
    assert.ok(tampered.failedChecks.length >= 1, "the verb reports the specific failing check(s)");
    assert.ok(tampered.failedChecks.some((c) => /record-hash|chain-link/.test(c.name)), "failing check names the broken record");
    console.log("telemetry verify: clean verifies, one-byte edit detected with a named check ok");
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log("tamper-evidence-demo-smoke: ok (demo proves both layers; telemetry verify is the operator-facing guarantee; self-guarding)");
}

main();
