#!/usr/bin/env node
// quickstart-bundle-smoke: `cw quickstart ... --bundle` turns ONE command into a
// shippable, client-verifiable artifact. After a COMPLETE drive it seals the run into
// a self-verified portable bundle (export sealed + offline self-verify) and folds the
// verdict into the quickstart payload. Fail-closed on both ends: an incomplete run is
// NEVER sealed (no partial artifact shipped), and a produced bundle that does not
// self-verify drives exit 1 — so `cw quickstart ... --bundle && send-to-client` cannot
// ship a report whose bundle a client could not verify.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const WRAP = path.join(pluginRoot, "scripts/agents/cw-attest-wrap.js");
const KEYGEN = path.join(pluginRoot, "scripts/agents/cw-attest-keygen.js");

const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { quickstart, runVerifyReportBundle } = require(path.join(pluginRoot, "dist/capability-core.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));

const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-qs-bundle-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_AGENT_ATTEST_PUBKEY", "CW_AGENT_ATTEST_PRIVKEY"]) delete process.env[v];
}
// Unsigned inner agent: writes a valid evidence-gated result.md and reports a model
// (+ usage). The wrapper adds the signature when a private key is configured.
function writeStub(file, withUsage) {
  const usage = withUsage ? ', usage: { input_tokens: 4, output_tokens: 2 }' : "";
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    `process.stdout.write(JSON.stringify({ model: "qs-bundle-model"${usage} }));`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

const cwd0 = process.cwd();
clearAgentEnv();

// --- 1. happy path: ONE command drives + seals a self-verified, recipient-verifiable
//        bundle, with the trust key embedded ---
{
  const work = tmpWorkspace();
  const stub = writeStub(path.join(work, "stub.js"), false);
  const keyDir = tmpWorkspace();
  const gen = spawnSync(process.execPath, [KEYGEN, "--out-dir", keyDir], { encoding: "utf8" });
  assert.equal(gen.status, 0, `keygen exits 0: ${gen.stderr}`);
  const pubPath = path.join(keyDir, "cw-attest.pub");

  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const result = quickstart(runner, {
      appId: "architecture-review",
      repo: work,
      question: "What are the architecture risks?",
      agentCommand: `${process.execPath} ${stub} {{result}}`,
      bundle: true,
      withTrustKey: pubPath
    });
    assert.equal(result.status, "complete", "the one command drives to completion");
    assert.ok(result.bundle, "a --bundle on a completed run carries the sealed bundle");
    assert.equal(result.bundle.ok, true, "the produced bundle self-verifies (go)");
    assert.equal(result.bundle.trustKeyEmbedded, true, "the trust key was sealed into the bundle");
    assert.equal(result.bundle.verification.ok, true, "self-verification passed");
    assert.ok(fs.existsSync(result.bundle.archivePath), "the bundle file is on disk");
    // It is independently recipient-verifiable, offline, with only the embedded key.
    const recipient = runVerifyReportBundle(runner, { archive: result.bundle.archivePath, cwd: work });
    assert.equal(recipient.ok, true, "an independent verify of the produced bundle passes");
  } finally {
    process.chdir(cwd0);
  }
}

// --- 2. POLA: quickstart WITHOUT --bundle is byte-identical (no `bundle` key) ---
{
  const work = tmpWorkspace();
  const stub = writeStub(path.join(work, "stub.js"), false);
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const result = quickstart(runner, {
      appId: "architecture-review",
      repo: work,
      question: "risks?",
      agentCommand: `${process.execPath} ${stub} {{result}}`
    });
    assert.equal(result.status, "complete", "completes");
    assert.equal(Object.prototype.hasOwnProperty.call(result, "bundle"), false, "no --bundle => no bundle key (byte-identical default)");
  } finally {
    process.chdir(cwd0);
  }
}

// --- 3. skip on non-complete: --bundle on a run that did NOT complete seals nothing
//        and says why (no silent no-op, no partial artifact shipped) ---
{
  const work = tmpWorkspace();
  clearAgentEnv(); // no agent configured => drive fails closed (status=blocked)
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const result = quickstart(runner, { appId: "architecture-review", repo: work, question: "risks?", bundle: true });
    assert.notEqual(result.status, "complete", "an unconfigured agent does not complete");
    assert.equal(Object.prototype.hasOwnProperty.call(result, "bundle"), false, "an incomplete run is never sealed");
    assert.match(result.hint || "", /--bundle skipped/, "the operator is told the bundle was skipped (not silence)");
  } finally {
    process.chdir(cwd0);
  }
}

