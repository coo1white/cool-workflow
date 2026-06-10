#!/usr/bin/env node
"use strict";

// telemetry-ledger-smoke (Track 1) — the RECORDED attestation is tamper-evident.
//
// The signature (telemetry-attestation) proves the agent SAID a usage; this
// ledger proves CW RECORDED exactly that and nobody edited it after the fact.
// Proves:
//   A. UNIT chain integrity:
//     1. appended records chain (r1.prevHash = genesis; r2.prevHash = r1.recordHash);
//     2. a clean chain verifies (present + verified) with correct tallies;
//     3. tampering a recorded VERDICT without recomputing ⇒ digest-mismatch caught;
//     4. tampering a NON-TERMINAL record AND recomputing its hash ⇒ the successor's
//        chain link breaks anyway (the strong append-only property);
//   B. END-TO-END:
//     5. a signed drive populates the ledger (one record per agent hop), the chain
//        verifies, and each audit event cross-links the matching recordHash (the
//        anchor that also pins the terminal record);
//     6. the report shows "chain verified"; after on-disk tampering it shows the
//        LOUD "ATTESTATION LEDGER CHAIN BROKEN".

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const ledger = require(path.join(pluginRoot, "dist/telemetry-ledger.js"));
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const { writeReport } = require(path.join(pluginRoot, "dist/orchestrator/report.js"));
const { listTrustAuditEvents } = require(path.join(pluginRoot, "dist/trust-audit.js"));

