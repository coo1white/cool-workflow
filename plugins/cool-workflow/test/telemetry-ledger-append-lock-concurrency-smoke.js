#!/usr/bin/env node
"use strict";

// telemetry-ledger-append-lock-concurrency-smoke (robustness) —
// appendTelemetryAttestation used to do a read-modify-write with NO lock,
// unlike every other read-modify-write in this codebase: it loads the whole
// ledger, pushes one record, and `writeJson` atomically REPLACES the file.
// Two processes appending for the SAME run at once both read the same
// N-record file, both compute a record at chain position N+1, and both do a
// full-file atomic write — the last rename WINS and silently discards the
// loser's record. The surviving file is a self-consistent chain (each writer
// linked its own record correctly), so `verifyTelemetryLedger` still reports
// `verified:true` — the loss is invisible. The only witness is the record
// COUNT: fewer records land than were appended.
//
// Spawns several real child processes, each appending many attestation
// records to the SAME run's ledger at the same time, and asserts EVERY
// appended record is present (no lost write) AND the merged chain verifies
// clean. Against the unlocked code the count comes up short (records lost);
// under the withFileLock fix the load->append->write is serialized so every
// record survives and the chain is a single unbroken line.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const ledgerIoPath = path.join(pluginRoot, "dist", "shell", "telemetry-ledger-io.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-tel-ledger-lock-"));
const runId = "concurrent-telemetry-run";
const runDir = path.join(dir, "run");
fs.mkdirSync(runDir, { recursive: true });

const WORKERS = 6;
const RECORDS_PER_WORKER = 25;

const childScript = path.join(dir, "child.js");
fs.writeFileSync(
  childScript,
  [
    `const { appendTelemetryAttestation } = require(${JSON.stringify(ledgerIoPath)});`,
    `const run = { id: ${JSON.stringify(runId)}, paths: { runDir: ${JSON.stringify(runDir)} } };`,
    `const workerId = process.argv[2];`,
    `for (let i = 0; i < ${RECORDS_PER_WORKER}; i++) {`,
    `  appendTelemetryAttestation(run, {`,
    `    workerId,`,
    `    taskId: workerId + "-t" + i,`,
    `    promptDigest: "sha256:p" + i,`,
    `    reportedUsage: { input_tokens: 4, output_tokens: 2 },`,
    `    usageSignature: "sig",`,
    `    attestation: "attested",`,
    `  });`,
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

  const { verifyTelemetryLedger } = require(ledgerIoPath);
  const run = { id: runId, paths: { runDir } };
  const v = verifyTelemetryLedger(run);

  const expected = WORKERS * RECORDS_PER_WORKER;
  assert.equal(v.present, true, "ledger present after concurrent appends");
  assert.equal(v.records.length, expected, `all ${expected} appended records must be present, no lost writes (got ${v.records.length})`);
  assert.equal(v.verified, true, `the merged chain must verify clean, no fork/break from concurrent appends: ${JSON.stringify(v.checks)}`);

  // recordId is chain-position based (`tel-NNN`), so a clean serialized chain
  // has one record per position with no repeats. A lost update would drop a
  // position; a fork would repeat one.
  const ids = v.records.map((r) => r.recordId);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, `every record must hold a unique chain-position id, got ${uniqueIds.size} unique out of ${ids.length}`);

  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write("telemetry-ledger-append-lock-concurrency-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
