#!/usr/bin/env node
"use strict";

// batch-output-overflow-smoke — a verbose agent in a concurrent batch must
// never strand its siblings. Before this fix, the batch delegate child
// buffered EVERY job's stdout in memory and printed one JSON array only once
// every job had settled; the parent's spawnSync capped its OWN captured
// stdout at a flat 512MB regardless of batch size. Once combined job output
// crossed that cap, spawnSync threw ENOBUFS and EVERY job in the batch (not
// just the big ones) was marked failed — a real repro: 25 jobs x 30MB output
// permanently parked all 25, 0 completed. The fix streams one NDJSON line per
// job the instant it settles, so a job whose line already arrived keeps its
// real outcome regardless of what happens to the rest of the batch.
//
// Two scenarios:
//   1. Unit-level: feed reconcileBatchOutcomes a synthetic delegate stdout
//      with one complete line, one missing index, and one truncated
//      (mid-kill) trailing line, alongside a synthetic batch-level error —
//      the sharpest, fastest regression guard for the reconciliation logic.
//   2. Integration-level: a REAL 5-job batch through runAgentBatchOutcomes —
//      2 small jobs, 2 jobs each returning ~25MB of output, 1 forced hang —
//      proves large output doesn't strand small siblings, and a per-job kill
//      is still distinguishable from a batch-wide reconciliation miss.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { reconcileBatchOutcomes, runAgentBatchOutcomes } = require(path.join(pluginRoot, "dist/execution-backend/agent.js"));

function unitLevelReconciliation() {
  const jobs = [{}, {}, {}]; // reconcileBatchOutcomes only reads jobs.length
  const child = {
    error: new Error("spawnSync ENOBUFS"),
    status: null,
    // index 0: one complete NDJSON line. index 1: no line at all (never
    // arrived). index 2: a line truncated mid-write by a hard kill — dropped
    // by the unconditional "pop the trailing segment" rule, never parsed.
    stdout: '{"i":0,"exitCode":0,"stdout":"a"}\n{"i":2,"exitCo'
  };
  const settled = reconcileBatchOutcomes(jobs, child);
  assert.equal(settled.length, 3, "outcomes array stays index-aligned with jobs");
  assert.deepEqual(settled[0], { exitCode: 0, stdout: "a" }, "a fully-streamed line recovers its real outcome");
  assert.equal(settled[1].exitCode, null, "a job whose line never arrived fails closed");
  assert.match(settled[1].spawnError, /batch delegate failed: spawnSync ENOBUFS/, "missing-line failure carries the batch-level reason");
  assert.equal(settled[2].exitCode, null, "a truncated trailing line fails closed, not a parse crash");
  assert.match(settled[2].spawnError, /batch delegate failed: spawnSync ENOBUFS/, "truncated-line failure carries the batch-level reason");
  console.log("batch-output-overflow-smoke: reconcileBatchOutcomes recovers per-line, fails closed per-line ok");
}

function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const resultPath = process.argv[2];",
    "const behavior = process.argv[3];",
    'if (behavior === "hang") {',
    "  setInterval(() => {}, 1000);",
    '} else if (behavior === "big") {',
    '  const chunk = "x".repeat(1024 * 1024);',
    "  let remaining = 25 * 1024 * 1024;",
    "  while (remaining > 0) {",
    "    const n = Math.min(chunk.length, remaining);",
    "    fs.writeSync(1, chunk.slice(0, n));",
    "    remaining -= n;",
    "  }",
    '  process.stdout.write(JSON.stringify({ model: "stub-m" }));',
    "  process.exit(0);",
    "} else {",
    '  process.stdout.write(JSON.stringify({ model: "stub-m" }));',
    "  process.exit(0);",
    "}"
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function integrationLevelLargeOutput() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-batch-overflow-")));
  try {
    const stub = writeStub(path.join(work, "stub.js"));
    const jobFor = (behavior, timeoutMs) => ({
      binary: process.execPath,
      args: [stub, path.join(work, `${behavior}-result.md`), behavior],
      cwd: work,
      timeoutMs
    });
    // index 0,1: small quick jobs. index 2: forced hang. index 3,4: ~25MB output each.
    const jobs = [
      jobFor("small", 10000),
      jobFor("small", 10000),
      jobFor("hang", 500),
      jobFor("big", 10000),
      jobFor("big", 10000)
    ];
    const settled = runAgentBatchOutcomes(jobs);
    assert.equal(settled.length, 5, "outcomes stay index-aligned with the 5-job batch");

    for (const index of [0, 1]) {
      assert.equal(settled[index].exitCode, 0, `small job ${index} exits 0`);
      assert.equal(settled[index].spawnError, undefined, `small job ${index} carries no spawnError`);
      assert.match(settled[index].stdout, /stub-m/, `small job ${index} keeps its real stdout`);
    }
    for (const index of [3, 4]) {
      assert.equal(settled[index].exitCode, 0, `big job ${index} exits 0 despite ~25MB of output`);
      assert.equal(settled[index].spawnError, undefined, `big job ${index} carries no spawnError`);
      assert.ok(settled[index].stdout.length > 20 * 1024 * 1024, `big job ${index} output was not truncated or lost (got ${settled[index].stdout.length} bytes)`);
    }
    // A per-job kill settles via the normal close handler (exitCode:null, no
    // spawnError) — distinct from the reconciliation-miss fail-closed default
    // (which DOES set spawnError). This distinguishes "one job was killed" from
    // "the whole batch's output was lost."
    assert.equal(settled[2].exitCode, null, "the hung job is killed and reports no exit code");
    assert.equal(settled[2].spawnError, undefined, "a per-job kill is not a batch-wide reconciliation miss");
    console.log("batch-output-overflow-smoke: large output in a batch never strands its small siblings ok");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  unitLevelReconciliation();
  integrationLevelLargeOutput();
  console.log("batch-output-overflow-smoke: ok (streamed NDJSON recovers per-job outcomes even under batch-level failure)");
}

main();
