#!/usr/bin/env node
"use strict";

// @cw-smoke: tags slow
// telemetry-attestation-smoke (Track 1) — make "auditable" a FACT, not a claim.
//
// Hermetic: a STUB agent that SIGNS its self-reported usage with an ed25519 key
// stands in for a signing wrapper around `claude -p`. No live agent, no network,
// no model SDK. Proves:
//   UNIT (the verify spine):
//     1. a correctly-signed usage verifies ⇒ `attested`;
//     2. tampering the usage after signing ⇒ `unattested`;
//     3. verifying against the WRONG public key ⇒ `unattested`;
//     4. REPLAY — a signature bound to {runId,taskId,promptDigest} does NOT verify
//        when reused for a different task ⇒ `unattested` (binding context works);
//     5. usage present but NO signature ⇒ `unattested`;
//     6. no usage at all ⇒ `absent`;
//     7. normalizeReportedUsage maps snake_case + camelCase token buckets.
//   END-TO-END (drive ⇒ accept ⇒ audit ⇒ report):
//     8. a full drive with a SIGNING stub + the operator public key ⇒ every
//        worker's usage is recorded `attested` with real token buckets, and the
//        report's Trust Audit shows full attestation coverage;
//     9. a full drive with a NON-signing stub (key still configured) ⇒ usage is
//        recorded `unattested` and the report surfaces it LOUDLY (⚠️ UNATTESTED),
//        never silently swallowed;
//    10. THE RED LINE holds: the recorded usage is the agent's REPORTED number;
//        CW never measured it (no token bucket CW could not have been told).

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const ta = require(path.join(pluginRoot, "dist/telemetry-attestation.js"));
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const { writeReport } = require(path.join(pluginRoot, "dist/orchestrator/report.js"));
const { listTrustAuditEvents } = require(path.join(pluginRoot, "dist/trust-audit.js"));

const FIXED_NOW = "2026-06-10T00:00:00.000Z";
const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-telemetry-smoke-")));
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

