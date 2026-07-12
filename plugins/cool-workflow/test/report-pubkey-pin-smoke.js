#!/usr/bin/env node
// report-pubkey-pin-smoke: two fail-closed guarantees for the offline report
// bundle verify path (shell/run-export).
//
// #7 (P2): an explicit operator --pubkey/options.pubkey MUST win over a key the
// bundle embeds. A bundle carries its own public key so it verifies OFFLINE, but
// it must never OVERRIDE a key the operator pinned by hand — else an attacker who
// re-signs a bundle with their OWN key (and embeds that key) would verify green
// against their own key. When the operator pins a key AND the bundle embeds a
// DIFFERENT one, the verify FAILS CLOSED with a clear trust-key-mismatch.
//
// #16 (P3): importRun must validate run.paths.runDir and run.cwd are strings
// BEFORE it derefs them or writes any file. A truncated/malformed archive that is
// missing run.paths must fail closed as "Invalid run export" with NO half-restored
// run dir left on disk — not a raw TypeError or a silently mis-rebased run.
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/shell/run-store");
const { exportRun, importRun, verifyReportBundle } = require("../dist/shell/run-export");
const { appendTelemetryAttestation } = require("../dist/shell/telemetry-ledger-io");
const { signTelemetry } = require("../dist/core/trust/telemetry-attestation");

// Two DISTINCT ed25519 keypairs: one the operator trusts, one an attacker uses to
// re-sign a bundle and embed as if it were the real key.
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}
const operator = keypair();
const attacker = keypair();
assert.notEqual(operator.publicKeyPem, attacker.publicKeyPem, "the two keys must actually differ");

// Build a valid, self-contained bundle whose telemetry is signed by `signer.private`
// and which embeds `embedPublicKeyPem` as its trust key.
function buildBundle(label, signerPrivateKeyPem, embedPublicKeyPem) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cw-pin-${label}-`));
  const runId = `pin-${label}`;
  const runDir = path.join(tmp, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  const run = { id: runId, paths };
  const ctx = { runId, taskId: "map", promptDigest: "sha256:aaa" };
  const usage = { input_tokens: 120, output_tokens: 40 };
  appendTelemetryAttestation(run, {
    workerId: "w1",
    taskId: "map",
    promptDigest: "sha256:aaa",
    reportedUsage: usage,
    usageSignature: signTelemetry(usage, signerPrivateKeyPem, ctx),
    attestation: "attested",
    now: "2026-06-17T00:00:00.000Z"
  });
  fs.writeFileSync(path.join(runDir, "report.md"), `# Report for ${runId}\n`, "utf8");

  const fullRun = {
    schemaVersion: 1,
    id: runId,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    cwd: tmp,
    workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: { question: "what are the risks?" },
    loopStage: "interpret",
    phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: ["t1"] }],
    tasks: [{ id: "t1", kind: "analyze", phase: "analyze", status: "completed", requiresEvidence: false, prompt: "test", taskPath: path.join(paths.tasksDir, "t1.md"), resultPath: path.join(paths.resultsDir, "t1.md"), loopStage: "act" }],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: []
  };
  saveCheckpoint(fullRun);

  const archivePath = path.join(tmp, `${runId}.cwrun.json`);
  exportRun(fullRun, archivePath, { trustPublicKey: embedPublicKeyPem });
  return { tmp, runId, archivePath };
}

// --- #7a: attacker re-signs a bundle with their OWN key and embeds it. The operator
//          pins the REAL key with --pubkey. The pin MUST win and the mismatch MUST
//          fail closed — the bundle's own key must NOT be trusted. ---
{
  const { archivePath } = buildBundle("attacker", attacker.privateKeyPem, attacker.publicKeyPem);
  const v = verifyReportBundle(archivePath, { pubkey: operator.publicKeyPem });
  assert.equal(v.trustKeySource, "argument", "the explicit --pubkey pin wins over the bundle-embedded key");
  assert.ok(v.failedChecks.some((c) => c.code === "trust-key-mismatch"), "the key mismatch is surfaced as a failed check");
  assert.equal(v.ok, false, "a bundle re-signed with its own key does not verify green against a pinned key");
}

