"use strict";
// verify-import-audit-chain-smoke: restore verification must RE-PROVE the
// trust-audit hash chain, not just telemetry. verifyImportedRun already re-proves
// the import manifest, per-file sha256, and the telemetry ledger; this pins the
// added `trust-audit` check + the `--strict` fail-closed exit on `run verify-import`.
//
// POLA: the trust-audit row is APPENDED (existing check names/order unchanged), and
// the exit-code gate lives only behind --strict, so a default `verify-import` stays
// exit 0 and byte-shaped as before plus the one new row.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cli = path.join(__dirname, "..", "dist", "cli.js");

function cli_(args, cwd) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, json: r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : undefined, stderr: r.stderr };
}

// Build a run that HAS a trust-audit chain: plan + dispatch records worker
// sandbox/backend audit events (the ones that carry undefined metadata fields).
const src = fs.mkdtempSync(path.join(os.tmpdir(), "cw-vi-src-"));
const planned = cli_(["plan", "architecture-review", "--repo", src, "--question", "verify-import audit chain"], src);
const runId = planned.json.runId;
cli_(["dispatch", runId, "--limit", "1"], src);

const exported = cli_(["run", "export", runId, "--json"], src);
const archive = exported.json.archivePath || exported.json.path;
assert.ok(archive, "export returns an archive path");

const dst = fs.mkdtempSync(path.join(os.tmpdir(), "cw-vi-dst-"));
cli_(["run", "import", archive, "--json"], dst);

// (1) Clean restore: verify-import now carries a PASSING trust-audit row, ok:true,
// default exit 0.
let r = cli_(["run", "verify-import", runId, "--json"], dst);
assert.equal(r.status, 0, "clean verify-import exits 0 by default");
const auditCheck = r.json.checks.find((c) => c.name === "trust-audit");
assert.ok(auditCheck, "verify-import includes a trust-audit check");
assert.equal(auditCheck.pass, true, "intact restored audit chain passes");
assert.equal(r.json.ok, true, "clean restore ok:true");
// The new check is APPENDED last (POLA: pre-existing rows keep their order).
assert.equal(r.json.checks[r.json.checks.length - 1].name, "trust-audit", "trust-audit row is appended last");

// (2) Tamper the RESTORED audit log → trust-audit check fails, ok:false.
const restoredRunDir = path.join(dst, ".cw", "runs", runId);
const eventsLog = path.join(restoredRunDir, "audit", "events.jsonl");
const lines = fs.readFileSync(eventsLog, "utf8").split("\n").filter(Boolean);
const ev = JSON.parse(lines[0]);
ev.decision = "TAMPERED";
lines[0] = JSON.stringify(ev);
fs.writeFileSync(eventsLog, lines.join("\n") + "\n");

// (3) Default invocation still exits 0 (POLA), but reports ok:false + failed row.
r = cli_(["run", "verify-import", runId, "--json"], dst);
assert.equal(r.status, 0, "tampered restore still exits 0 WITHOUT --strict (POLA)");
assert.equal(r.json.ok, false, "tampered restore reports ok:false");
const ta = r.json.checks.find((c) => c.name === "trust-audit");
assert.equal(ta.pass, false, "tampered audit chain fails its check");
assert.equal(ta.code, "trust-audit-invalid", "failed trust-audit check carries its code");

// (4) --strict makes a failed restore check exit non-zero (the fail-closed contract).
r = cli_(["run", "verify-import", runId, "--strict", "--json"], dst);
assert.equal(r.status, 1, "tampered restore with --strict exits 1");
assert.equal(r.json.ok, false, "strict result still reports ok:false");

process.stdout.write("verify-import-audit-chain-smoke: ok (clean=ok/0, tampered default=ok:false/0, tampered --strict=1)\n");