const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-tel-ledger-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_AGENT_ATTEST_PUBKEY"]) delete process.env[v];
}
function ed25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}
function writeSigningStub(file, privPath) {
  const taPath = JSON.stringify(path.join(pluginRoot, "dist/telemetry-attestation.js"));
  const lines = [
    'const fs = require("fs");',
    'const crypto = require("crypto");',
    `const ta = require(${taPath});`,
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2], mp = process.argv[3], ip = process.argv[4];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'const m = JSON.parse(fs.readFileSync(mp, "utf8"));',
    'const sha = (s) => "sha256:" + crypto.createHash("sha256").update(s, "utf8").digest("hex");',
    'const pd = fs.existsSync(ip) ? sha(fs.readFileSync(ip, "utf8")) : sha(m.prompt || "");',
    "const usage = { input_tokens: 4, output_tokens: 2 };",
    `const sig = ta.signTelemetry(usage, fs.readFileSync(${JSON.stringify(privPath)}, "utf8"), { runId: m.runId, taskId: m.taskId, promptDigest: pd });`,
    'process.stdout.write(JSON.stringify({ model: "attested-opus", usage, usageSignature: sig }));'
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function main() {
  clearAgentEnv();

  // ---- A. UNIT chain integrity --------------------------------------------
  const work = tmpWorkspace();
  const run = { id: "run-x", paths: { runDir: path.join(work, "runX") } };
  fs.mkdirSync(run.paths.runDir, { recursive: true });

  const r1 = ledger.appendTelemetryAttestation(run, {
    workerId: "w1", taskId: "t1", promptDigest: "sha256:p1",
    reportedUsage: { input_tokens: 4, output_tokens: 2 }, usageSignature: "sig1",
    attestation: "attested", now: "2026-06-10T00:00:00.000Z"
  });
  const r2 = ledger.appendTelemetryAttestation(run, {
    workerId: "w2", taskId: "t2", promptDigest: "sha256:p2",
    reportedUsage: { input_tokens: 1 }, attestation: "unattested", attestationReason: "no signature",
    now: "2026-06-10T00:00:01.000Z"
  });

  // 1. chain linkage
  assert.equal(r1.prevHash, ledger.genesisPrevHash("run-x"), "first record chains to genesis");
  assert.equal(r2.prevHash, r1.recordHash, "second record chains to the first");

  // 2. a clean chain verifies
  let v = ledger.verifyTelemetryLedger(run);
  assert.ok(v.present && v.verified, "clean chain verifies");
  assert.equal(v.records.length, 2);
  assert.deepEqual({ a: v.attested, u: v.unattested, x: v.absent }, { a: 1, u: 1, x: 0 }, "tallies correct");

  const file = ledger.telemetryLedgerPath(run);

  // 3. tamper a recorded VERDICT without recomputing ⇒ digest-mismatch
  let raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.records[1].attestation = "attested"; // forge a pass
  fs.writeFileSync(file, JSON.stringify(raw), "utf8");
  v = ledger.verifyTelemetryLedger(run);
  assert.ok(!v.verified, "forged verdict (no recompute) is detected");
  assert.ok(v.checks.some((c) => !c.pass && c.code === "telemetry-digest-mismatch"), "digest-mismatch reported");

  // 4. tamper a NON-TERMINAL record AND recompute its hash ⇒ successor link breaks
  raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.records[1].attestation = "unattested"; // restore the terminal record
  raw.records[1].recordHash = ledger.computeRecordHash({ ...raw.records[1], recordHash: undefined });
  // now tamper r0 (non-terminal) and recompute ITS hash to fool the digest check
  raw.records[0].reportedUsageDigest = "sha256:forged";
  raw.records[0].recordHash = ledger.computeRecordHash({ ...raw.records[0], recordHash: undefined });
  fs.writeFileSync(file, JSON.stringify(raw), "utf8");
  v = ledger.verifyTelemetryLedger(run);
  assert.ok(!v.verified, "non-terminal tamper detected even with recomputed hash");
  assert.ok(v.checks.some((c) => !c.pass && c.code === "telemetry-chain-broken"), "chain-link break reported (successor anchors the edit)");

  // ---- B. END-TO-END: signed drive populates a verifiable ledger -----------
  const { publicPem, privatePem } = ed25519();
  const cwd0 = process.cwd();
  const workE = tmpWorkspace();
  const privPath = path.join(workE, "priv.pem");
  fs.writeFileSync(privPath, privatePem, "utf8");
  const stub = writeSigningStub(path.join(workE, "stub.js"), privPath);
  process.chdir(workE);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const planned = runner.plan("architecture-review", { repo: workE, question: "Sound?" });
    const result = drive(runner, planned.id, {
      now: "2026-06-10T00:00:00.000Z",
      agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}", "{{manifest}}", "{{input}}"], model: "op", attestPublicKey: publicPem, source: "flag" }
    });
    assert.equal(result.status, "complete", "signed drive completes");
    const final = runner.loadRun(planned.id);

    // 5. ledger populated, verified, and audit events cross-link the record hashes
    const lv = ledger.verifyTelemetryLedger(final);
    assert.ok(lv.present && lv.verified, "drive produced a verifiable ledger");
    const delegationEvents = listTrustAuditEvents(final).filter((e) => e.kind === "worker.agent-delegation");
    assert.ok(delegationEvents.length >= 1, "agent-delegation events recorded");
    assert.equal(lv.records.length, delegationEvents.length, "one ledger record per agent hop");
    assert.ok(lv.attested === lv.records.length, "all signed hops attested in the ledger");
    const ledgerHashes = new Set(lv.records.map((r) => r.recordHash));
    assert.ok(
      delegationEvents.every((e) => ledgerHashes.has(e.metadata.telemetryRecordHash)),
      "every audit event cross-links a real ledger recordHash (anchor)"
    );

    // 6. report shows chain verified; after on-disk tamper it shows BROKEN
    let md = fs.readFileSync(writeReport(final), "utf8");
    assert.match(md, /Attestation ledger: \d+ records, chain verified/, "report shows verified chain");

    const lfile = ledger.telemetryLedgerPath(final);
    const tampered = JSON.parse(fs.readFileSync(lfile, "utf8"));
    tampered.records[0].reportedUsageDigest = "sha256:forged"; // edit a recorded usage
    fs.writeFileSync(lfile, JSON.stringify(tampered), "utf8");
    md = fs.readFileSync(writeReport(final), "utf8");
    assert.match(md, /ATTESTATION LEDGER CHAIN BROKEN/, "report surfaces a broken chain LOUDLY");
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
  console.log("telemetry-ledger-smoke: ok (chain integrity, tamper-evident verdicts, end-to-end ledger + loud broken-chain report)");
}

main();
