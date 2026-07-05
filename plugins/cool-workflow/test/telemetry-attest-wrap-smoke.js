#!/usr/bin/env node
"use strict";

// @cw-smoke: tags slow
// telemetry-attest-wrap-smoke (Track 1) — the EXECUTOR signing wrapper flips a
// real (unsigned) agent's telemetry to `attested` end-to-end, with NO signing
// logic in the agent itself. Proves:
//   1. cw-attest-keygen writes an ed25519 keypair (private 0600 + public);
//   2. CW drives an UNSIGNED inner agent THROUGH cw-attest-wrap (which signs using
//      the private key + the manifest's binding context) ⇒ CW verifies the usage
//      `attested`, the ledger verifies, and the report shows full coverage;
//   3. the SAME inner agent through the wrapper but with NO private key ⇒ the
//      wrapper emits UNSIGNED ⇒ CW records `unattested` (honest default), surfaced
//      loudly — never a fabricated attestation.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
// v2 layout: the old flat dist modules (orchestrator.js / drive.js /
// orchestrator/report.js / telemetry-ledger.js / telemetry-attestation.js)
// were split into src/shell/** + src/core/**. There is NO CoolWorkflowRunner
// facade class in v2 — plan/loadRun/drive are free functions.
//   dist/orchestrator.js  (CoolWorkflowRunner) → plan (shell/pipeline) +
//                                                 loadRunFromCwd (shell/run-store)
//   dist/drive.js                             → shell/drive
//   dist/orchestrator/report.js               → shell/report
//   dist/telemetry-ledger.js  (verifyTelemetryLedger) → shell/telemetry-ledger-io
//   dist/telemetry-attestation.js             → core/trust/telemetry-attestation
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));
const { writeReport } = require(path.join(pluginRoot, "dist/shell/report.js"));
const ledger = require(path.join(pluginRoot, "dist/shell/telemetry-ledger-io.js"));
const ta = require(path.join(pluginRoot, "dist/core/trust/telemetry-attestation.js"));

// makeRunner() reconstructs the old runner.plan / .loadRun surface over v2's
// free functions. The smoke chdir's into each workspace before it plans/drives,
// so process.cwd() is the run's cwd (loadRunFromCwd + plan both default cwd to
// process.cwd()) — preserving the old runner's cwd behaviour.
function makeRunner() {
  return {
    plan(appId, inputs) {
      return plan(loadWorkflowApp(appId), inputs);
    },
    loadRun(runId) {
      return loadRunFromCwd(runId, process.cwd());
    },
  };
}
// v2 drive takes (runId, cwd, options) positionally — NOT (runner, runId, ...).
// The smoke always drives from inside the workspace it chdir'd into, so
// process.cwd() is the correct cwd.
function driveRun(_runner, runId, options) {
  return drive(runId, process.cwd(), options);
}

// DEFERRED-TOOLING (v2 cutover): this smoke's OWN dist imports are repointed to
// v2 above, and the drive now plans + spawns the agent hop correctly. But the
// EXECUTOR script it wraps around — scripts/agents/cw-attest-wrap.js — still does
// `require(".../dist/telemetry-attestation.js")` (the OLD flat path) at its line
// 35. v2 moved that module to dist/core/trust/telemetry-attestation.js, so the
// wrapper CRASHES on load (MODULE_NOT_FOUND), every agent hop exits 1, and the
// drive parks instead of completing. Repointing that require lives in the script
// (a separate cutover job), NOT in this test. Once the wrapper is repointed this
// smoke should go green with no further test change.
const WRAP = path.join(pluginRoot, "scripts/agents/cw-attest-wrap.js");
const KEYGEN = path.join(pluginRoot, "scripts/agents/cw-attest-keygen.js");

const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-attest-wrap-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_AGENT_ATTEST_PUBKEY", "CW_AGENT_ATTEST_PRIVKEY"]) delete process.env[v];
}
// A minimal UNSIGNED inner agent: writes result.md and prints {model, usage}.
// It knows NOTHING about signing — the wrapper adds the signature.
function writeInnerStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "inner-opus", usage: { input_tokens: 4, output_tokens: 2 } }));'
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function driveThroughWrapper(work, innerStub, manifestPlaceholder, attestPublicKey) {
  const runner = makeRunner();
  const run = runner.plan("architecture-review", { repo: work, question: "Sound?" });
  const result = driveRun(runner, run.id, {
    now: "2026-06-10T00:00:00.000Z",
    agentConfig: {
      schemaVersion: 1,
      command: process.execPath,
      // node wrap.js --manifest {{manifest}} -- node innerStub {{result}}
      args: [WRAP, "--manifest", manifestPlaceholder, "--", process.execPath, innerStub, "{{result}}"],
      model: "operator-pick",
      attestPublicKey,
      source: "flag"
    }
  });
  return { result, final: runner.loadRun(run.id) };
}

