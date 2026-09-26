#!/usr/bin/env node
// trust-audit-batch-throw — audit-batches program, PR 1
// (project/docs/intent/2026-09-archive.md, the audit-batches part). A
// withTrustAuditBatch body that records events and then throws must leave
// those events on disk, chained exactly as one-at-a-time appends would have
// chained them, and the body's own error must be the one that comes out.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { recordTrustAuditEvent, verifyTrustAudit, withTrustAuditBatch } = require("../../dist/shell/trust-audit");

function tmpRun(id) {
  return { id, paths: { runDir: fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-batch-throw-")) } };
}
const logOf = (run) => path.join(run.paths.runDir, "audit", "events.jsonl");
const eventsOf = (run) => fs.readFileSync(logOf(run), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const input = (n) => ({ kind: "worker.output", decision: "recorded", source: "cw-validated", workerId: `w${n}`, taskId: `t${n}` });

const batched = tmpRun("batch-throw-run");
const single = tmpRun("batch-throw-run");
try {
  // 1. A body that records two events, then throws: the error comes out and
  //    both events are on disk, with a whole chain.
  const boom = new Error("boom");
  assert.throws(
    () =>
      withTrustAuditBatch(batched, () => {
        recordTrustAuditEvent(batched, input(1));
        recordTrustAuditEvent(batched, input(2));
        throw boom;
      }),
    (error) => error === boom,
    "the body's own error is the one thrown"
  );
  const kept = eventsOf(batched);
  assert.equal(kept.length, 2, "events recorded before the throw are written");
  assert.equal(verifyTrustAudit(batched).verified, true, "the chain is whole");

  // 2. The same two events one at a time: same ids, same links in the chain.
  recordTrustAuditEvent(single, input(1));
  recordTrustAuditEvent(single, input(2));
  const one = eventsOf(single);
  assert.deepEqual(kept.map((e) => e.id), one.map((e) => e.id), "same ids as one-at-a-time appends");
  assert.equal(kept[1].prevEventHash, kept[0].eventHash, "the second event links to the first");
  assert.equal(kept[0].prevEventHash, one[0].prevEventHash, "the first event links to the same genesis");

  // 3. The next append (outside any batch) chains on to them.
  const next = recordTrustAuditEvent(batched, input(3));
  assert.equal(next.prevEventHash, kept[1].eventHash, "a later append chains on to the batch's last event");
  assert.equal(verifyTrustAudit(batched).verified, true);

  // 4. A body that returns is as before: its events are written once.
  const before = eventsOf(batched).length;
  assert.equal(withTrustAuditBatch(batched, () => { recordTrustAuditEvent(batched, input(4)); return "ok"; }), "ok");
  assert.equal(eventsOf(batched).length, before + 1);
  assert.equal(verifyTrustAudit(batched).verified, true);
} finally {
  fs.rmSync(batched.paths.runDir, { recursive: true, force: true });
  fs.rmSync(single.paths.runDir, { recursive: true, force: true });
}

process.stdout.write("trust-audit-batch-throw: ok\n");
