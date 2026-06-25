"use strict";
// run-restore-failclosed-smoke: `cw run restore <archive>` must close the REAL gap
// that `cw run import` leaves open. importRun digest-checks every file BEFORE
// writing (so a byte tamper is rejected by import already), then writes the run,
// runs verifyImportedRun, and returns the verdict as ImportResult.verification —
// WITHOUT failing on it. verifyImportedRun additionally re-proves the
// TELEMETRY-LEDGER and TRUST-AUDIT hash chains. NET: `run import` exits 0 (a
// fabricated success) on a run whose telemetry/trust-audit chain does NOT verify.
// `run restore` reuses that same verification and FAILS CLOSED (exit 1, ok:false)
// on it.
//
// Asserted (UNCONDITIONALLY — no `if (stdout)` gates around the proof):
//   (A) HAPPY: a good archive -> `run restore --target DIR` exits 0, ok:true,
//       verify.ok:true, and the run is present in the target's repo registry.
//   (B) THE DISCRIMINATOR (the whole value of restore): an archive that `run
//       import` ACCEPTS (all file digests valid, so importRun does NOT throw) but
//       whose verifyImportedRun FAILS because a telemetry-ledger record was
//       tampered and the chain no longer recomputes. The integrity block is
//       recomputed so verifyArchiveFileDigests still passes. On this SAME archive:
//         - `run import`  -> EXIT 0, verification.ok === false   (import fabricates)
//         - `run restore` -> EXIT NON-ZERO, ok === false, verify.ok === false
//       This contrast is asserted directly, without any conditional gate.
//   (C) Secondary: a byte-digest tamper -> `run restore` also exits non-zero (the
//       inspect-first refusal). Not the primary proof.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { exportRun } = require("../dist/run-export");
const { appendTelemetryAttestation } = require("../dist/telemetry-ledger");
const { recordTrustAuditEvent } = require("../dist/trust-audit");