function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();

  // ---- 1. keygen writes a usable keypair ----------------------------------
  const keyDir = tmpWorkspace();
  const gen = spawnSync(process.execPath, [KEYGEN, "--out-dir", keyDir], { encoding: "utf8" });
  assert.equal(gen.status, 0, `keygen exits 0: ${gen.stderr}`);
  const keyPath = path.join(keyDir, "cw-attest.key");
  const pubPath = path.join(keyDir, "cw-attest.pub");
  assert.ok(fs.existsSync(keyPath) && fs.existsSync(pubPath), "keygen wrote private + public");
  const pubPem = fs.readFileSync(pubPath, "utf8");
  assert.match(pubPem, /BEGIN PUBLIC KEY/, "public key is PEM");
  assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600, "private key is 0600");

  // ---- 2. drive an UNSIGNED agent THROUGH the wrapper ⇒ attested ----------
  const workA = tmpWorkspace();
  const inner = writeInnerStub(path.join(workA, "inner.js"));
  process.chdir(workA);
  try {
    process.env.CW_AGENT_ATTEST_PRIVKEY = keyPath; // the wrapper signs with this
    const { result, final } = driveThroughWrapper(workA, inner, "{{manifest}}", pubPem);
    assert.equal(result.status, "complete", "wrapped drive completes");
    const usages = (final.workers || []).map((w) => w.usage).filter(Boolean);
    assert.ok(usages.length >= 1, "usage recorded");
    assert.ok(usages.every((u) => u.attestation === "attested"), "wrapper-signed usage verifies as attested");
    assert.ok(usages.every((u) => u.inputTokens === 4 && u.outputTokens === 2), "token buckets recorded");
    const lv = ledger.verifyTelemetryLedger(final);
    assert.ok(lv.present && lv.verified && lv.attested === lv.records.length, "ledger verifies, all attested");
    // The wrapper's signature is RESULT-BOUND (5-field), not usage-only: CW verified
    // it `attested` above using the result digest. Prove it is not the 4-field
    // back-compat fallback silently passing — re-verifying the SAME signature WITHOUT
    // a resultDigest must fail (a usage-only signature would still pass). So editing
    // the agent's findings — which changes the result digest — is detected.
    const rec = lv.records.find((r) => r.usageSignature);
    assert.ok(rec, "an attested record carries a signature");
    const unbound = ta.verifyTelemetryAttestation(rec.reportedUsage, rec.usageSignature, pubPem, {
      runId: rec.runId,
      taskId: rec.taskId,
      promptDigest: rec.promptDigest
    });
    assert.equal(unbound.status, "unattested", "the recorded signature covers the result (a 4-field verify must fail)");
    // The INDEPENDENT re-verifier (behind `telemetry verify --pubkey` and `report
    // verify`/restore) must ACCEPT a result-bound signature — it reconstructs the
    // 5-field payload from the record's stored resultDigest. Regression guard: a
    // verifier that ignored resultDigest rejected every legitimate signed run.
    assert.ok(rec.resultDigest, "the ledger record stores the signed result digest");
    const sigCheck = ta.verifyTelemetrySignatures(lv.records, pubPem);
    assert.equal(sigCheck.failed, 0, "the independent re-verifier accepts result-bound signatures");
    assert.ok(sigCheck.reverified >= 1, "at least one result-bound signature re-verified with the public key");
    const md = fs.readFileSync(writeReport(final), "utf8");
    assert.ok(!/UNATTESTED/.test(md), "no unattested warning when wrapper signs");
    assert.match(md, /Attestation ledger: \d+ records, chain verified/, "ledger chain verified in report");
  } finally {
    delete process.env.CW_AGENT_ATTEST_PRIVKEY;
    process.chdir(cwd0);
  }

  // ---- 3. SAME wrapper, NO private key ⇒ honest unattested ----------------
  const workB = tmpWorkspace();
  const innerB = writeInnerStub(path.join(workB, "inner.js"));
  process.chdir(workB);
  try {
    // CW_AGENT_ATTEST_PRIVKEY intentionally unset ⇒ wrapper emits unsigned.
    const { final } = driveThroughWrapper(workB, innerB, "{{manifest}}", pubPem);
    const usages = (final.workers || []).map((w) => w.usage).filter(Boolean);
    assert.ok(usages.length >= 1 && usages.every((u) => u.attestation === "unattested"), "no signing key ⇒ unattested");
    const md = fs.readFileSync(writeReport(final), "utf8");
    assert.match(md, /UNATTESTED usage/, "report surfaces unattested loudly");
  } finally {
    process.chdir(cwd0);
  }

  for (const dir of cleanups) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  console.log("telemetry-attest-wrap-smoke: ok (keygen, wrapper signs unsigned agent ⇒ attested, no key ⇒ honest unattested)");
}

main();
