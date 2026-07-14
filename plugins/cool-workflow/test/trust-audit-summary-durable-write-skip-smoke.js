#!/usr/bin/env node
"use strict";

// trust-audit-summary-durable-write-skip-smoke — perf cycle P1 (read side).
//
// summarizeTrustAudit used to read+parse the audit log via readEventsRaw,
// THEN call verifyTrustAudit(run), which read+parsed the SAME log AGAIN
// and recomputed a sha256 for every event -- two full passes per call --
// and it durably (fsync) rewrote summary.json AND index.json on EVERY
// call, even when nothing had changed since the last call. Fixed by:
//  1. Reading the log once and handing the same parsed array straight to
//     verifyEventsChain (dedup -- verification strength unchanged).
//  2. Skipping the durable rewrite of summary.json/index.json when the
//     freshly, fully recomputed content is byte-identical to what a
//     content fingerprint sidecar says is already on disk.
//
// This proves: (1) a no-op second call skips the disk rewrite; (2) a real
// change (new event, or a run-state rollup change with no new event)
// still triggers a real rewrite; (3) a corrupt fingerprint sidecar falls
// back to a real rewrite, fail closed; (4) verification is NEVER skipped
// -- an early, non-tail tamper that leaves the file's length unchanged
// still flips the SECOND call's integrity.verified to false. This last
// case is the regression guard against the unsound (log size, tail hash)
// cache design this cycle explicitly rejected.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { recordTrustAuditEvent, summarizeTrustAudit } = require(path.join(pluginRoot, "dist/shell/trust-audit.js"));

function freshRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-summary-skip-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  return { dir, run: { id: "summary-skip-run", paths: { runDir }, workers: [] } };
}

function auditPaths(runDir) {
  const auditDir = path.join(runDir, "audit");
  return {
    auditDir,
    eventLogPath: path.join(auditDir, "events.jsonl"),
    summaryPath: path.join(auditDir, "summary.json"),
    indexPath: path.join(auditDir, "index.json"),
    fingerprintPath: path.join(auditDir, "summary-fingerprint.json"),
  };
}

function countRenamesTo(targetPaths, fn) {
  const originalRenameSync = fs.renameSync;
  let count = 0;
  fs.renameSync = function patchedRenameSync(src, dest, ...rest) {
    if (targetPaths.includes(dest)) count += 1;
    return originalRenameSync.call(fs, src, dest, ...rest);
  };
  try {
    fn();
  } finally {
    fs.renameSync = originalRenameSync;
  }
  return count;
}

// ---------------------------------------------------------------------
// 1. Cache hit skips the durable rewrite: a second call with nothing
//    changed must not rewrite summary.json/index.json at all, but must
//    still return a fully, freshly recomputed summary.
// ---------------------------------------------------------------------
{
  const { dir, run } = freshRun();
  const { summaryPath, indexPath } = auditPaths(run.paths.runDir);

  const projection = summarizeTrustAudit(run, { persist: false });
  assert.equal(projection.eventCount, 0, "a read-only projection still reports an empty audit");
  assert.equal(fs.existsSync(path.dirname(summaryPath)), false, "a read-only projection creates no audit directory or empty log");

  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  const first = summarizeTrustAudit(run); // real (first-ever) write
  const onDiskFirst = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

  const renameCount = countRenamesTo([summaryPath, indexPath], () => {
    const second = summarizeTrustAudit(run);
    assert.equal(second.eventCount, first.eventCount, "a no-op call must still return the correct, freshly recomputed eventCount");
    assert.deepEqual(second.integrity, first.integrity, "a no-op call must still return the correct, freshly recomputed integrity");
    assert.deepEqual(second.byDecision, first.byDecision, "a no-op call must still return correct, freshly recomputed rollups");
  });
  assert.equal(renameCount, 0, "a no-op summarizeTrustAudit call must not rewrite summary.json/index.json on disk");

  const onDiskSecond = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(onDiskSecond.generatedAt, onDiskFirst.generatedAt, "on-disk summary.json must keep its previous generatedAt when nothing changed");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 2a. Cache miss on a real new event: a rewrite must happen and the new
//     on-disk generatedAt/content must reflect the change.
// ---------------------------------------------------------------------
{
  const { dir, run } = freshRun();
  const { summaryPath, indexPath } = auditPaths(run.paths.runDir);

  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  summarizeTrustAudit(run);
  const onDiskFirst = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "denied", source: "cw-validated", workerId: "w1" });
  const renameCount = countRenamesTo([summaryPath, indexPath], () => {
    summarizeTrustAudit(run);
  });
  assert.equal(renameCount, 2, "a real new event must trigger a real rewrite of both summary.json and index.json");

  const onDiskSecond = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(onDiskSecond.eventCount, 2, "the rewritten summary.json must reflect the new event count");
  assert.notEqual(onDiskSecond.generatedAt, onDiskFirst.generatedAt, "a real rewrite must carry a fresh generatedAt");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 2b. Cache miss on a run-state rollup change with NO new audit event:
//     mutating run.workers changes the `workers` rollup even though the
//     event log's bytes are untouched -- must still trigger a rewrite.
// ---------------------------------------------------------------------
{
  const { dir, run } = freshRun();
  const { summaryPath, indexPath } = auditPaths(run.paths.runDir);

  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  summarizeTrustAudit(run);

  run.workers = [{ id: "w1", taskId: "task-9", sandboxProfileId: "profile-9" }];
  const renameCount = countRenamesTo([summaryPath, indexPath], () => {
    const summary = summarizeTrustAudit(run);
    assert.equal(summary.workers[0].taskId, "task-9", "the recomputed summary must reflect the new run.workers rollup");
  });
  assert.equal(renameCount, 2, "a run-state rollup change with the same log bytes must still trigger a real rewrite");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 3. Fingerprint is fail-closed: corrupt sidecar content must fall back
//    to a real rewrite, not crash and not be trusted.
// ---------------------------------------------------------------------
{
  const { dir, run } = freshRun();
  const { summaryPath, indexPath, fingerprintPath } = auditPaths(run.paths.runDir);

  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  summarizeTrustAudit(run);
  fs.writeFileSync(fingerprintPath, "{ not valid json", "utf8");

  const renameCount = countRenamesTo([summaryPath, indexPath], () => {
    const summary = summarizeTrustAudit(run);
    assert.equal(summary.eventCount, 1, "the returned summary must still be correct despite the corrupt sidecar");
  });
  assert.equal(renameCount, 2, "a corrupt fingerprint sidecar must fall back to a real rewrite rather than crash or be trusted");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 4. Verification is never skipped: an early, non-tail tamper that does
//    NOT change the log's total byte length must still flip the SECOND
//    call's integrity.verified to false. This is the key regression
//    guard against the unsound (log size, tail hash) cache design this
//    cycle explicitly rejected.
// ---------------------------------------------------------------------
{
  const { dir, run } = freshRun();
  const { eventLogPath } = auditPaths(run.paths.runDir);

  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  const first = summarizeTrustAudit(run);
  assert.equal(first.integrity.verified, true, "a real untampered chain must verify");

  const sizeBefore = fs.statSync(eventLogPath).size;
  const lines = fs.readFileSync(eventLogPath, "utf8").split("\n").filter(Boolean);
  // Flip the FIRST event's decision in place with a same-length word
  // ("allowed" -> "revoked", both 7 letters), so the file's total size and
  // its LAST event's bytes are completely unchanged.
  assert.ok(lines[0].includes('"decision":"allowed"'), "the first event must be the one this test tampers with");
  const tamperedFirst = lines[0].replace('"decision":"allowed"', '"decision":"revoked"');
  assert.equal(tamperedFirst.length, lines[0].length, "the tamper must be a same-length in-place edit");
  lines[0] = tamperedFirst;
  fs.writeFileSync(eventLogPath, lines.join("\n") + "\n", "utf8");
  assert.equal(fs.statSync(eventLogPath).size, sizeBefore, "the tampered log must keep the exact same total byte size");

  const second = summarizeTrustAudit(run);
  assert.equal(second.integrity.verified, false, "an early, non-tail, same-length tamper must still be caught -- verification must never be skipped");

  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("trust-audit-summary-durable-write-skip-smoke: ok\n");