// --- #7b: the pinned key MATCHES the embedded key. The pin still wins (source is
//          honestly 'argument'), no mismatch, and the otherwise-valid bundle is ok. ---
{
  const { archivePath } = buildBundle("match", attacker.privateKeyPem, attacker.publicKeyPem);
  const v = verifyReportBundle(archivePath, { pubkey: attacker.publicKeyPem });
  assert.equal(v.trustKeySource, "argument", "an explicit pin is reported honestly, even when it equals the bundle key");
  assert.ok(!v.failedChecks.some((c) => c.code === "trust-key-mismatch"), "a matching pin raises no key-mismatch");
  assert.equal(v.signaturesFailed, 0, "the signature re-verifies against the matching key");
  assert.equal(v.ok, true, "a matching pin over an otherwise-valid bundle verifies ok");
}

// --- #7c: no pin, bundle-only key still resolves from the bundle (unchanged). ---
{
  const { archivePath } = buildBundle("bundleonly", attacker.privateKeyPem, attacker.publicKeyPem);
  const savedEnv = process.env.CW_AGENT_ATTEST_PUBKEY;
  delete process.env.CW_AGENT_ATTEST_PUBKEY;
  try {
    const v = verifyReportBundle(archivePath);
    assert.equal(v.trustKeySource, "bundle", "with no pin the bundle key still drives the verify");
    assert.equal(v.ok, true, "a self-contained bundle with no external pin verifies ok");
  } finally {
    if (savedEnv !== undefined) process.env.CW_AGENT_ATTEST_PUBKEY = savedEnv;
  }
}

// --- #16: importRun fails CLOSED on a malformed archive whose run.paths is absent
//          or whose runDir/cwd are not strings — before writing any file. ---
function writeArchive(runObject) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-import-shape-"));
  const archivePath = path.join(tmp, "malformed.cwrun.json");
  const archive = { schemaVersion: 1, exportedAt: "2026-06-17T00:00:00.000Z", sourceVersion: "test", run: runObject, files: [] };
  fs.writeFileSync(archivePath, JSON.stringify(archive), "utf8");
  return { tmp, archivePath };
}

// (a) run.paths missing entirely — current code derefs raw.run.paths.runDir => raw
//     TypeError. Fixed code fails closed as "Invalid run export".
{
  const { tmp, archivePath } = writeArchive({ id: "restore-nopaths", cwd: "/tmp/whatever", tasks: [], commits: [] });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cw-import-target-"));
  assert.throws(() => importRun(archivePath, target), /Invalid run export/, "a missing run.paths fails closed as an invalid archive");
  assert.equal(fs.existsSync(path.join(target, ".cw", "runs", "restore-nopaths")), false, "no half-restored run dir is left behind");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
}

// (b) run.paths present but runDir is not a string — current code silently
//     ensureRunDirs + writes files (half-restore) with a broken rebase. Fixed code
//     fails closed BEFORE touching disk.
{
  const { tmp, archivePath } = writeArchive({ id: "restore-badrundir", cwd: "/tmp/whatever", paths: { runDir: 123 }, tasks: [], commits: [] });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cw-import-target-"));
  assert.throws(() => importRun(archivePath, target), /Invalid run export/, "a non-string runDir fails closed as an invalid archive");
  assert.equal(fs.existsSync(path.join(target, ".cw", "runs", "restore-badrundir")), false, "no half-restored run dir is written before the shape check");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
}

// (c) run.cwd is not a string — same fail-closed contract.
{
  const { tmp, archivePath } = writeArchive({ id: "restore-badcwd", cwd: 5, paths: { runDir: "/tmp/x" }, tasks: [], commits: [] });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cw-import-target-"));
  assert.throws(() => importRun(archivePath, target), /Invalid run export/, "a non-string cwd fails closed as an invalid archive");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
}

process.stdout.write("report-pubkey-pin-smoke: ok\n");
