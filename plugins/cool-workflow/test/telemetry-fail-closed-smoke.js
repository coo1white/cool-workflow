#!/usr/bin/env node
"use strict";

// telemetry-fail-closed-smoke (Track 1, Decision 2) — OPT-IN, off by default.
// When require-attested-telemetry is on, a delegated hop whose telemetry is not
// `attested` (unattested OR absent) is REJECTED before any accept-side mutation
// and parked via the existing hop path. Proves:
//   ENFORCEMENT (direct recordWorkerOutput, the seam the drive calls):
//     1. require ON + unsigned usage (unattested) ⇒ throws, result NOT accepted;
//     2. require ON + NO usage (absent)           ⇒ throws (parks both);
//     3. require ON + correctly-signed (attested) ⇒ accepted;
//     4. require OFF + unsigned (default)          ⇒ accepted as unattested;
//   CONFIG: flags > env > file resolution, off by default;
//   END-TO-END: a drive with require ON + an unsigned agent PARKS (status !=
//     complete) via the existing hop park path, never accepting unverified usage.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const ta = require(path.join(pluginRoot, "dist/telemetry-attestation.js"));
const { resolveAgentConfig } = require(path.join(pluginRoot, "dist/agent-config.js"));

const FIXED_NOW = "2026-06-11T00:00:00.000Z";
const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-failclosed-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_AGENT_ATTEST_PUBKEY", "CW_REQUIRE_ATTESTED_TELEMETRY"]) delete process.env[v];
}
function ed25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
const fence = String.fromCharCode(96).repeat(3);
function validResult(cwd) {
  return `# R\n\n${fence}cw:result\n${JSON.stringify({ summary: "s", findings: [], evidence: [cwd + "/README.md:1"] })}\n${fence}\n`;
}
// Run a fn with cwd = work (run state lives under cwd/.cw/runs).
function withCwd(work, fn) {
  const prev = process.cwd();
  process.chdir(work);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}
// Dispatch one agent worker and return {runner, run, workerId, manifest}.
function dispatchOne(work) {
  const runner = new CoolWorkflowRunner({ pluginRoot });
  const run = runner.plan("architecture-review", { repo: work, question: "Sound?" });
  const dispatched = runner.dispatch(run.id, { limit: 1, backend: "agent" });
  const task = dispatched.tasks.find((t) => t.workerId) || dispatched.tasks[0];
  const wm = runner.showWorkerManifest(run.id, task.workerId);
  return { runner, runId: run.id, workerId: task.workerId, taskId: task.id, wm };
}
function baseDelegation(wm, extra) {
  return { handle: { kind: "process", ref: "stub", metadata: {} }, model: "m", promptDigest: "sha256:p", args: [], exitCode: 0, ...extra };
}

