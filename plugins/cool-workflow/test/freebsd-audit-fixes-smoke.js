"use strict";
// Regression guards for the v0.1.81 FreeBSD/Unix-philosophy audit fixes. Each
// assertion pins a "false-green" hole the audit found: a path that must now FAIL
// CLOSED (report a failure) instead of silently verifying green.
//
// Covered here (behavioral): H2 telemetry corrupt fail-closed, H3 telemetry-verify
// exit code, H4 trust-audit tamper-evidence chain, H7 custom sandbox enforcement.
// H1/H5 are covered by the eval-replay + run-export smokes (path/sort changes).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  verifyTelemetryLedger,
  loadTelemetryLedger,
  appendTelemetryAttestation,
  TelemetryLedgerCorruptError
} = require("../dist/telemetry-ledger");
const { recordTrustAuditEvent, verifyTrustAudit } = require("../dist/trust-audit");
const sandbox = require("../dist/sandbox-profile");

const cli = path.join(__dirname, "..", "dist", "cli.js");

function tmpRun(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { id: "audit-fixes-run", paths: { runDir: dir } };
}

// ---- H2: a corrupt telemetry ledger must FAIL CLOSED, not verify green --------
(function h2TelemetryCorrupt() {
  const run = tmpRun("h2-");
  const file = path.join(run.paths.runDir, "telemetry.json");

  // absent -> nothing to prove, clean.
  let v = verifyTelemetryLedger(run);
  assert.equal(v.present, false, "H2: absent ledger present:false");
  assert.equal(v.verified, true, "H2: absent ledger verifies clean");

  // exists but unparseable -> present + verified:false (the bug verified true).
  fs.writeFileSync(file, "{ not valid json at all");
  v = verifyTelemetryLedger(run);
  assert.equal(v.present, true, "H2: corrupt ledger reported present");
  assert.equal(v.verified, false, "H2: corrupt ledger FAILS verification");
  assert.ok(
    v.checks.some((c) => c.code === "telemetry-ledger-corrupt"),
    "H2: corrupt ledger carries telemetry-ledger-corrupt check"
  );

  // load throws (so an append can never silently re-genesis on a poisoned file).
  assert.throws(() => loadTelemetryLedger(run), TelemetryLedgerCorruptError, "H2: load throws on corrupt");
  assert.throws(
    () => appendTelemetryAttestation(run, { workerId: "w", taskId: "t", promptDigest: "d", attestation: "attested" }),
    TelemetryLedgerCorruptError,
    "H2: append refuses to extend a corrupt chain"
  );
})();

// ---- H3: `telemetry verify` exit code must reflect the verdict ----------------
(function h3TelemetryVerifyExitCode() {
  const run = tmpRun("h3-");
  const runId = path.basename(run.paths.runDir);
  // The CLI resolves runs under <cwd>/.cw/runs/<id>; lay the run out that way.
  const runsRoot = path.join(run.paths.runDir, ".cw", "runs", runId);
  fs.mkdirSync(runsRoot, { recursive: true });
  fs.writeFileSync(path.join(runsRoot, "state.json"), JSON.stringify({ id: runId, schemaVersion: 1 }));

  // absent ledger -> exit 0 (nothing to verify).
  let r = spawnSync(process.execPath, [cli, "telemetry", "verify", runId, "--json"], { cwd: run.paths.runDir });
  assert.equal(r.status, 0, "H3: telemetry verify on absent ledger exits 0");

  // corrupt ledger -> exit 1 (must not green a lie under `verify && deploy`).
  fs.writeFileSync(path.join(runsRoot, "telemetry.json"), "{ corrupt");
  r = spawnSync(process.execPath, [cli, "telemetry", "verify", runId, "--json"], { cwd: run.paths.runDir });
  assert.equal(r.status, 1, "H3: telemetry verify on corrupt ledger exits 1");
})();

