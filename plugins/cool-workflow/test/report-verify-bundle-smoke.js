#!/usr/bin/env node
// report-verify-bundle-smoke: a portable run bundle must be verifiable OFFLINE and
// SELF-CONTAINED — `cw report verify-bundle <file>` proves the archive bytes, the
// telemetry hash chain, the trust-audit chain, and (with the bundle's EMBEDDED public
// key) the ed25519 signatures, WITHOUT a source repo, a pre-existing .cw tree, or an
// out-of-band key. It must FAIL CLOSED (ok:false / exit 1) on any forgery — including
// a telemetry chain forged so cleverly the archive's own file digests still match,
// which inspect-archive alone would wave through. This is the "ship a report a client
// can verify themselves" guarantee (Track B), so it cannot ever green a lie.
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { exportRun, verifyReportBundle } = require("../dist/run-export");
const { appendTelemetryAttestation, computeRecordHash, reportedUsageDigest } = require("../dist/telemetry-ledger");
const { signTelemetry } = require("../dist/telemetry-attestation");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

// One ed25519 keypair stands in for the operator's attestation key across all bundles.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

// HOPS: two attested (signed) + one unattested. The LAST hop is attested so a
// signature-only tamper can break it WITHOUT disturbing the hash chain.
const HOPS = [
  { workerId: "w1", taskId: "map", promptDigest: "sha256:aaa", usage: { input_tokens: 120, output_tokens: 40 }, attestation: "attested" },
  { workerId: "w2", taskId: "assess", promptDigest: "sha256:bbb", usage: { input_tokens: 80 }, attestation: "unattested" },
  { workerId: "w3", taskId: "verdict", promptDigest: "sha256:ccc", usage: { input_tokens: 200, output_tokens: 90 }, attestation: "attested" }
];

/** Build a run dir with a REAL signed telemetry ledger + a report.md, optionally
 *  apply an on-disk telemetry tamper BEFORE export (so the export computes a VALID
 *  file digest over the tampered bytes — exactly the archive-digest-clean / chain-or-
 *  signature-broken forgery the inner layers must still catch), then export. */
function buildBundle(label, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cw-bundle-${label}-`));
  const runId = `bundle-${label}`;
  const runDir = path.join(tmp, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  const run = { id: runId, paths };
  for (const hop of HOPS) {
    const ctx = { runId, taskId: hop.taskId, promptDigest: hop.promptDigest };
    const usageSignature = hop.attestation === "attested" ? signTelemetry(hop.usage, privateKeyPem, ctx) : undefined;
    appendTelemetryAttestation(run, {
      workerId: hop.workerId,
      taskId: hop.taskId,
      promptDigest: hop.promptDigest,
      reportedUsage: hop.usage,
      usageSignature,
      attestation: hop.attestation,
      now: "2026-06-17T00:00:00.000Z"
    });
  }

  fs.writeFileSync(path.join(runDir, "report.md"), `# Report for ${runId}\n\nFinding: src/server.js:18 — example cited evidence.\n`, "utf8");

  if (opts.tamper) {
    const ledgerPath = path.join(runDir, "telemetry.json");
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    opts.tamper(ledger.records);
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  }

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
  const exported = exportRun(fullRun, archivePath, opts.exportOptions || { trustPublicKey: publicKeyPem });
  return { tmp, runId, archivePath, exported, publicKeyPem };
}

// Recompute a record's recordHash after editing it in place (drops the stored hash
// first — computeRecordHash hashes the record WITHOUT recordHash).
function reseal(record) {
  const { recordHash: _drop, ...rest } = record;
  record.recordHash = computeRecordHash(rest);
}

// --- 1. CLEAN bundle verifies, with the embedded key doing REAL ed25519 reverify ---
{
  const { archivePath } = buildBundle("clean");
  const v = verifyReportBundle(archivePath);
  assert.equal(v.ok, true, "clean bundle verifies ok");
  assert.equal(v.archiveOk, true, "archive bytes intact");
  assert.equal(v.telemetryVerified, true, "telemetry chain verifies");
  assert.equal(v.trustAuditVerified, true, "trust-audit chain verifies (absent => nothing to prove)");
  assert.equal(v.trustKeySource, "bundle", "key came from the bundle itself, not the environment");
  assert.equal(v.signatureKeyProvided, true, "embedded key drives signature reverify");
  assert.equal(v.signaturesChecked, 2, "both attested hops examined");
  assert.equal(v.signaturesReverified, 2, "both attested signatures re-verified against the embedded key");
  assert.equal(v.signaturesFailed, 0, "no signature failed");
}

// --- 2. TELEMETRY CHAIN forgery (archive digests still match) is caught ---
// Flip the middle hop's attestation and reseal ITS recordHash; the next record's
// prevHash now points at a stale hash, so the chain breaks — even though every
// archive file digest is valid (we tamper BEFORE export).
{
  const { archivePath } = buildBundle("chain", {
    tamper: (records) => {
      records[1].attestation = "attested";
      reseal(records[1]);
    }
  });
  const v = verifyReportBundle(archivePath);
  assert.equal(v.archiveOk, true, "chain-forged bundle still passes the archive-digest layer (forgery is internally consistent)");
  assert.equal(v.telemetryVerified, false, "the telemetry hash chain catches the forgery inspect-archive cannot");
  assert.equal(v.ok, false, "chain forgery fails the whole bundle");
}