// --- 4. FAIL-CLOSED exit: a completed run with ATTESTED telemetry but no key to verify
//        it under --strict-signatures yields bundle.ok=false and the CLI exits 1.
//        The attested run is built via the signing wrapper (attestPublicKey lives in
//        the agent config, NOT the env), so at bundle time no key is resolvable. ---
{
  const work = tmpWorkspace();
  const keyDir = tmpWorkspace();
  const gen = spawnSync(process.execPath, [KEYGEN, "--out-dir", keyDir], { encoding: "utf8" });
  assert.equal(gen.status, 0, `keygen exits 0: ${gen.stderr}`);
  const keyPath = path.join(keyDir, "cw-attest.key");
  const pubPem = fs.readFileSync(path.join(keyDir, "cw-attest.pub"), "utf8");
  const inner = writeStub(path.join(work, "inner.js"), true);

  process.chdir(work);
  let runId;
  try {
    process.env.CW_AGENT_ATTEST_PRIVKEY = keyPath; // wrapper signs with this
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const run = runner.plan("architecture-review", { repo: work, question: "Sound?" });
    runId = run.id;
    const driven = drive(runner, run.id, {
      now: "2026-06-12T00:00:00.000Z",
      agentConfig: {
        schemaVersion: 1,
        command: process.execPath,
        args: [WRAP, "--manifest", "{{manifest}}", "--", process.execPath, inner, "{{result}}"],
        model: "operator-pick",
        attestPublicKey: pubPem,
        source: "flag"
      }
    });
    assert.equal(driven.status, "complete", "the wrapped drive completes with attested telemetry");
  } finally {
    delete process.env.CW_AGENT_ATTEST_PRIVKEY;
    process.chdir(cwd0);
  }

  // Now bundle the already-complete attested run under --strict-signatures with NO key
  // available (env unset, no --with-trust-key). It must refuse: ok=false, exit 1.
  clearAgentEnv();
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const result = quickstart(runner, { appId: "architecture-review", runId, repo: work, bundle: true, strictSignatures: true });
    assert.equal(result.status, "complete", "the already-complete run stays complete");
    assert.ok(result.bundle, "bundle attempted on the completed run");
    assert.equal(result.bundle.ok, false, "strict + attested + no key => not shippable");
    assert.ok(result.bundle.verification.signaturesChecked > 0, "the run really has attested records to refuse");
    assert.ok(
      result.bundle.verification.failedChecks.some((c) => c.code === "signature-key-required"),
      "the recorded reason is the strict-no-key guard"
    );
  } finally {
    process.chdir(cwd0);
  }

  // Real CLI: the unverifiable bundle drives a non-zero exit code (fail-closed).
  const r = spawnSync(process.execPath, [cli, "quickstart", "architecture-review", "--run", runId, "--repo", work, "--bundle", "--strict-signatures", "--json"], {
    cwd: work, encoding: "utf8", env: { ...process.env, CW_AGENT_ATTEST_PUBKEY: "" }
  });
  assert.equal(r.status, 1, `cw quickstart --bundle must exit 1 on an unverifiable bundle (stderr: ${r.stderr})`);
  assert.equal(JSON.parse(r.stdout).bundle.ok, false, "CLI payload reports bundle.ok=false");
}

// --- 5. CROSS-DIRECTORY anchoring (the headline correctness fix): invoked from a
//        caller cwd that is NOT the analyzed repo (the README headline shape), the
//        bundle still resolves the run from the run's OWN repo (no crash), and its
//        OUTPUT artifacts land in the CALLER's cwd — never polluting the repo. ---
{
  const repo = tmpWorkspace();
  const stub = writeStub(path.join(repo, "stub.js"), false);
  const keyDir = tmpWorkspace();
  const gen = spawnSync(process.execPath, [KEYGEN, "--out-dir", keyDir], { encoding: "utf8" });
  assert.equal(gen.status, 0, `keygen exits 0: ${gen.stderr}`);
  const pubPath = path.join(keyDir, "cw-attest.pub");
  const caller = tmpWorkspace(); // the operator's shell cwd, distinct from the repo

  process.chdir(caller);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const result = quickstart(runner, {
      appId: "architecture-review",
      repo, // analyzed repo != process.cwd()
      question: "What are the risks?",
      agentCommand: `${process.execPath} ${stub} {{result}}`,
      bundle: true,
      withTrustKey: pubPath,
      extractReport: "out.md"
    });
    assert.equal(result.status, "complete", "cross-directory drive completes");
    assert.ok(result.bundle, "a bundle is produced even though cwd != repo");
    // The run was resolved from its OWN repo (reportTarget), not the caller cwd — a
    // regression dropping that anchor would THROW File-not-found here.
    assert.equal(result.bundle.ok, true, "the cross-directory bundle self-verifies (run resolved from its repo)");
    // Output artifacts land in the CALLER's cwd, not the analyzed repo.
    assert.ok(result.bundle.archivePath.startsWith(caller), `archive lands in the caller cwd, got ${result.bundle.archivePath}`);
    assert.ok(result.bundle.reportExtractedTo && result.bundle.reportExtractedTo.startsWith(caller), "extracted report lands in the caller cwd");
    assert.ok(fs.existsSync(result.bundle.reportExtractedTo), "extracted report exists in the caller cwd");
    // The analyzed repo's working tree is NOT polluted by bundle/extract artifacts.
    const repoEntries = fs.readdirSync(repo);
    assert.ok(!repoEntries.some((e) => e.endsWith(".cwrun.json")), "no .cwrun.json written into the analyzed repo");
    assert.ok(!repoEntries.includes("out.md"), "extracted report did not pollute the analyzed repo");
  } finally {
    process.chdir(cwd0);
  }
}

for (const dir of cleanups) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.stdout.write("quickstart-bundle-smoke: ok\n");
