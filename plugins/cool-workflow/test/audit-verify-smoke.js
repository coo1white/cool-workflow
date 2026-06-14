"use strict";
// audit-verify-smoke: the `cw audit verify <run>` verb must re-prove the
// trust-audit hash chain and FAIL CLOSED (non-zero exit) on a forged/edited
// chain — so `cw audit verify <run> && deploy` stops on tampering. Peer of the
// telemetry-verify exit-code guard. POLA: an absent chain exits 0, and the
// pre-existing `audit summary` verb still always exits 0 (it embeds the same
// integrity field but is a reader, not a gate).
//
// verifyTrustAudit's chain logic itself is covered by freebsd-audit-fixes-smoke;
// this smoke pins the NEW CLI surface + exit-code contract end to end.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { recordTrustAuditEvent, verifyTrustAudit } = require("../dist/trust-audit");
const cli = path.join(__dirname, "..", "dist", "cli.js");

function runCli(cwd, args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Lay a run out the way the CLI resolves it: <cwd>/.cw/runs/<id>/.
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-verify-"));
const runId = "audit-verify-run";
const runDir = path.join(cwd, ".cw", "runs", runId);
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ id: runId, schemaVersion: 1 }));

// (1) Absent chain -> nothing to prove -> present:false / verified:true / exit 0.
let r = runCli(cwd, ["audit", "verify", runId, "--json"]);
assert.equal(r.status, 0, "absent audit chain exits 0");
let out = JSON.parse(r.stdout);
assert.equal(out.present, false, "absent chain present:false");
assert.equal(out.verified, true, "absent chain verified:true (nothing to prove)");

// Record a real, hash-chained trust-audit log into the same run dir.
const run = { id: runId, paths: { runDir } };
recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "denied", source: "cw-validated", workerId: "w2" });
recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });

// (2) Intact chain -> verified:true / exit 0.
r = runCli(cwd, ["audit", "verify", runId, "--json"]);
assert.equal(r.status, 0, "intact chain exits 0");
out = JSON.parse(r.stdout);
assert.equal(out.present, true, "recorded chain present:true");
assert.equal(out.verified, true, "intact chain verified:true");
assert.equal(out.eventCount, 3, "all 3 events counted");
assert.deepEqual(out.failedChecks, [], "intact chain has no failed checks");

// (3) Forge one event -> verified:false AND non-zero exit (the whole point).
const logPath = path.join(runDir, "audit", "events.jsonl");
const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
const ev = JSON.parse(lines[0]);
ev.decision = "TAMPERED"; // body no longer matches its recorded eventHash
lines[0] = JSON.stringify(ev);
fs.writeFileSync(logPath, lines.join("\n") + "\n");

r = runCli(cwd, ["audit", "verify", runId, "--json"]);
assert.equal(r.status, 1, "forged chain exits 1 (fail-closed)");
out = JSON.parse(r.stdout);
assert.equal(out.verified, false, "forged chain verified:false");
assert.ok(
  out.failedChecks.some((c) => c.code === "trust-audit-digest-mismatch"),
  "forged chain reports trust-audit-digest-mismatch"
);

// (4) POLA: the reader verb `audit summary` still exits 0 on the same forged run
// (it surfaces the integrity field but is not a gate — unchanged behavior).
r = runCli(cwd, ["audit", "summary", runId, "--json"]);
assert.equal(r.status, 0, "audit summary still exits 0 on a tampered run (unchanged)");

// (5) FULLY-CORRUPT log: every line unparseable -> events.length 0 so present:false,
// but verified:false (corruptLines>0). This must STILL exit 1 — it is the most severe
// tamper (zeroing/garbling the whole log), not an absent chain. The earlier
// `present && !verified` guard conflated all-corrupt with absent and let it exit 0.
fs.writeFileSync(logPath, "not json\nstill not json\n");
r = runCli(cwd, ["audit", "verify", runId, "--json"]);
out = JSON.parse(r.stdout);
assert.equal(out.present, false, "all-corrupt log has no parseable events (present:false)");
assert.equal(out.verified, false, "all-corrupt log is unverified");
assert.ok(out.corruptLines > 0, "all-corrupt log reports corruptLines");
assert.equal(r.status, 1, "all-corrupt log STILL exits 1 (not conflated with absent)");

// Regression: an event carrying an undefined field (real-world: worker-dispatch
// audit metadata with an absent dispatchId) must still RE-VERIFY. computeEventHash
// binds the PERSISTED form (JSON.stringify drops undefined keys); before the fix it
// hashed the in-memory form (stableStringify keeps them as null), so every worker
// event false-failed as trust-audit-digest-mismatch — breaking `audit verify` on
// honest runs.
{
  const undefDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-undef-"));
  const r2 = { id: "undef-run", paths: { runDir: undefDir } };
  recordTrustAuditEvent(r2, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1", metadata: { absent: undefined, present: "x" } });
  recordTrustAuditEvent(r2, { kind: "commit.gate", decision: "recorded", source: "cw-validated", metadata: { also: undefined } });
  const integ = verifyTrustAudit(r2);
  assert.equal(integ.eventCount, 2, "both undefined-bearing events present");
  assert.equal(integ.verified, true, "events with undefined fields re-verify (persisted-form hash)");
}

process.stdout.write("audit-verify-smoke: ok (absent=0, intact=0, forged=1, summary unchanged=0, undefined-field re-verifies)\n");
