#!/usr/bin/env node
"use strict";

// trust-audit-torn-tail-append-smoke -- finding B5 (#15).
//
// durableAppendFileSync only ever ADDS bytes at the current end of the log
// and never writes a separator of its own. A COMPLETED append always leaves
// the log ending in "\n"; a crash mid-append can leave the last line torn --
// its final "\n" never landing on disk. On the next run, recordTrustAuditEvent
// (the resume) used to append the new, already-cross-linked event DIRECTLY
// onto that partial byte-run, MERGING the two into one line that no longer
// parses. That lost THIS event AND poisoned the forward chain (the next
// append's prevEventHash pointed into an unparseable blob), corrupting the
// chain with no repair for that shape.
//
// The fix: under the same lock, recordTrustAuditEvent now checks the log's
// last byte and prepends a "\n" when the log does not already end in one, so
// the new event lands on its own clean line and stays parseable.
//
// This proves the FIXED behavior: after a torn tail (no trailing newline), the
// next appended event is still parseable AND the chain verifies. Against the
// unfixed code the two lines merge, so the log has 0 parseable events and
// verification fails -- this test FAILS before the fix, PASSES after.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { recordTrustAuditEvent, verifyTrustAudit, listTrustAuditEvents } = require(path.join(pluginRoot, "dist/shell/trust-audit.js"));

function freshRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-torn-tail-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  return { dir, run: { id: "torn-tail-run", paths: { runDir } } };
}
function logPathOf(run) {
  return path.join(run.paths.runDir, "audit", "events.jsonl");
}

// ---------------------------------------------------------------------
// 1. A crash-torn last line (a COMPLETE event whose trailing "\n" never
//    landed) must NOT merge with the next appended event. The new event
//    stays parseable and the whole chain still verifies.
// ---------------------------------------------------------------------
{
  const { dir, run } = freshRun();
  const logPath = logPathOf(run);

  const a = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });

  // Simulate a torn write: the append's bytes are all present but the final
  // "\n" never reached disk, so the log ends mid-boundary.
  const withNewline = fs.readFileSync(logPath, "utf8");
  assert.ok(withNewline.endsWith("\n"), "a completed append leaves the log ending in a newline");
  fs.writeFileSync(logPath, withNewline.slice(0, -1)); // drop the trailing "\n" -> torn tail
  assert.ok(!fs.readFileSync(logPath, "utf8").endsWith("\n"), "the log now ends WITHOUT a newline (torn)");

  // The resume: append the next event. It must land on its own clean line.
  const b = recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "denied", source: "cw-validated", workerId: "w2" });

  const events = listTrustAuditEvents(run);
  assert.equal(events.length, 2, "both events must be parseable -- the torn tail must NOT have merged with the new event");
  assert.equal(events[0].id, a.id, "the first (torn-then-recovered) event is still the first line");
  assert.equal(events[1].id, b.id, "the newly appended event is its own parseable line");
  assert.equal(events[1].prevEventHash, a.eventHash, "the new event is correctly cross-linked to the prior event");

  const integrity = verifyTrustAudit(run);
  assert.equal(integrity.verified, true, "the chain verifies after appending onto a torn tail");
  assert.equal(integrity.corruptLines, 0, "no corrupt/merged line remains");
  assert.equal(integrity.chained, 2, "both events are chained");

  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("trust-audit-torn-tail-append-smoke: ok\n");