function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();
  const { publicPem, privatePem } = ed25519();
  const usage = { input_tokens: 4, output_tokens: 2 };

  // ---- CONFIG resolution: off by default; flags > env > file ---------------
  assert.equal(resolveAgentConfig({}).requireAttestedTelemetry, undefined, "off by default");
  assert.equal(resolveAgentConfig({}, { CW_REQUIRE_ATTESTED_TELEMETRY: "1" }).requireAttestedTelemetry, true, "env enables");
  assert.equal(resolveAgentConfig({ "require-attested-telemetry": true }, { CW_REQUIRE_ATTESTED_TELEMETRY: "0" }).requireAttestedTelemetry, true, "flag overrides env");

  // ---- ENFORCEMENT at the recordWorkerOutput seam --------------------------
  // 1. require ON + unsigned (unattested) ⇒ throws, not accepted
  withCwd(tmpWorkspace(), () => {
    const work = process.cwd();
    const { runner, runId, workerId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    assert.throws(
      () => runner.recordWorkerOutput(runId, workerId, wm.resultPath, {
        requireAttestedTelemetry: true,
        agentDelegation: baseDelegation(wm, { reportedUsage: usage, usageSignature: undefined, usageTrustPublicKey: publicPem })
      }),
      /telemetry|unattested|verify/i,
      "unsigned usage is blocked under require-attested-telemetry"
    );
    const task = runner.loadRun(runId).tasks.find((t) => t.workerId === workerId);
    assert.notEqual(task && task.status, "completed", "blocked hop is NOT accepted");
  });

  // 2. require ON + NO usage (absent) ⇒ throws (parks absent too)
  withCwd(tmpWorkspace(), () => {
    const work = process.cwd();
    const { runner, runId, workerId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    assert.throws(
      () => runner.recordWorkerOutput(runId, workerId, wm.resultPath, {
        requireAttestedTelemetry: true,
        agentDelegation: baseDelegation(wm, { usageTrustPublicKey: publicPem }) // no reportedUsage ⇒ absent
      }),
      /telemetry|absent/i,
      "absent telemetry is blocked under require-attested-telemetry"
    );
  });

  // 3. require ON + correctly-signed (attested) ⇒ accepted
  withCwd(tmpWorkspace(), () => {
    const work = process.cwd();
    const { runner, runId, workerId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    const sig = ta.signTelemetry(usage, privatePem, { runId, taskId: wm.taskId, promptDigest: "sha256:p" });
    runner.recordWorkerOutput(runId, workerId, wm.resultPath, {
      requireAttestedTelemetry: true,
      agentDelegation: baseDelegation(wm, { reportedUsage: usage, usageSignature: sig, usageTrustPublicKey: publicPem })
    });
    const w = runner.showWorker(runId, workerId);
    assert.equal(w.usage.attestation, "attested", "signed usage is attested and accepted under require");
  });

  // 4. require OFF + unsigned ⇒ accepted as unattested (default behavior intact)
  withCwd(tmpWorkspace(), () => {
    const work = process.cwd();
    const { runner, runId, workerId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    runner.recordWorkerOutput(runId, workerId, wm.resultPath, {
      agentDelegation: baseDelegation(wm, { reportedUsage: usage, usageSignature: undefined, usageTrustPublicKey: publicPem })
    });
    const w = runner.showWorker(runId, workerId);
    assert.equal(w.usage.attestation, "unattested", "default: unsigned is recorded unattested, NOT blocked");
  });

  // ---- END-TO-END: drive with require ON + unsigned agent PARKS ------------
  {
    const work = tmpWorkspace();
    const inner = path.join(work, "inner.js");
    fs.writeFileSync(inner, [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const rp = process.argv[2];",
      'fs.writeFileSync(rp, "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
      // reports usage but NEVER signs ⇒ unattested
      'process.stdout.write(JSON.stringify({ model: "m", usage: { input_tokens: 4, output_tokens: 2 } }));'
    ].join("\n"), "utf8");
    process.chdir(work);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const run = runner.plan("architecture-review", { repo: work, question: "Sound?" });
      const result = drive(runner, run.id, {
        now: FIXED_NOW,
        agentConfig: { schemaVersion: 1, command: process.execPath, args: [inner, "{{result}}"], model: "op", attestPublicKey: publicPem, requireAttestedTelemetry: true, source: "flag" }
      });
      assert.notEqual(result.status, "complete", "require-attested drive does NOT complete with an unsigned agent");
      const final = runner.loadRun(run.id);
      const accepted = (final.workers || []).filter((w) => w.usage && w.usage.attestation === "unattested" && w.status === "verified");
      assert.equal(accepted.length, 0, "no unattested hop was accepted");
      const parkedOrFailed = final.tasks.filter((t) => t.status === "parked" || t.status === "failed").length;
      assert.ok(parkedOrFailed >= 1, "at least one hop parked via the existing hop path");
    } finally {
      process.chdir(cwd0);
    }
  }

  for (const dir of cleanups) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log("telemetry-fail-closed-smoke: ok (opt-in off-by-default; unattested+absent parked; attested accepted; e2e drive parks)");
}

main();
