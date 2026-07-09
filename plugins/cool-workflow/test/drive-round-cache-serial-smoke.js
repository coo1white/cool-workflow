#!/usr/bin/env node
"use strict";

// drive-round-cache-serial-smoke — perf cycle P1-3.
//
// The concurrent-round path (driveConcurrentRound) already shares ONE
// in-memory run object across a whole round via withRoundCache/loadRun's
// module-level cache (see shell/drive.ts). The SERIAL path (the common
// width===1 case: one task selected, dispatched, and accepted per outer-
// loop round) never used that cache: each round did roundWidth(loadRun),
// then driveStep's own loadRun, then (on dispatch) processSelectedTask's
// TWO MORE loadRun calls (once before dispatch, once reloading after the
// dispatch persist) -- 4 separate state.json reads for work that only
// needed the SAME run object, progressively mutated in place, since
// nothing else touches the file mid-round. Fixed by wrapping the whole
// per-round body (width check + serial/concurrent dispatch) in ONE
// withRoundCache scope, and making withRoundCache itself re-entrant (a
// nested call, e.g. driveConcurrentRound's own internal one, now reuses
// the outer seed instead of re-reading disk and re-clearing the cache
// early) -- so this also removes an extra read the CONCURRENT path had
// too (its own roundWidth check, taken before driveConcurrentRound's
// self-contained cache existed).
//
// Proven with a deterministic read-count (not wall-clock — see cycle
// P1-2's own note on why: this repo's full test suite runs many smokes
// concurrently, and timing assertions are flaky under that load). The
// exact counts below (4, 4, 4-per-round) are all specific to a round
// where the dispatched task starts "pending" (a fresh dispatch, which
// triggers processSelectedTask's post-dispatch reload) -- an adversarial
// review confirmed these numbers by direct measurement, and separately
// confirmed reverting either half of the fix regresses the count (7 with
// both reverted, 5 with only the re-entrancy guard reverted on the
// concurrent path) -- so this test's exact-equality assertions actually
// discriminate a partial regression, not just a gross one.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { drive } = require(path.join(pluginRoot, "dist/shell/drive"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline"));
const api = require(path.join(pluginRoot, "dist/core/workflow-apps/app-schema"));