// ---- H4: trust-audit log must be tamper-evident (hash chain + verify) ----------
(function h4TrustAuditChain() {
  const run = tmpRun("h4-");
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "denied", source: "cw-validated", workerId: "w2" });
  recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });

  const clean = verifyTrustAudit(run);
  assert.equal(clean.present, true, "H4: events present");
  assert.equal(clean.verified, true, "H4: untouched chain verifies");
  assert.equal(clean.chained, 3, "H4: all 3 events are chained");
  assert.equal(clean.corruptLines, 0, "H4: no corrupt lines");

  const logPath = path.join(run.paths.runDir, "audit", "events.jsonl");
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);

  // (a) EDIT a recorded event -> digest mismatch -> verified:false.
  const edited = lines.slice();
  const ev = JSON.parse(edited[0]);
  ev.decision = "denied"; // flip an allowed decision to denied
  edited[0] = JSON.stringify(ev);
  fs.writeFileSync(logPath, `${edited.join("\n")}\n`);
  let v = verifyTrustAudit(run);
  assert.equal(v.verified, false, "H4: an edited event is detected");
  assert.ok(v.checks.some((c) => c.code === "trust-audit-digest-mismatch"), "H4: digest-mismatch reported");

  // (b) REMOVE the middle event -> chain link broken.
  fs.writeFileSync(logPath, `${[lines[0], lines[2]].join("\n")}\n`);
  v = verifyTrustAudit(run);
  assert.equal(v.verified, false, "H4: a removed event breaks the chain");
  assert.ok(v.checks.some((c) => c.code === "trust-audit-chain-broken"), "H4: chain-broken reported");

  // (c) CORRUPT a line -> fail closed, but the read surface does NOT throw (M3).
  fs.writeFileSync(logPath, `${lines[0]}\n{ this is not json\n${lines[1]}\n${lines[2]}\n`);
  v = verifyTrustAudit(run);
  assert.equal(v.verified, false, "H4/M3: a corrupt line fails closed");
  assert.ok(v.corruptLines >= 1, "H4/M3: corrupt line counted, not thrown");

  // (d) FORGE an unchained event (drop eventHash) onto a chained log — it must NOT
  // be waved through as "legacy" (BYPASS-1 found by the adversarial verify pass).
  const forged = JSON.parse(lines[0]);
  delete forged.eventHash;
  delete forged.prevEventHash;
  forged.decision = "allowed";
  forged.normalizedPath = "/etc/passwd";
  fs.writeFileSync(logPath, `${lines.join("\n")}\n${JSON.stringify(forged)}\n`);
  v = verifyTrustAudit(run);
  assert.equal(v.verified, false, "H4: an unchained (hash-dropped) forged event is rejected, not treated as legacy");
  assert.ok(v.chained >= 1 && v.unchained >= 1, "H4: forged event counted unchained amid chained events");
  assert.ok(v.checks.some((c) => c.code === "trust-audit-unchained-event"), "H4: unchained-event check reported");
})();

// ---- H7: a custom sandbox profile FILE must be enforceable, not just validated -
(function h7CustomSandboxEnforced() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h7-"));
  const ctx = sandbox.sandboxContextForValidation(dir);
  const base = sandbox.showBundledSandboxProfile(sandbox.bundledSandboxProfileIds()[0], ctx);
  const custom = {
    schemaVersion: base.schemaVersion,
    id: "audit-custom",
    title: "Audit custom",
    readPaths: base.readPaths,
    writePaths: base.writePaths,
    workerOutput: base.workerOutput,
    execute: base.execute,
    network: base.network,
    env: base.env
  };
  const file = path.join(dir, "custom.json");
  fs.writeFileSync(file, JSON.stringify(custom));

  // A valid custom profile file now RESOLVES (was: threw not-found at dispatch).
  const resolved = sandbox.resolveSandboxProfileById(file, ctx);
  assert.equal(resolved.id, "audit-custom", "H7: custom profile file resolves to its policy");

  // An unknown, non-file id still FAILS CLOSED.
  assert.throws(() => sandbox.resolveSandboxProfileById("no-such-profile", ctx), /not found|not-found/i, "H7: unknown id fails closed");
})();

console.log("freebsd-audit-fixes-smoke: PASS");