const cli = path.join(__dirname, "..", "dist", "cli.js");
const node = process.execPath;

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cw-restore-${tag}-`));
}
// Each CLI spawn gets its OWN isolated CW_HOME + tmp so the test never touches the
// real home registry and runs leave no global trace (POLA: hermetic test).
function isolatedEnv() {
  return { ...process.env, CW_HOME: freshDir("home"), TMPDIR: freshDir("tmp") };
}

// digestManifest reproduction — MUST stay byte-identical to run-export.ts so a
// content tamper can recompute integrity.manifestSha256 and slip past
// verifyArchiveFileDigests (the import throw-gate). Hashes {relativePath, role,
// sha256, sizeBytes} per file (NOT contentBase64; sourcePath excluded), in
// codepoint order. A drift here would make the discriminator silently degrade into
// a manifest-mismatch refusal, so we self-check it against a real archive below.
function digestManifest(files) {
  const manifest = files
    .map((f) => ({ relativePath: f.relativePath, role: f.role, sha256: f.sha256, sizeBytes: f.sizeBytes }))
    .sort((l, r) => (l.relativePath < r.relativePath ? -1 : l.relativePath > r.relativePath ? 1 : 0));
  return sha256Hex(Buffer.from(JSON.stringify(manifest), "utf8"));
}

// ---- Build ONE real run WITH a telemetry ledger + trust-audit chain ------------
// A bare `plan` leaves telemetry absent and audit empty — both verify as "nothing
// to prove" (verified:true), so there would be no chain to break. We hand-build the
// chains the way the orchestrator does (mirrors run-export-import-smoke.js): a
// completed task plus real appendTelemetryAttestation / recordTrustAuditEvent
// records, so verifyTelemetryLedger / verifyTrustAudit have real content to fail on.
const src = freshDir("src");
const runId = "restore-failclosed";
const runDir = path.join(src, ".cw", "runs", runId);
const paths = createRunPaths(runDir);
ensureRunDirs(paths);
const run = {
  schemaVersion: 1,
  id: runId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: src,
  workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: { question: "restore fail-closed" },
  loopStage: "interpret",
  phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: ["t1"] }],
  tasks: [
    {
      id: "t1",
      kind: "analyze",
      phase: "analyze",
      status: "completed",
      requiresEvidence: false,
      prompt: "test",
      taskPath: path.join(paths.tasksDir, "t1.md"),
      resultPath: path.join(paths.resultsDir, "t1.md"),
      loopStage: "act"
    }
  ],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: []
};
saveCheckpoint(run);
// Real hash-chained telemetry ledger (2 linked records) -> telemetry.json.
appendTelemetryAttestation(run, {
  workerId: "w1",
  taskId: "t1",
  promptDigest: sha256Hex(Buffer.from("p1")),
  attestation: "unattested",
  now: "2026-01-01T00:00:00.000Z"
});
appendTelemetryAttestation(run, {
  workerId: "w2",
  taskId: "t1",
  promptDigest: sha256Hex(Buffer.from("p2")),
  attestation: "unattested",
  now: "2026-01-01T00:00:01.000Z"
});
// Real hash-chained trust-audit log (2 linked events) -> audit/events.jsonl.
recordTrustAuditEvent(run, { kind: "worker.output", decision: "accepted", source: "runtime-derived", workerId: "w1", taskId: "t1" });
recordTrustAuditEvent(run, { kind: "worker.output", decision: "accepted", source: "runtime-derived", workerId: "w2", taskId: "t1" });

const goodArchive = path.join(src, "good.cwrun.json");
exportRun(run, goodArchive);
const good = JSON.parse(fs.readFileSync(goodArchive, "utf8"));
assert.ok(good.files.some((f) => f.relativePath === "telemetry.json"), "archive carries the telemetry ledger");
assert.ok(good.files.some((f) => f.relativePath === "audit/events.jsonl"), "archive carries the trust-audit log");
// Self-check: our digestManifest reproduction matches the real archive's integrity,
// so the discriminator below recomputes a manifest the import gate will accept.
assert.equal(digestManifest(good.files), good.integrity.manifestSha256, "digestManifest reproduction matches run-export.ts");

// --- (A) HAPPY: restore a clean archive end-to-end ------------------------------
{
  const target = freshDir("ok");
  const env = isolatedEnv();
  const r = spawnSync(node, [cli, "run", "restore", goodArchive, "--target", target, "--json"], { encoding: "utf8", env });
  assert.equal(r.status, 0, `happy: restore exits 0 (stderr: ${r.stderr})`);
  const out = JSON.parse(r.stdout); // parse UNCONDITIONALLY — restore always prints JSON
  assert.equal(out.ok, true, "happy: result.ok true");
  assert.ok(out.inspect && out.inspect.ok === true, "happy: inspect.ok true (integrity proven first)");
  assert.ok(out.verify && out.verify.ok === true, "happy: verify.ok true (telemetry + trust-audit chains verified)");
  assert.ok(out.imported && out.imported.run && out.imported.run.id === runId, "happy: imported run id matches");

  // The run is actually present in the target's repo registry now.
  assert.ok(fs.existsSync(path.join(target, ".cw", "runs", runId)), "happy: run dir restored under target");
  const list = JSON.parse(
    execFileSync(node, [cli, "run", "list", "--cwd", target, "--scope", "repo", "--json"], { encoding: "utf8", env })
  );
  const ids = (list.records || []).map((e) => e.runId || e.id);
  assert.ok(ids.includes(runId), `happy: target registry lists the restored run (saw ${JSON.stringify(ids)})`);
}

// --- (B) THE DISCRIMINATOR: import ACCEPTS, restore FAILS CLOSED ----------------
// Tamper one telemetry-ledger record's `attestation` field so its recordHash no
// longer recomputes (verifyTelemetryLedger -> telemetry-ledger-invalid), then
// recompute the telemetry file's sha256 + sizeBytes AND integrity.manifestSha256 so
// every file-digest / size / count / manifest check still passes. importRun does
// NOT throw on such an archive (it only re-proves file digests, never the chain),
// so `run import` exits 0 with verification.ok:false — the exact fabricated success
// `run restore` exists to refuse.
const tamperedArchive = (() => {
  const a = JSON.parse(JSON.stringify(good));
  const tel = a.files.find((f) => f.relativePath === "telemetry.json");
  const decoded = JSON.parse(Buffer.from(tel.contentBase64, "base64").toString("utf8"));
  assert.ok(decoded.records.length >= 1, "telemetry ledger has a record to tamper");
  // Flip a recorded verdict — the exact "edit a recorded verdict and the chain no
  // longer recomputes" case verifyTelemetryLedger is built to catch. prevHash
  // linkage is untouched, so ONLY the record-hash recompute fails (not a load error).
  decoded.records[0].attestation = decoded.records[0].attestation === "attested" ? "unattested" : "attested";
  const bytes = Buffer.from(JSON.stringify(decoded, null, 2) + "\n", "utf8");
  tel.contentBase64 = bytes.toString("base64");
  tel.sha256 = sha256Hex(bytes); // file-digest check now passes over the new bytes
  tel.sizeBytes = bytes.length; // size check now passes
  a.integrity.manifestSha256 = digestManifest(a.files); // manifest check now passes
  const dir = freshDir("t-chain");
  const p = path.join(dir, "tampered.cwrun.json");
  fs.writeFileSync(p, JSON.stringify(a));
  return p;
})();

// (B1) `run import` ACCEPTS the tampered archive: exit 0, but verification.ok:false.
//      This is the gap — import ships a false verdict and still exits 0.
{
  const target = freshDir("imp-accepts");
  const env = isolatedEnv();
  const r = spawnSync(node, [cli, "run", "import", tamperedArchive, "--target", target, "--json"], { encoding: "utf8", env });
  assert.equal(r.status, 0, `discriminator: run import EXITS 0 on the chain-tampered archive (stderr: ${r.stderr})`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verification.ok, false, "discriminator: import's own verification.ok is FALSE (import fabricates success)");
  const telCheck = out.verification.checks.find((c) => c.name === "telemetry-ledger");
  assert.ok(telCheck && telCheck.pass === false, "discriminator: import flags telemetry-ledger as failing — yet exits 0");
}

// (B2) `run restore` FAILS CLOSED on the SAME archive: exit non-zero, ok:false,
//      verify.ok:false. This is the contrast that justifies the capability.
{
  const target = freshDir("restore-refuses");
  const env = isolatedEnv();
  const r = spawnSync(node, [cli, "run", "restore", tamperedArchive, "--target", target, "--json"], { encoding: "utf8", env });
  assert.notEqual(r.status, 0, "discriminator: run restore EXITS NON-ZERO on the same archive import accepted");
  const out = JSON.parse(r.stdout); // restore always prints JSON — parse UNCONDITIONALLY
  assert.equal(out.ok, false, "discriminator: restore result.ok is false");
  assert.ok(out.verify && out.verify.ok === false, "discriminator: restore verify.ok is false (the chain refusal)");
  // inspect (file-digest integrity) passed — this is NOT a byte tamper; the refusal
  // comes purely from the telemetry chain failing verification.
  assert.ok(out.inspect && out.inspect.ok === true, "discriminator: inspect.ok true — the refusal is the chain, not the bytes");
  const telCheck = out.verify.checks.find((c) => c.name === "telemetry-ledger");
  assert.ok(telCheck && telCheck.pass === false, "discriminator: restore names the failing telemetry-ledger check");
}

// --- (C) Secondary: a BYTE-digest tamper is also refused (inspect-first) ---------
// Not the primary proof (import already rejects this via its throw-gate), but it
// confirms restore's read-only refuse-without-write path on a corrupt archive.
{
  const a = JSON.parse(JSON.stringify(good));
  const idx = a.files.findIndex((f) => f.sizeBytes > 0);
  assert.ok(idx >= 0, "archive carries a non-empty file to byte-tamper");
  const bytes = Buffer.from(a.files[idx].contentBase64, "base64");
  bytes[0] = bytes[0] ^ 0xff; // same length -> size passes, file-digest fails (sha256 left stale)
  a.files[idx].contentBase64 = bytes.toString("base64");
  const p = path.join(freshDir("t-byte"), "byte-tampered.cwrun.json");
  fs.writeFileSync(p, JSON.stringify(a));

  const target = freshDir("byte-refuses");
  const env = isolatedEnv();
  const r = spawnSync(node, [cli, "run", "restore", p, "--target", target, "--json"], { encoding: "utf8", env });
  assert.notEqual(r.status, 0, "byte-tamper: restore exits non-zero (inspect-first refusal)");
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false, "byte-tamper: result.ok false");
  assert.ok(out.inspect && out.inspect.ok === false, "byte-tamper: inspect.ok false (refused before import)");
  assert.equal(out.imported, null, "byte-tamper: nothing imported (refuse-without-write)");
  const restored = path.join(target, ".cw", "runs", runId);
  assert.ok(!fs.existsSync(restored) || fs.readdirSync(restored).length === 0, "byte-tamper: nothing partial left on disk");
}

process.stdout.write(
  "run-restore-failclosed-smoke: ok (happy restore verified; discriminator: import exits 0 with verification.ok:false while restore fails-closed on the same archive; byte tamper refused inspect-first)\n"
);
