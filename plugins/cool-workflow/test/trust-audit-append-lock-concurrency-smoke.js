#!/usr/bin/env node
"use strict";

// trust-audit-append-lock-concurrency-smoke (robustness) —
// recordTrustAuditEvent used to do a read-modify-append with no lock,
// unlike every other read-modify-write in this codebase: two processes
// recording events for the SAME run at the same time could both read the
// same tail, compute the same prevEventHash, and both append — forking the
// hash chain. A forked chain fails verifyTrustAudit permanently, and
// (unlike a torn trailing write) is not a shape repairTrustAuditTornTail
// can fix, since the corruption isn't confined to the last line.
//
// Spawns several real child processes, each appending many events to the
// SAME run's audit log at the same time, and asserts the merged chain
// verifies clean with every event accounted for — no lost, no forked, AND
// no duplicate ids (createEventId's count used to be read OUTSIDE the
// lock, so concurrent writers could mint the SAME id for two different
// events even though the hash chain itself was correctly serialized — a
// real gap an earlier version of this exact test did not catch).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-lock-"));
const runId = "concurrent-audit-run";
const runDir = path.join(dir, "run");
fs.mkdirSync(runDir, { recursive: true });

const WORKERS = 6;
const EVENTS_PER_WORKER = 15;

const childScript = path.join(dir, "child.js");
fs.writeFileSync(
  childScript,
  [
    `const { recordTrustAuditEvent } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "trust-audit.js"))});`,
    `const run = { id: ${JSON.stringify(runId)}, paths: { runDir: ${JSON.stringify(runDir)} } };`,
    `const workerId = process.argv[2];`,
    `for (let i = 0; i < ${EVENTS_PER_WORKER}; i++) {`,
    `  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId, metadata: { i } });`,
    `}`,
  ].join("\n")
);

function spawnAllAndWait(procs) {
  return Promise.all(
    procs.map(
      (p) =>
        new Promise((resolve, reject) => {
          p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))));
          p.on("error", reject);
        })
    )
  );
}

(async () => {
  const children = [];
  for (let w = 0; w < WORKERS; w++) {
    children.push(spawn(node, [childScript, `w${w}`], { stdio: "inherit" }));
  }
  await spawnAllAndWait(children);

  const { verifyTrustAudit } = require(path.join(pluginRoot, "dist", "shell", "trust-audit.js"));
  const run = { id: runId, paths: { runDir } };
  const integrity = verifyTrustAudit(run);

  assert.equal(integrity.eventCount, WORKERS * EVENTS_PER_WORKER, `all ${WORKERS * EVENTS_PER_WORKER} events must be present, no lost writes (got ${integrity.eventCount})`);
  assert.equal(integrity.verified, true, `the merged chain must verify clean, no fork from concurrent appends: ${JSON.stringify(integrity.checks)}`);
  assert.equal(integrity.corruptLines, 0, "no corrupt/torn lines from concurrent writers");

  const logPath = path.join(runDir, "audit", "events.jsonl");
  const events = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const uniqueIds = new Set(events.map((e) => e.id));
  assert.equal(uniqueIds.size, events.length, `every event must have a unique id, got ${uniqueIds.size} unique out of ${events.length}`);

  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write("trust-audit-append-lock-concurrency-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