// A stub agent that writes a valid result.md and prints {model, usage, [usageSignature]}.
// It signs with the REAL signer (dist/telemetry-attestation.signTelemetry) over the
// SAME binding context CW verifies — read from the manifest it is handed. argv:
//   [2]={{result}} [3]={{manifest}} [4]={{input}} [5]=privateKeyPath (omit ⇒ no signature)
function writeStub(file, opts = {}) {
  const model = opts.model || "attested-opus";
  const taPath = JSON.stringify(path.join(pluginRoot, "dist/telemetry-attestation.js"));
  const lines = [
    'const fs = require("fs");',
    'const crypto = require("crypto");',
    `const ta = require(${taPath});`,
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2], mp = process.argv[3], ip = process.argv[4], pk = process.argv[5];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub section", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'const manifest = JSON.parse(fs.readFileSync(mp, "utf8"));',
    'const sha = (s) => "sha256:" + crypto.createHash("sha256").update(s, "utf8").digest("hex");',
    "const promptDigest = fs.existsSync(ip) ? sha(fs.readFileSync(ip, \"utf8\")) : sha(manifest.prompt || \"\");",
    "const usage = { input_tokens: 4, output_tokens: 2 };",
    "const ctx = { runId: manifest.runId, taskId: manifest.taskId, promptDigest };",
    `const report = { model: ${JSON.stringify(model)}, usage };`,
    "if (pk) { report.usageSignature = ta.signTelemetry(usage, fs.readFileSync(pk, \"utf8\"), ctx); }",
    "process.stdout.write(JSON.stringify(report));"
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function driveSigned(work, stubArgs, attestPublicKey) {
  const runner = new CoolWorkflowRunner({ pluginRoot });
  const run = runner.plan("architecture-review", { repo: work, question: "Sound?" });
  const result = drive(runner, run.id, {
    now: FIXED_NOW,
    agentConfig: { schemaVersion: 1, command: process.execPath, args: stubArgs, model: "operator-pick", attestPublicKey, source: "flag" }
  });
  return { runner, run, result, final: runner.loadRun(run.id) };
}

function main() {
  clearAgentEnv();
  const { publicPem, privatePem } = ed25519();
  const other = ed25519();

  // ---- UNIT: the verify spine ---------------------------------------------
  const ctx = { runId: "run-1", taskId: "task-A", promptDigest: "sha256:abc" };
  const usage = { input_tokens: 10, output_tokens: 3 };
  const sig = ta.signTelemetry(usage, privatePem, ctx);

  // 1. correct signature ⇒ attested
  let v = ta.verifyTelemetryAttestation(usage, sig, publicPem, ctx);
  assert.equal(v.status, "attested", "correctly-signed usage is attested");
  assert.equal(v.algorithm, "ed25519");

  // 2. tampered usage ⇒ unattested
  v = ta.verifyTelemetryAttestation({ input_tokens: 999, output_tokens: 3 }, sig, publicPem, ctx);
  assert.equal(v.status, "unattested", "tampered usage fails verification");
  assert.ok(/does not match/.test(v.reason || ""), `reason names the mismatch: ${v.reason}`);

  // 3. wrong public key ⇒ unattested
  v = ta.verifyTelemetryAttestation(usage, sig, other.publicPem, ctx);
  assert.equal(v.status, "unattested", "wrong trust key fails verification");

  // 4. REPLAY to a different task ⇒ unattested (binding context bites)
  v = ta.verifyTelemetryAttestation(usage, sig, publicPem, { ...ctx, taskId: "task-B" });
  assert.equal(v.status, "unattested", "a signature is bound to its task — replay fails");

  // 5. usage but no signature ⇒ unattested
  v = ta.verifyTelemetryAttestation(usage, undefined, publicPem, ctx);
  assert.equal(v.status, "unattested", "unsigned usage is unattested");
  assert.ok(/no signature/.test(v.reason || ""), `reason: ${v.reason}`);

  // 6. no usage ⇒ absent
  v = ta.verifyTelemetryAttestation(undefined, undefined, publicPem, ctx);
  assert.equal(v.status, "absent", "no usage ⇒ absent");
  v = ta.verifyTelemetryAttestation({}, sig, publicPem, ctx);
  assert.equal(v.status, "absent", "empty usage ⇒ absent");

  // 6b. signature present but NO trust key configured ⇒ unattested (honest default)
  v = ta.verifyTelemetryAttestation(usage, sig, undefined, ctx);
  assert.equal(v.status, "unattested", "no trust key ⇒ cannot attest, stays unattested");
  assert.ok(/no trust key/.test(v.reason || ""), `reason: ${v.reason}`);

  // 6c. RESULT coverage: the executor binds a sha256 of the agent's result into the
  //     signature, so editing the result (the findings) — not just the usage — is
  //     detected. Behavioral fails-before: before result coverage,
  //     canonicalTelemetryPayload ignored resultDigest, so a changed result still
  //     verified `attested`.
  const rctx = { ...ctx, resultDigest: "sha256:resultAAA" };
  const rsig = ta.signTelemetry(usage, privatePem, rctx);
  v = ta.verifyTelemetryAttestation(usage, rsig, publicPem, rctx);
  assert.equal(v.status, "attested", "a result-bound signature verifies with the same result digest");
  v = ta.verifyTelemetryAttestation(usage, rsig, publicPem, { ...ctx, resultDigest: "sha256:resultEDITED" });
  assert.equal(v.status, "unattested", "an edited result (changed resultDigest) fails verification");

  // 6d. Back-compat: a 4-field signature (a signer that predates result coverage)
  //     still verifies `attested` even when CW now supplies a resultDigest — the
  //     verifier retries without it. A NEW signer who covered the result fails BOTH
  //     arms when the result is edited (6c), so tamper is still caught.
  v = ta.verifyTelemetryAttestation(usage, sig, publicPem, { ...ctx, resultDigest: "sha256:resultAAA" });
  assert.equal(v.status, "attested", "a pre-result-coverage 4-field signature still verifies (back-compat)");

  // 6e. POLA byte-pin: with no resultDigest the canonical payload is the EXACT
  //     pre-change 4-field string (sorted keys), so every old signature still
  //     verifies; supplying a resultDigest changes the bytes.
  assert.equal(
    ta.canonicalTelemetryPayload(usage, ctx),
    '{"promptDigest":"sha256:abc","runId":"run-1","taskId":"task-A","usage":{"input_tokens":10,"output_tokens":3}}',
    "the 4-field canonical payload is byte-identical to before result coverage"
  );
  assert.equal(
    ta.canonicalTelemetryPayload(usage, ctx),
    ta.canonicalTelemetryPayload(usage, { ...ctx, resultDigest: undefined }),
    "an undefined resultDigest is omitted from the payload entirely"
  );
  assert.notEqual(
    ta.canonicalTelemetryPayload(usage, ctx),
    ta.canonicalTelemetryPayload(usage, rctx),
    "a present resultDigest changes the canonical payload"
  );

  // 7. normalizeReportedUsage maps both casings
  const n1 = ta.normalizeReportedUsage({ input_tokens: 4, output_tokens: 2, cache_read_tokens: 1 });
  assert.deepEqual({ i: n1.inputTokens, o: n1.outputTokens, c: n1.cacheReadTokens }, { i: 4, o: 2, c: 1 }, "snake_case mapped");
  const n2 = ta.normalizeReportedUsage({ inputTokens: 7, outputTokens: 5 });
  assert.deepEqual({ i: n2.inputTokens, o: n2.outputTokens }, { i: 7, o: 5 }, "camelCase mapped");
  assert.equal(ta.normalizeReportedUsage(undefined).inputTokens, undefined, "absent stays undefined, never 0");

  // ---- END-TO-END: signed drive ⇒ attested + report coverage ---------------
  const cwd0 = process.cwd();
  const workS = tmpWorkspace();
  const stubSigned = writeStub(path.join(workS, "stub-signed.js"), { model: "attested-opus" });
  const privPath = path.join(workS, "agent-priv.pem");
  fs.writeFileSync(privPath, privatePem, "utf8");
  process.chdir(workS);
  try {
    const { run, result, final } = driveSigned(
      workS,
      [stubSigned, "{{result}}", "{{manifest}}", "{{input}}", privPath],
      publicPem
    );
    assert.equal(result.status, "complete", "signed drive completes");
    const usages = (final.workers || []).map((w) => w.usage).filter(Boolean);
    assert.ok(usages.length >= 1, "at least one worker recorded usage");
    assert.ok(usages.every((u) => u.attestation === "attested"), "every signed usage is attested");
    assert.ok(
      usages.every((u) => u.inputTokens === 4 && u.outputTokens === 2),
      "token buckets recorded from the agent's reported usage"
    );
    // 10. RED LINE: the recorded source is host-attested, never cw-measured.
    assert.ok(usages.every((u) => u.source === "host-attested"), "usage source is host-attested (CW did not measure)");

    const events = listTrustAuditEvents(final).filter((e) => e.kind === "worker.agent-delegation");
    assert.ok(events.length >= 1 && events.every((e) => e.metadata.telemetryAttestation === "attested"), "audit events carry attested verdict");

    const md = fs.readFileSync(writeReport(final), "utf8");
    assert.match(md, /Telemetry attestation: \d+\/\d+ attested/, "report shows attestation coverage");
    assert.ok(!/UNATTESTED/.test(md), "no UNATTESTED warning when all signed");
  } finally {
    process.chdir(cwd0);
  }

  // ---- END-TO-END: unsigned drive ⇒ unattested + LOUD report ---------------
  const workU = tmpWorkspace();
  const stubUnsigned = writeStub(path.join(workU, "stub-unsigned.js"), { model: "noisy-opus" });
  process.chdir(workU);
  try {
    const { final } = driveSigned(
      workU,
      [stubUnsigned, "{{result}}", "{{manifest}}", "{{input}}"], // no key path ⇒ no signature
      publicPem
    );
    const usages = (final.workers || []).map((w) => w.usage).filter(Boolean);
    assert.ok(usages.length >= 1 && usages.every((u) => u.attestation === "unattested"), "unsigned usage is unattested");
    const md = fs.readFileSync(writeReport(final), "utf8");
    assert.match(md, /UNATTESTED usage/, "report surfaces unattested telemetry LOUDLY");
    assert.match(md, /Telemetry attestation: 0\/\d+ attested, \d+ UNATTESTED/, "coverage line counts the unattested");
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
  console.log("telemetry-attestation-smoke: ok (verify spine, signed⇒attested, unsigned⇒unattested+loud, red line held)");
}

main();
