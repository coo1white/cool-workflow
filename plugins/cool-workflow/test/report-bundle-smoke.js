#!/usr/bin/env node
// report-bundle-smoke: `cw report bundle <run>` must PRODUCE-AND-PROVE — export a
// run to a portable bundle sealed with the operator's public key, then self-verify
// it offline the way a recipient will, and FAIL CLOSED if that artifact would not
// verify. This is the producer half of the "ship a report a client can verify
// themselves" guarantee (Track B): a solo operator must never hand off a bundle that
// silently isn't verifiable (e.g. no trust key configured under --strict-signatures).
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { appendTelemetryAttestation, computeRecordHash } = require("../dist/telemetry-ledger");
const { signTelemetry } = require("../dist/telemetry-attestation");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const HOPS = [
  { workerId: "w1", taskId: "map", promptDigest: "sha256:aaa", usage: { input_tokens: 120, output_tokens: 40 }, attestation: "attested" },
  { workerId: "w2", taskId: "verdict", promptDigest: "sha256:bbb", usage: { input_tokens: 200, output_tokens: 90 }, attestation: "attested" }
];

/** Persist a run (with a real signed telemetry ledger + report.md) under cwd so the
 *  CLI resolves it at <cwd>/.cw/runs/<id>/; returns the cwd. opts.noReport skips the
 *  report.md; opts.tamperLedger(records) edits the on-disk ledger BEFORE bundling. */
function persistRun(label, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cw-rb-${label}-`));
  const runId = `rb-${label}`;
  const runDir = path.join(tmp, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  const ledgerRun = { id: runId, paths };
  for (const hop of HOPS) {
    const ctx = { runId, taskId: hop.taskId, promptDigest: hop.promptDigest };
    appendTelemetryAttestation(ledgerRun, {
      workerId: hop.workerId,
      taskId: hop.taskId,
      promptDigest: hop.promptDigest,
      reportedUsage: hop.usage,
      usageSignature: signTelemetry(hop.usage, privateKeyPem, ctx),
      attestation: hop.attestation,
      now: "2026-06-17T00:00:00.000Z"
    });
  }
  if (opts.tamperLedger) {
    const ledgerPath = path.join(runDir, "telemetry.json");
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    opts.tamperLedger(ledger.records);
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  }
  if (!opts.noReport) {
    fs.writeFileSync(path.join(runDir, "report.md"), `# Report for ${runId}\n\nFinding: src/server.js:18 — cited evidence.\n`, "utf8");
  }

  saveCheckpoint({
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
  });
  return { tmp, runId };
}

function cliJson(cwd, args, extraEnv) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...extraEnv } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// --- 1. Produce-and-prove: sealed bundle is written AND self-verifies ---
{
  const { tmp, runId } = persistRun("seal");
  const keyFile = path.join(tmp, "pub.pem");
  fs.writeFileSync(keyFile, publicKeyPem, "utf8");
  const out = path.join(tmp, "report.cwrun.json");

  const r = cliJson(tmp, ["report", "bundle", runId, "--cwd", tmp, "--output", out, "--with-trust-key", keyFile, "--json"]);
  assert.equal(r.status, 0, "report bundle exits 0 when the produced bundle self-verifies");
  const result = JSON.parse(r.stdout);
  assert.equal(result.ok, true, "produce-and-prove ok");
  assert.equal(result.trustKeyEmbedded, true, "the public key was sealed into the bundle");
  assert.equal(result.archivePath, out, "reports the bundle path it wrote");
  assert.equal(result.verification.ok, true, "self-verification passed");
  assert.equal(result.verification.trustKeySource, "bundle", "self-verify used the bundle's own embedded key");
  assert.equal(result.verification.signaturesReverified, 2, "both attested hops re-verified during self-check");
  assert.ok(fs.existsSync(out), "bundle file written to disk");

  // The produced artifact is independently verifiable by a recipient — close the loop.
  const recipient = cliJson(tmp, ["report", "verify-bundle", out, "--json"]);
  assert.equal(recipient.status, 0, "an independent verify-bundle of the produced artifact passes");
  assert.equal(JSON.parse(recipient.stdout).ok, true, "recipient verify ok");
}

// --- 2. No trust key + --strict-signatures: fail closed (don't ship unverifiable) ---
{
  const { tmp, runId } = persistRun("nokey");
  const out = path.join(tmp, "report.cwrun.json");
  // Scrub the env fallback so "no key" really means no key.
  const r = cliJson(tmp, ["report", "bundle", runId, "--cwd", tmp, "--output", out, "--strict-signatures", "--json"], { CW_AGENT_ATTEST_PUBKEY: "" });
  assert.equal(r.status, 1, "report bundle fails closed (exit 1) when the artifact cannot be verified under --strict-signatures");
  const result = JSON.parse(r.stdout);
  assert.equal(result.ok, false, "strict produce-and-prove with no key is not ok");
  assert.equal(result.trustKeyEmbedded, false, "no key was embedded");
  // Pin WHY it failed: the strict-no-key guard, not some unrelated co-failure.
  assert.equal(result.verification.trustKeySource, "none", "no key resolved from bundle/flag/env");
  assert.equal(result.verification.signaturesChecked, 2, "both attested hops were seen (so the strict guard is the live reason)");
  assert.ok(
    result.verification.failedChecks.some((c) => c.name === "signatures" && c.code === "signature-key-required"),
    "the recorded failure is the strict-signatures key-required guard"
  );
  // The bundle was still written (the run exported); it just isn't shippable yet.
  assert.ok(fs.existsSync(out), "the archive is still produced for inspection");
}

