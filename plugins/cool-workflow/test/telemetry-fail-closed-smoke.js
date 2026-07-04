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
//
// v2 module layout: the flat dist/*.js facades (orchestrator.js, drive.js,
// telemetry-attestation.js, agent-config.js) are gone. The old
// CoolWorkflowRunner facade class + its runner.plan/dispatch/recordWorkerOutput/
// showWorkerManifest/showWorker/loadRun methods no longer exist. The functions
// they wrapped now live as PURE free functions under dist/shell/** and
// dist/core/trust/**; recordWorkerOutput/allocateWorkerScope/showWorkerManifest
// take the run OBJECT (not a runId) and mutate it in place, and drive takes
// (runId, cwd, options). Below we rebuild the exact methods this smoke uses over
// those free functions and preserve every assertion's INTENT.
//
// One INTENT-preserving field remap: the old runner.showWorker(id).usage
// .attestation carried the per-hop verdict ("attested"/"unattested"). v2's
// worker.usage no longer holds that field (worker-isolation.ts records only
// model+token counts on usage); the SAME verdict now lives on the accepted
// result node's metadata.agentDelegation.usageAttestation
// (worker-isolation.ts:414/456/522). We read it from there — it is the same
// value the accept path computes, NOT a weaker check.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive"));
const { allocateWorkerScope, recordWorkerOutput, showWorkerManifest } = require(path.join(pluginRoot, "dist/shell/worker-isolation"));
const ta = require(path.join(pluginRoot, "dist/core/trust/telemetry-attestation"));
const { resolveAgentConfig } = require(path.join(pluginRoot, "dist/shell/agent-config"));

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
  // v2 auto-detects an agent from PATH when no command/endpoint is configured;
  // CW_NO_AUTO_AGENT=1 suppresses that so the hermetic seam calls below (which
  // pass an explicit delegation/agentConfig) are unaffected by the host PATH.
  process.env.CW_NO_AUTO_AGENT = "1";
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
// Dispatch one agent worker and return {run, workerId, taskId, wm}. The old
// runner.plan + runner.dispatch({limit:1, backend:"agent"}) +
// runner.showWorkerManifest is reconstructed as plan() + allocateWorkerScope()
// (which sets task.workerId) + showWorkerManifest(). recordWorkerOutput below
// mutates the SAME `run` object in place, so we keep and re-read it (no
// runner.loadRun round-trip is needed — and recordWorkerOutput does not persist
// a run checkpoint, so a reload would not reflect the in-memory mutation).
function dispatchOne(work) {
  const run = plan(loadWorkflowApp("architecture-review"), { repo: work, question: "Sound?" });
  const task = run.tasks[0];
  const scope = allocateWorkerScope(run, task, { backendId: "agent" });
  const wm = showWorkerManifest(run, scope.id);
  return { run, runId: run.id, workerId: scope.id, taskId: task.id, wm };
}
// The verdict the old runner.showWorker(id).usage.attestation exposed now lives
// on the accepted result node's metadata.agentDelegation.usageAttestation.
function nodeAttestation(run, taskId) {
  const node = (run.nodes || []).find((n) => n.kind === "result" && n.metadata && n.metadata.taskId === taskId);
  return node && node.metadata && node.metadata.agentDelegation ? node.metadata.agentDelegation.usageAttestation : undefined;
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
    const { run, workerId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    const task = run.tasks.find((t) => t.workerId === workerId);
    assert.throws(
      () => recordWorkerOutput(run, workerId, wm.resultPath, {
        requireAttestedTelemetry: true,
        agentDelegation: baseDelegation(wm, { reportedUsage: usage, usageSignature: undefined, usageTrustPublicKey: publicPem })
      }),
      /telemetry|unattested|verify/i,
      "unsigned usage is blocked under require-attested-telemetry"
    );
    // recordWorkerOutput mutates `run` in place (recordWorkerFailure sets
    // task.status="failed" on the blocked hop), so we read the SAME object.
    assert.notEqual(task && task.status, "completed", "blocked hop is NOT accepted");
  });

  // 2. require ON + NO usage (absent) ⇒ throws (parks absent too)
  withCwd(tmpWorkspace(), () => {
    const work = process.cwd();
    const { run, workerId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    assert.throws(
      () => recordWorkerOutput(run, workerId, wm.resultPath, {
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
    const { run, workerId, taskId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    const sig = ta.signTelemetry(usage, privatePem, { runId: run.id, taskId, promptDigest: "sha256:p" });
    recordWorkerOutput(run, workerId, wm.resultPath, {
      requireAttestedTelemetry: true,
      agentDelegation: baseDelegation(wm, { reportedUsage: usage, usageSignature: sig, usageTrustPublicKey: publicPem })
    });
    assert.equal(nodeAttestation(run, taskId), "attested", "signed usage is attested and accepted under require");
  });

  // 4. require OFF + unsigned ⇒ accepted as unattested (default behavior intact)
  withCwd(tmpWorkspace(), () => {
    const work = process.cwd();
    const { run, workerId, taskId, wm } = dispatchOne(work);
    fs.writeFileSync(wm.resultPath, validResult(work), "utf8");
    recordWorkerOutput(run, workerId, wm.resultPath, {
      agentDelegation: baseDelegation(wm, { reportedUsage: usage, usageSignature: undefined, usageTrustPublicKey: publicPem })
    });
    assert.equal(nodeAttestation(run, taskId), "unattested", "default: unsigned is recorded unattested, NOT blocked");
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
      const run = plan(loadWorkflowApp("architecture-review"), { repo: work, question: "Sound?" });
      // v2 drive takes (runId, cwd, options) — NOT (runner, runId, options).
      const result = drive(run.id, work, {
        now: FIXED_NOW,
        agentConfig: { schemaVersion: 1, command: process.execPath, args: [inner, "{{result}}"], model: "op", attestPublicKey: publicPem, requireAttestedTelemetry: true, source: "flag" }
      });
      assert.notEqual(result.status, "complete", "require-attested drive does NOT complete with an unsigned agent");
      const final = loadRunFromCwd(run.id, work);
      // No unverified usage was ever accepted: no result node carries a
      // non-attested agentDelegation.usageAttestation (the accept path parks
      // an unattested hop BEFORE creating the result node). This is the v2
      // equivalent of the old "no unattested hop was accepted" check.
      const accepted = (final.nodes || []).filter(
        (n) => n.kind === "result" && n.metadata && n.metadata.agentDelegation && n.metadata.agentDelegation.usageAttestation && n.metadata.agentDelegation.usageAttestation !== "attested"
      );
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