function writeStub(file) {
  const fence = String.fromCharCode(96).repeat(3);
  const lines = [
    'const fs = require("fs");',
    "const rp = process.argv[2];",
    `const body = "# R\\n\\n" + ${JSON.stringify(fence)} + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + ${JSON.stringify(fence)} + "\\n";`,
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 1, output_tokens: 1 } }));',
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function countStateReads(statePath, fn) {
  const originalReadFileSync = fs.readFileSync;
  let count = 0;
  fs.readFileSync = function patchedReadFileSync(file, ...rest) {
    if (file === statePath) count += 1;
    return originalReadFileSync.call(fs, file, ...rest);
  };
  try {
    return { result: fn(), count };
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
}

const cwd0 = process.cwd();

// ---------------------------------------------------------------------
// 1. Serial round (width===1, the common case): one pending task, one
//    outer-loop round (once:true) dispatches AND accepts it.
// ---------------------------------------------------------------------
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-roundcache-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  try {
    process.chdir(work);
    const p = plan(loadWorkflowApp("end-to-end-golden-path"), { repo: work, question: "round cache" });
    const stub = writeStub(path.join(work, "stub.js"));
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag" };

    const { result, count } = countStateReads(p.paths.state, () => drive(p.id, work, { once: true, now: "2026-07-01T00:00:00.000Z", agentConfig }));

    assert.equal(result.steps.length, 1, "one serial round produces exactly one step (dispatch+accept collapsed into it)");
    assert.equal(result.steps[0].status, "ok", "the task is accepted in this one round, unaffected by the cache change");
    // Measured live: 7 reads before this fix (1 pre-loop + 4 in-round + 1
    // emitPhaseProgress + 1 post-loop), 4 after (1 pre-loop + 1 in-round,
    // shared + 1 emitPhaseProgress + 1 post-loop).
    assert.equal(count, 4, `one serial round read state.json ${count} times, expected exactly 4 (was 7 before this fix)`);
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------
// 2. Concurrent round (width>1, driveConcurrentRound): 2 tasks in one
//    parallel() phase, --concurrency 2. This path already had its OWN
//    round-cache before this fix, but its outer roundWidth check did NOT
//    -- and this fix's re-entrancy guard is what lets that outer wrap
//    coexist with driveConcurrentRound's own inner withRoundCache call
//    without either re-seeding or clearing early. Measured live: 5 reads
//    with the re-entrancy guard alone reverted (driveConcurrentRound's
//    inner call re-seeds from disk instead of reusing the outer seed),
//    4 with it in place.
// ---------------------------------------------------------------------
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-roundcache-conc-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  try {
    process.chdir(work);
    const stub = writeStub(path.join(work, "stub.js"));
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag" };
    const def = api.workflow({
      id: "p13-concurrent-roundcache-probe",
      title: "p13-concurrent-roundcache-probe",
      limits: { maxAgents: 2, maxConcurrentAgents: 2 },
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.parallel("Fan", [api.agent("t1", "probe 1"), api.agent("t2", "probe 2")])],
    });
    const p = plan({ id: def.id, title: def.title, summary: "", version: "0.0.1", workflow: def, sandboxProfiles: [], sourcePath: path.join(work, `${def.id}.app.json`) }, { repo: work });
    assert.equal(p.tasks.length, 2, "both tasks are in one parallel phase");

    const { result, count } = countStateReads(p.paths.state, () => drive(p.id, work, { once: true, concurrency: 2, now: "2026-07-01T00:00:00.000Z", agentConfig }));

    assert.equal(result.steps.length, 2, "one concurrent round produces exactly 2 steps, both tasks dispatched+accepted in the same round");
    assert.deepEqual(
      result.steps.map((s) => s.status).sort(),
      ["ok", "ok"],
      "both tasks accepted in this one round"
    );
    assert.equal(count, 4, `one concurrent round of 2 tasks read state.json ${count} times, expected exactly 4 (was 5 with only the re-entrancy guard reverted)`);
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------
// 3. Cache correctly resets BETWEEN rounds: a 2-phase, 2-task serial app
//    driven by 2 separate once:true calls must each read state.json
//    exactly 4 times AND correctly select the phase's OWN still-pending
//    task, not a stale or leaked-across-rounds cache entry.
// ---------------------------------------------------------------------
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-roundcache-multi-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  try {
    process.chdir(work);
    const stub = writeStub(path.join(work, "stub.js"));
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag" };
    const def = api.workflow({
      id: "p13-multiround-roundcache-probe",
      title: "p13-multiround-roundcache-probe",
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.phase("PhaseA", [api.agent("t1", "probe 1")]), api.phase("PhaseB", [api.agent("t2", "probe 2")])],
    });
    const p = plan({ id: def.id, title: def.title, summary: "", version: "0.0.1", workflow: def, sandboxProfiles: [], sourcePath: path.join(work, `${def.id}.app.json`) }, { repo: work });

    const round1 = countStateReads(p.paths.state, () => drive(p.id, work, { once: true, now: "2026-07-01T00:00:00.000Z", agentConfig }));
    const round2 = countStateReads(p.paths.state, () => drive(p.id, work, { once: true, now: "2026-07-01T00:01:00.000Z", agentConfig }));

    assert.equal(round1.result.steps[0].taskId, "t1", "round 1 selects PhaseA's task");
    assert.equal(round2.result.steps[0].taskId, "t2", "round 2's freshly re-seeded cache correctly selects PhaseB's task, not a stale round-1 view");
    assert.equal(round1.count, 4, `round 1 read state.json ${round1.count} times, expected exactly 4`);
    assert.equal(round2.count, 4, `round 2 read state.json ${round2.count} times, expected exactly 4 -- a leaked-across-rounds cache would read fewer or select the wrong task`);
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------
// 4. A full (non-once) drive to completion must produce byte-identical
//    status/steps/commit output to before this fix -- the cache change
//    must only remove redundant reads, never change what gets decided or
//    written.
// ---------------------------------------------------------------------
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-roundcache-full-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  try {
    process.chdir(work);
    const p = plan(loadWorkflowApp("end-to-end-golden-path"), { repo: work, question: "round cache full" });
    const stub = writeStub(path.join(work, "stub.js"));
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag" };
    const result = drive(p.id, work, { now: "2026-07-01T00:00:00.000Z", agentConfig });

    assert.equal(result.status, "complete", "a full drive with a working stub still reaches complete");
    assert.equal(result.completedWorkers, 1, "the one worker is still recorded completed");
    assert.equal(result.parkedWorkers, 0, "nothing parks");
    assert.ok(result.commitId, "a terminal commit is still recorded");
    assert.deepEqual(
      result.steps.map((s) => ({ action: s.action, status: s.status })),
      [
        { action: "accept", status: "ok" },
        { action: "commit", status: "complete" },
      ],
      "the exact same 2-step sequence (accept then commit) is produced"
    );
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

process.stdout.write("drive-round-cache-serial-smoke: ok\n");
