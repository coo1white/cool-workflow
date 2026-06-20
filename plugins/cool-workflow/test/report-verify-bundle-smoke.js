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
  // These hops sign USAGE only (no resultDigest), so they do not attest findings —
  // trustLevel "signed" requires a result-covering signature.
  assert.equal(v.trustLevel, "unsigned", "usage-only signatures do not make trustLevel signed");
  assert.equal(v.reportFindingsVerified, true, "no result-bound signature to cross-check ⇒ vacuously holds");
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
    assert.equal(lax.trustLevel, "unsigned", "no signature actually re-verified ⇒ trustLevel unsigned (even though attested hops were 'checked')");

    const strict = verifyReportBundle(archivePath, { strictSignatures: true });
    assert.equal(strict.ok, false, "--strict-signatures refuses a bundle whose attested telemetry cannot be re-verified");

    // --require-signatures closes the prior fail-open: an unsigned (no re-verified
    // signature) bundle, however intact, is refused.
    const required = verifyReportBundle(archivePath, { requireSignatures: true });
    assert.equal(required.ok, false, "--require-signatures refuses an unsigned bundle (closes the fail-open)");
    assert.ok(required.failedChecks.some((c) => c.code === "signatures-required"), "the unsigned refusal is surfaced");
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

// --- 8. REPORT ⇄ RESULT ⇄ SIGNATURE cross-check: findings can't be altered ---
// Three links: (1) the signature covers the result digest; (2) the restored result
// must HASH to that signed digest; (3) report.md embeds the result at the task's own
// section. Editing the report breaks (3); editing the result breaks (2); editing
// BOTH to one consistent lie still breaks (2) — the signed digest does not move.
{
  const { sha256 } = require("../dist/execution-backend");
  const REAL = "## Findings\n\n- src/server.js:18 — missing auth check (real).";
  // `written` is what lands in result.md + report.md; `signed` is what the
  // executor's signature covers (an attacker makes these differ).
  function buildWithResult(label, opts = {}) {
    const written = opts.written !== undefined ? opts.written : REAL;
    const signed = opts.signed !== undefined ? opts.signed : written;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cw-xcheck-${label}-`));
    const runId = `xcheck-${label}`;
    const runDir = path.join(tmp, ".cw", "runs", runId);
    const paths = createRunPaths(runDir);
    ensureRunDirs(paths);
    const resultPath = path.join(paths.resultsDir, "t1.md");
    fs.writeFileSync(resultPath, `${written}\n`, "utf8");
    const resultDigest = sha256(`${signed}\n`); // the signature covers the SIGNED bytes
    const usage = { input_tokens: 10, output_tokens: 5 };
    const usageSignature = signTelemetry(usage, privateKeyPem, { runId, taskId: "t1", promptDigest: "sha256:ddd", resultDigest });
    appendTelemetryAttestation({ id: runId, paths }, {
      workerId: "w1", taskId: "t1", promptDigest: "sha256:ddd", reportedUsage: usage,
      usageSignature, resultDigest, attestation: "attested", now: "2026-06-17T00:00:00.000Z"
    });
    let reportMd = `# Report for ${runId}\n\n### t1\n\nResult: ${resultPath}\n\n${written.trim()}\n`;
    if (opts.mutateReportMd) reportMd = opts.mutateReportMd(reportMd, written.trim());
    fs.writeFileSync(path.join(runDir, "report.md"), reportMd, "utf8");
    const fullRun = {
      schemaVersion: 1, id: runId, createdAt: "2026-06-17T00:00:00.000Z", updatedAt: "2026-06-17T00:00:00.000Z",
      cwd: tmp, workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
      inputs: { question: "what are the risks?" }, loopStage: "interpret",
      phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: ["t1"] }],
      tasks: [{ id: "t1", kind: "analyze", phase: "analyze", status: "completed", requiresEvidence: false, prompt: "test", taskPath: path.join(paths.tasksDir, "t1.md"), resultPath, loopStage: "act" }],
      dispatches: [], commits: [], paths, nodes: [], contracts: []
    };
    if (opts.dropTask) fullRun.tasks = []; // drop the task from the un-signed task list (attack)
    saveCheckpoint(fullRun);
    const archivePath = path.join(tmp, `${runId}.cwrun.json`);
    exportRun(fullRun, archivePath, { trustPublicKey: publicKeyPem });
    return archivePath;
  }

  // Clean: all three links hold.
  const vc = verifyReportBundle(buildWithResult("clean"));
  assert.equal(vc.signaturesReverified, 1, "the result-bound signature re-verified");
  assert.equal(vc.signaturesFailed, 0, "no signature failed on the clean bundle");
  assert.equal(vc.reportFindingsVerified, true, "report ⇄ result ⇄ signature all bind");
  assert.equal(vc.trustLevel, "signed", "trustLevel signed");
  assert.equal(vc.failedChecks.length, 0, "clean signed bundle has no failed checks");
  assert.equal(vc.ok, true, "clean result-bound bundle verifies");
  assert.equal(verifyReportBundle(buildWithResult("clean-req"), { requireSignatures: true }).ok, true,
    "--require-signatures leaves a SIGNED bundle ok");

  // Report-only edit: link 3 fails.
  const vr = verifyReportBundle(buildWithResult("report-edit", {
    mutateReportMd: (md) => md.replace("missing auth check (real)", "all clear (fabricated)")
  }));
  assert.equal(vr.reportFindingsVerified, false, "editing report.md's findings is detected");
  assert.ok(vr.failedChecks.some((c) => c.code === "report-result-mismatch:t1"), "report-result-mismatch:t1 surfaced");
  assert.equal(vr.ok, false, "report edit fails closed");

  // CONSISTENT edit (the bypass the review caught): result.md AND report.md both show
  // a lie, but the signature still covers the ORIGINAL digest. Link 2 catches it.
  const va = verifyReportBundle(buildWithResult("consistent", { written: "## Findings\n\n- all clear (fabricated).", signed: REAL }));
  assert.equal(va.signaturesFailed, 0, "the signature still verifies (it covers the original, untouched digest)");
  assert.equal(va.reportFindingsVerified, false, "the restored result no longer hashes to the signed digest");
  assert.ok(va.failedChecks.some((c) => c.code === "result-digest-mismatch:t1"), "result-digest-mismatch:t1 surfaced");
  assert.equal(va.ok, false, "a consistently-edited result+report fails closed");
  assert.equal(verifyReportBundle(buildWithResult("consistent-req", { written: "## x", signed: REAL }), { requireSignatures: true }).ok, false,
    "even under --require-signatures the consistent edit fails");

  // Buried decoy: report shows a lie but appends the original result in a comment —
  // a whole-file substring check would pass; the per-section anchor does not.
  const vb = verifyReportBundle(buildWithResult("buried", {
    mutateReportMd: (md, body) => md.replace(body, "- all clear (fabricated).") + `\n<!-- ${body} -->\n`
  }));
  assert.equal(vb.reportFindingsVerified, false, "a buried decoy copy does not satisfy the section anchor");
  assert.equal(vb.ok, false, "buried-decoy report fails closed");

  // Empty result for a SIGNED task: must fail, not silently skip.
  const ve = verifyReportBundle(buildWithResult("empty", { written: "", signed: REAL }));
  assert.equal(ve.reportFindingsVerified, false, "a signed task with an empty result is not skipped");
  assert.ok(ve.failedChecks.some((c) => c.code === "result-digest-mismatch:t1"), "the empty/mismatched result is caught");
  assert.equal(ve.ok, false, "empty signed result fails closed");

  // DROPPED TASK (the review-caught architecture bypass): the cross-check is driven
  // by the SIGNED ledger records, not the attacker-controlled run.tasks. Dropping the
  // task from run.tasks (while editing result+report to a lie) must NOT silence it.
  const vd = verifyReportBundle(buildWithResult("dropped", { written: "## Findings\n\n- all clear (fabricated).", signed: REAL, dropTask: true }), { requireSignatures: true });
  assert.equal(vd.signaturesFailed, 0, "the signature still verifies (the signed digest is untouched)");
  assert.equal(vd.signaturesReverified, 1, "the result-covering signature still re-verified");
  assert.equal(vd.reportFindingsVerified, false, "a dropped signed task cannot silence the cross-check");
  assert.equal(vd.trustLevel, "unsigned", "an unmet signed obligation drops trustLevel to unsigned");
  assert.ok(vd.failedChecks.some((c) => c.code === "result-missing:t1"), "the dropped task's signed result obligation is unmet");
  assert.equal(vd.ok, false, "dropping the task fails closed even under --require-signatures");

  // SECTION-ANCHOR false positive: a legit signed result whose body contains a
  // `### <id>` heading must still verify (the anchor walks to the real section).
  const vfp = verifyReportBundle(buildWithResult("section-fp", { written: "## Findings\n\n### t1 details\n\n- nested heading; the body itself contains '### t1'." }));
  assert.equal(vfp.reportFindingsVerified, true, "a result body containing a `###` heading does not false-fail");
  assert.equal(vfp.trustLevel, "signed", "the result-covering signature makes it signed");
  assert.equal(vfp.ok, true, "a legit signed bundle with `###` in the result verifies");
}