// --- 2b. SUBSTANTIVE forgery self-verify failure flows through the verb (not just
//         the strict shortfall): tamper the on-disk telemetry ledger BEFORE bundling
//         so the produced bundle's chain is broken, and prove report bundle returns
//         ok:false / telemetryVerified:false and the CLI exits 1. This is the verb's
//         entire reason to exist — produce AND prove. ---
{
  const { tmp, runId } = persistRun("forged", {
    tamperLedger: (records) => {
      // Edit hop 0's reported usage and reseal ITS recordHash; hop 1's prevHash now
      // points at a stale hash, so the chain breaks — a forgery the chain layer
      // catches even though the archive file digests (computed at export) are valid.
      records[0].reportedUsage = { ...records[0].reportedUsage, output_tokens: 99999 };
      const { recordHash: _drop, ...rest } = records[0];
      records[0].recordHash = computeRecordHash(rest);
    }
  });
  const keyFile = path.join(tmp, "pub.pem");
  fs.writeFileSync(keyFile, publicKeyPem, "utf8");
  const out = path.join(tmp, "report.cwrun.json");
  const r = cliJson(tmp, ["report", "bundle", runId, "--cwd", tmp, "--output", out, "--with-trust-key", keyFile, "--json"]);
  assert.equal(r.status, 1, "report bundle exits 1 when the produced bundle's chain does not verify");
  const result = JSON.parse(r.stdout);
  assert.equal(result.ok, false, "a substantive self-verify failure makes produce-and-prove not ok");
  assert.equal(result.verification.telemetryVerified, false, "the broken telemetry chain is detected during self-verify");
}

// --- 2c. extract-report requested but the run has NO report.md: fail closed, do not
//         green a "shippable pair" that has no report (regression guard for the
//         silent-no-op bug). ---
{
  const { tmp, runId } = persistRun("noreport", { noReport: true });
  const keyFile = path.join(tmp, "pub.pem");
  fs.writeFileSync(keyFile, publicKeyPem, "utf8");
  const out = path.join(tmp, "report.cwrun.json");
  const human = path.join(tmp, "missing-report.md");
  const r = cliJson(tmp, ["report", "bundle", runId, "--cwd", tmp, "--output", out, "--with-trust-key", keyFile, "--extract-report", human, "--json"]);
  assert.equal(r.status, 1, "report bundle exits 1 when --extract-report cannot be fulfilled");
  const result = JSON.parse(r.stdout);
  assert.equal(result.ok, false, "no report.md to extract => not ok (no silent green)");
  assert.ok(
    result.verification.failedChecks.some((c) => c.name === "extract-report"),
    "the unfulfilled extraction is recorded as a failed check"
  );
  assert.equal(fs.existsSync(human), false, "no stale/empty report file is left behind");
}

// --- 2d. Env-key seal path: CW_AGENT_ATTEST_PUBKEY set, no --with-trust-key flag,
//         seals the bundle AND self-verifies via the embedded key. ---
{
  const { tmp, runId } = persistRun("envkey");
  const out = path.join(tmp, "report.cwrun.json");
  const r = cliJson(tmp, ["report", "bundle", runId, "--cwd", tmp, "--output", out, "--json"], { CW_AGENT_ATTEST_PUBKEY: publicKeyPem });
  assert.equal(r.status, 0, "env-key seal-and-verify exits 0");
  const result = JSON.parse(r.stdout);
  assert.equal(result.trustKeyEmbedded, true, "the env public key was sealed into the bundle");
  assert.equal(result.verification.trustKeySource, "bundle", "self-verify used the embedded (env-sourced) key, not the env directly");
  assert.equal(result.ok, true, "env-sealed bundle is ok");
}

// --- 3. --extract-report writes the human-readable companion alongside the bundle ---
{
  const { tmp, runId } = persistRun("extract");
  const keyFile = path.join(tmp, "pub.pem");
  fs.writeFileSync(keyFile, publicKeyPem, "utf8");
  const out = path.join(tmp, "report.cwrun.json");
  const human = path.join(tmp, "report.md");
  const r = cliJson(tmp, ["report", "bundle", runId, "--cwd", tmp, "--output", out, "--with-trust-key", keyFile, "--extract-report", human, "--json"]);
  assert.equal(r.status, 0, "produce-and-prove with extraction exits 0");
  const result = JSON.parse(r.stdout);
  assert.equal(result.reportExtractedTo, human, "reports where it wrote the human report");
  assert.ok(fs.existsSync(human), "human-readable report.md written next to the bundle");
  assert.match(fs.readFileSync(human, "utf8"), /src\/server\.js:18/, "companion report carries the cited evidence");
}

process.stdout.write("report-bundle-smoke: ok\n");
