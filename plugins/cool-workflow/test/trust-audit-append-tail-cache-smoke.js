#!/usr/bin/env node
"use strict";

// trust-audit-append-tail-cache-smoke — perf cycle P1-2.
//
// recordTrustAuditEvent used to re-parse the ENTIRE events.jsonl log on
// EVERY append just to learn the prior event count and the last event's
// hash — O(events) per append, O(events^2) over a run's life (a live
// audit measured ~80ms/append at 50k events). Fixed with a small sidecar
// tail cache ({logBytes, count, lastHash}) keyed on the log's own byte
// size: a size match trusts the cache (O(1)); any mismatch (a repair, a
// torn write, no cache yet) falls back to the full parse, same as before
// this cache existed — fail closed, never guessed.
//
// This proves: (1) the cache is actually used and materially faster, not
// just correct-by-coincidence; (2) the chain stays correctly linked
// through a cache hit; (3) a stale/tampered cache is ignored, not trusted;
// (4) repair invalidates the cache so the next append re-derives truth.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { recordTrustAuditEvent, repairTrustAuditTornTail } = require(path.join(pluginRoot, "dist/shell/trust-audit.js"));

function freshRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-tailcache-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  return { dir, run: { id: "tailcache-run", paths: { runDir } }, runDir };
}
function auditPaths(runDir) {
  const auditDir = path.join(runDir, "audit");
  return { auditDir, eventLogPath: path.join(auditDir, "events.jsonl"), tailCachePath: path.join(auditDir, "tail-cache.json") };
}
// A big pre-built log the real recordTrustAuditEvent code never wrote --
// each line only needs a valid, parseable eventHash for the append path
// (it reads prior[last].eventHash, never validates the whole chain).
// Padded so total size lands in the tens-of-MB range the original audit
// measured a real, clearly-distinguishable parse cost at.
function writeSyntheticLog(eventLogPath, lineCount, padBytes) {
  fs.mkdirSync(path.dirname(eventLogPath), { recursive: true });
  const pad = "x".repeat(padBytes);
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(JSON.stringify({ id: `synthetic-${i}`, eventHash: i === lineCount - 1 ? "tailhash0000" : `hash-${i}`, pad }));
  }
  fs.writeFileSync(eventLogPath, lines.join("\n") + "\n", "utf8");
}

// ---------------------------------------------------------------------
// 1. The cache is actually used: appending right after a huge synthetic
//    log falls back to exactly one full read (no cache yet); appending
//    AGAIN right after does NOT re-read the log at all (the first append
//    just populated the cache). Proven by counting real fs.readFileSync
//    calls against the log path -- a functional proof, not a wall-clock
//    race (a timing-based version of this assertion was flaky under the
//    full suite's concurrent load: both the cache-hit and cache-miss
//    paths slow down together under contention, shrinking their ratio).
//    The chain still links correctly through the cache hit.
// ---------------------------------------------------------------------
{
  const { dir, run, runDir } = freshRun();
  const { eventLogPath } = auditPaths(runDir);
  const LINES = 20000;
  writeSyntheticLog(eventLogPath, LINES, 500); // ~10MB, matching the audit's own measured scale

  const originalReadFileSync = fs.readFileSync;
  let logReadCount = 0;
  fs.readFileSync = function patchedReadFileSync(file, ...rest) {
    if (file === eventLogPath) logReadCount += 1;
    return originalReadFileSync.call(fs, file, ...rest);
  };
  let first, second;
  try {
    first = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
    assert.equal(logReadCount, 1, "the first append after a big log with no cache must read the log exactly once (falls back to a full parse)");

    second = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
    assert.equal(logReadCount, 1, "the second append must NOT re-read the log at all -- it must be served entirely from the cache the first append just populated");
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  assert.equal(second.prevEventHash, first.eventHash, "the cache-hit append must still link to the PRIOR real event's actual hash");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 2. Fail closed: a tampered/stale cache (wrong logBytes) is ignored, not
//    trusted -- the append still falls back to a full parse and produces
//    the CORRECT prevEventHash from the real last line, not the cache's
//    wrong one.
// ---------------------------------------------------------------------
{
  const { dir, run, runDir } = freshRun();
  const { eventLogPath, tailCachePath } = auditPaths(runDir);
  writeSyntheticLog(eventLogPath, 50, 10);
  fs.writeFileSync(
    tailCachePath,
    JSON.stringify({ schemaVersion: 1, logBytes: 999999999, count: 4, lastHash: "wrong-hash-should-never-be-used" }),
    "utf8"
  );

  const event = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  assert.equal(event.prevEventHash, "tailhash0000", "a size-mismatched cache must be ignored; the real last line's hash must be used");
  assert.equal(event.id, "audit-sandbox.path-0051", "the real prior count (50), not the tampered cache's count (4), must be used");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------
// 3. Repair invalidates the cache: appending right after a --write repair
//    must not trust a stale pre-repair cache entry.
// ---------------------------------------------------------------------
{
  const { dir, run, runDir } = freshRun();
  const { eventLogPath, tailCachePath } = auditPaths(runDir);

  // Two real, properly-chained events, then a torn (unparseable) trailing line.
  const e1 = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  const e2 = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  void e1;
  fs.appendFileSync(eventLogPath, '{"id":"torn-partial", "eventHash":"incomple');
  assert.ok(fs.existsSync(tailCachePath), "the cache must exist after 2 real appends");

  const repairResult = repairTrustAuditTornTail(run, { write: true });
  assert.equal(repairResult.outcome, "repaired");
  assert.ok(!fs.existsSync(tailCachePath), "repair must invalidate (delete) the tail cache, not leave a stale entry behind");

  const e3 = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  assert.equal(e3.prevEventHash, e2.eventHash, "the append right after a repair must link to the REAL (post-repair) last event, not a stale cached one");
  assert.equal(e3.id, "audit-sandbox.path-0003", "the append right after a repair must see the real (post-repair) count of 2 prior events");

  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("trust-audit-append-tail-cache-smoke: ok\n");