// --- 9. Section-anchor across TWO tasks: an earlier result containing the LATER
//        task's heading must not mis-anchor the later task's check (false positive). ---
{
  const { sha256 } = require("../dist/execution-backend");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-xcheck-2task-"));
  const runId = "xcheck-2task";
  const runDir = path.join(tmp, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);
  // t1's result body literally contains "### t2" (a heading), BEFORE t2's real section.
  const r1 = "## t1 findings\n\n### t2\n\n- see the t2 section (this is inside t1's result).";
  const r2 = "## t2 findings\n\n- src/auth.js:9 — the real t2 finding.";
  const p1 = path.join(paths.resultsDir, "t1.md");
  const p2 = path.join(paths.resultsDir, "t2.md");
  fs.writeFileSync(p1, `${r1}\n`, "utf8");
  fs.writeFileSync(p2, `${r2}\n`, "utf8");
  const usage = { input_tokens: 5, output_tokens: 2 };
  for (const [tid, p, body] of [["t1", p1, r1], ["t2", p2, r2]]) {
    const resultDigest = sha256(fs.readFileSync(p, "utf8"));
    const usageSignature = signTelemetry(usage, privateKeyPem, { runId, taskId: tid, promptDigest: `sha256:${tid}`, resultDigest });
    appendTelemetryAttestation({ id: runId, paths }, { workerId: tid, taskId: tid, promptDigest: `sha256:${tid}`, reportedUsage: usage, usageSignature, resultDigest, attestation: "attested", now: "2026-06-17T00:00:00.000Z" });
  }
  // report.md renders both sections; t1's section body contains "### t2".
  const reportMd = `# Report for ${runId}\n\n### t1\n\nResult: ${p1}\n\n${r1.trim()}\n\n### t2\n\nResult: ${p2}\n\n${r2.trim()}\n`;
  fs.writeFileSync(path.join(runDir, "report.md"), reportMd, "utf8");
  const fullRun = {
    schemaVersion: 1, id: runId, createdAt: "2026-06-17T00:00:00.000Z", updatedAt: "2026-06-17T00:00:00.000Z", cwd: tmp,
    workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } }, inputs: { question: "risks?" }, loopStage: "interpret",
    phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: ["t1", "t2"] }],
    tasks: [
      { id: "t1", kind: "analyze", phase: "analyze", status: "completed", requiresEvidence: false, prompt: "x", taskPath: path.join(paths.tasksDir, "t1.md"), resultPath: p1, loopStage: "act" },
      { id: "t2", kind: "analyze", phase: "analyze", status: "completed", requiresEvidence: false, prompt: "x", taskPath: path.join(paths.tasksDir, "t2.md"), resultPath: p2, loopStage: "act" }
    ],
    dispatches: [], commits: [], paths, nodes: [], contracts: []
  };
  saveCheckpoint(fullRun);
  const archivePath = path.join(tmp, `${runId}.cwrun.json`);
  exportRun(fullRun, archivePath, { trustPublicKey: publicKeyPem });
  const v2 = verifyReportBundle(archivePath);
  assert.equal(v2.reportFindingsVerified, true, "t1's body containing '### t2' does not mis-anchor t2's section");
  assert.equal(v2.signaturesReverified, 2, "both result-covering signatures re-verified");
  assert.equal(v2.ok, true, "a legit 2-task bundle with a cross-referencing heading verifies");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// NOTE: the verify-bundle guarantee is the FORWARD one — every SIGNED finding is
// present in the report and unaltered. It does NOT assert the report contains ONLY
// signed findings: CW holds no key to sign the rendered report, and the ledger chain
// is self-recomputable, so a determined re-chainer can omit a signed finding or add
// unsigned prose/sections (the documented limit — see report-verifiable-bundle.7.md).
// trustLevel "signed" attests the signed findings, not report exhaustiveness.

process.stdout.write("report-verify-bundle-smoke: ok\n");