// --- 3. SIGNATURE forgery on the last (attested) hop is caught (chain stays valid) ---
// Inflate the reported usage and reseal both its usage digest and recordHash so the
// chain + archive digests still verify; only the ed25519 signature (over the ORIGINAL
// usage) no longer matches.
{
  const { archivePath } = buildBundle("sig", {
    tamper: (records) => {
      const last = records[records.length - 1];
      last.reportedUsage = { ...last.reportedUsage, output_tokens: last.reportedUsage.output_tokens * 10 };
      last.reportedUsageDigest = reportedUsageDigest(last.reportedUsage);
      reseal(last);
    }
  });
  const v = verifyReportBundle(archivePath);
  assert.equal(v.telemetryVerified, true, "chain + usage digest still verify (tamper was resealed)");
  assert.equal(v.signaturesFailed >= 1, true, "the ed25519 reverify catches the inflated usage");
  assert.equal(v.ok, false, "signature forgery fails the whole bundle");
}

// --- 4. NO embedded key: attested hops degrade (default) vs --strict-signatures ---
{
  const { archivePath } = buildBundle("nokey", { exportOptions: {} });
  // Ensure the env fallback can't sneak a key in for this case.
  const savedEnv = process.env.CW_AGENT_ATTEST_PUBKEY;
  delete process.env.CW_AGENT_ATTEST_PUBKEY;
  try {
    const lax = verifyReportBundle(archivePath);
    assert.equal(lax.signatureKeyProvided, false, "no key available => signatures unchecked");
    assert.equal(lax.signaturesFailed, 0, "default degrades attested hops to informational, not failed");
    assert.equal(lax.telemetryVerified, true, "chain still verifies without a key");
    assert.equal(lax.ok, true, "default: an unverifiable-but-intact bundle is ok");

    const strict = verifyReportBundle(archivePath, { strictSignatures: true });
    assert.equal(strict.ok, false, "--strict-signatures refuses a bundle whose attested telemetry cannot be re-verified");
  } finally {
    if (savedEnv !== undefined) process.env.CW_AGENT_ATTEST_PUBKEY = savedEnv;
  }
}

// --- 5. report.md extraction ---
{
  const { archivePath, tmp } = buildBundle("extract");
  const out = path.join(tmp, "extracted-report.md");
  const v = verifyReportBundle(archivePath, { extractReportTo: out });
  assert.equal(v.ok, true, "bundle verifies");
  assert.equal(v.reportExtractedTo, out, "reports where it wrote the report");
  assert.ok(fs.existsSync(out), "report.md extracted to disk");
  assert.match(fs.readFileSync(out, "utf8"), /src\/server\.js:18/, "extracted report carries the cited evidence");
}

// --- 6. REAL CLI surface: clean exits 0, forged exits 1 (fail-closed exit code) ---
{
  const { archivePath } = buildBundle("cli-clean");
  const ok = JSON.parse(execFileSync(process.execPath, [cli, "report", "verify-bundle", archivePath, "--json"], { cwd: pluginRoot, encoding: "utf8" }));
  assert.equal(ok.ok, true, "CLI clean bundle reports ok");

  const { archivePath: forged } = buildBundle("cli-forged", {
    tamper: (records) => {
      records[1].attestation = "attested";
      reseal(records[1]);
    }
  });
  const forgedRun = spawnSync(process.execPath, [cli, "report", "verify-bundle", forged, "--json"], { cwd: pluginRoot, encoding: "utf8" });
  assert.equal(forgedRun.status, 1, "CLI fails closed (exit 1) on a forged bundle");
  assert.equal(JSON.parse(forgedRun.stdout).ok, false, "CLI forged bundle reports ok:false");
}

// --- 7. export with --with-trust-key <key-file> embeds the key (a raw inline PEM
//        starts with "-----" and would parse as a flag, so the CLI form is a path;
//        inline PEM is supported programmatically and via CW_AGENT_ATTEST_PUBKEY) ---
{
  const { tmp, runId } = buildBundle("cli-export");
  const keyFile = path.join(tmp, "pub.pem");
  fs.writeFileSync(keyFile, publicKeyPem, "utf8");
  const out = path.join(tmp, "sealed.cwrun.json");
  const exported = JSON.parse(execFileSync(process.execPath, [cli, "run", "export", runId, "--cwd", tmp, "--output", out, "--with-trust-key", keyFile], { cwd: pluginRoot, encoding: "utf8" }));
  assert.equal(exported.trustKeyEmbedded, true, "run export --with-trust-key <file> embeds the public key");
  const archive = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.ok(archive.trust && archive.trust.publicKeyPem.includes("BEGIN PUBLIC KEY"), "archive carries the embedded PEM");
  assert.equal(archive.trust.algorithm, "ed25519", "embedded trust key declares its algorithm");
  const v = verifyReportBundle(out);
  assert.equal(v.ok, true, "the CLI-sealed bundle verifies offline with its embedded key");
}

process.stdout.write("report-verify-bundle-smoke: ok\n");
