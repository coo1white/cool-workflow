#!/usr/bin/env node
"use strict";

// concurrent-failure-semantics-smoke (Track 2) — the build-map acceptance test:
// of 16 concurrent agents force 1 HANG + 1 CRASH + 1 DIRTY-RETURN; the run must
// not deadlock or corrupt disk, and the recorded state must replay "who passed /
// who failed" completely. Locked decisions:
//   COLLECT-ALL — a failing hop never aborts its siblings: all 13 good hops are
//     accepted in the SAME round as the 3 failures; failure only blocks the
//     phase gate afterwards.
//   KILL + COUNT — the hung agent is SIGTERM'd at the per-job deadline by the
//     batch delegate child and counted as ONE failure (no exit code → the
//     existing fail-closed refusal → retryOrPark), semantically identical to a
//     crash.
// Also proves REAL wall-clock parallelism (13 × 2.5s good agents + a 3.5s-killed
// hang complete far under the ~36s a serial round would need) and DETERMINISTIC
// record order (results land in batch task order, not completion order).
//
// Hermetic: one stub agent binary; behavior is selected per task via a
// BEHAVIOR=... token in the task prompt (read back from the worker's input.md).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const lifecycle = require(path.join(pluginRoot, "dist/orchestrator/lifecycle-operations.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const cwd0 = process.cwd();

const TOTAL = 16;
const HANG_ID = "map:t14";
const CRASH_ID = "map:t15";
const DIRTY_ID = "map:t16";
const GOOD_MS = 2500;
const TIMEOUT_MS = 3500;

function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    'const path = require("path");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'let input = "";',
    'try { input = fs.readFileSync(path.join(path.dirname(rp), "input.md"), "utf8"); } catch { process.exit(9); }',
    "const m = input.match(/BEHAVIOR=([a-z]+)/);",
    "const behavior = m ? m[1] : null;",
    'const timingLog = process.env.CW_TIMING_LOG || "";',
    "function mark(event) { if (timingLog) fs.appendFileSync(timingLog, JSON.stringify({ event, behavior, pid: process.pid, time: Date.now() }) + '\\n'); }",
    'mark("start");',
    "if (behavior === \"hang\") { setInterval(() => {}, 1000); }",
    'else if (behavior === "crash") { mark("end"); process.stderr.write("agent boom"); process.exit(1); }',
    'else if (behavior === "dirty") { fs.writeFileSync(rp, "# R\\n\\n" + fence + "cw:result\\n{ not json ::: \\n" + fence + "\\n"); mark("end"); process.stdout.write(JSON.stringify({ model: "stub-m" })); }',
    'else if (behavior === "good") { setTimeout(() => { const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "ok", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n"; fs.writeFileSync(rp, body); mark("end"); process.stdout.write(JSON.stringify({ model: "stub-m", usage: { input_tokens: 4, output_tokens: 2 } })); process.exit(0); }, ' +
      String(GOOD_MS) +
      "); }",
    "else { process.exit(9); }"
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function behaviorFor(taskId) {
  if (taskId === HANG_ID) return "hang";
  if (taskId === CRASH_ID) return "crash";
  if (taskId === DIRTY_ID) return "dirty";
  return "good";
}

function buildAppRecord(work) {
  const taskIds = [];
  for (let i = 1; i <= TOTAL; i++) taskIds.push(`map:t${String(i).padStart(2, "0")}`);
  const tasks = taskIds.map((id) => ({
    id,
    kind: "agent",
    status: "pending",
    prompt: `Probe the repo. BEHAVIOR=${behaviorFor(id)}`
  }));
  return {
    record: {
      app: {
        schemaVersion: 1,
        id: "t2-acceptance",
        title: "Track 2 acceptance",
        version: "0.0.1",
        workflow: {
          id: "t2-acceptance",
          title: "Track 2 acceptance",
          summary: "16 concurrent agents: 1 hang + 1 crash + 1 dirty",
          limits: { maxAgents: TOTAL, maxConcurrentAgents: TOTAL },
          inputs: [{ name: "repo", type: "path", required: true }],
          phases: [{ id: "fan", name: "Fan", status: "pending", mode: "parallel", tasks }]
        }
      },
      source: { kind: "manifest", path: path.join(work, "app.json"), manifestPath: path.join(work, "app.json") }
    },
    taskIds
  };
}

function main() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-t2-accept-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const { record, taskIds } = buildAppRecord(work);
    const run = lifecycle.plan(record, { repo: work });
    assert.equal(run.tasks.length, TOTAL, `planned ${TOTAL} tasks`);

    const timingLog = path.join(work, "concurrent-timing.jsonl");
    process.env.CW_TIMING_LOG = timingLog;
    const started = Date.now();
    const result = drive(runner, run.id, {
      now: FIXED_NOW,
      concurrency: TOTAL,
      policy: { maxAttempts: 1 },
      agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag", timeoutMs: TIMEOUT_MS }
    });
    const elapsed = Date.now() - started;
    delete process.env.CW_TIMING_LOG;

    // ---- no deadlock + REAL parallelism ------------------------------------
    assertConcurrentTiming(readTimingLog(timingLog));
    console.log(`t2-acceptance: 16-agent round, no deadlock, wall ${elapsed}ms ok`);

    // ---- collect-all: all 13 good accepted DESPITE 3 failures in-round ------
    assert.equal(result.completedWorkers, TOTAL - 3, "all 13 good hops accepted (collect-all)");
    assert.equal(result.parkedWorkers, 3, "exactly the hang+crash+dirty hops parked");
    assert.equal(result.status, "parked", "run ends parked (failures block the phase gate)");
    const acceptSteps = result.steps.filter((s) => s.action === "accept" && s.status === "ok");
    assert.equal(acceptSteps.length, TOTAL - 3, "13 accept steps in the round");
    console.log("t2-acceptance: collect-all (13 accepted alongside 3 failures) ok");

    // ---- kill + count: each failure mode parked with its OWN recorded reason -
    const parkSteps = result.steps.filter((s) => s.action === "park");
    assert.equal(parkSteps.length, 3, "three park steps");
    const reasonOf = (taskId) => (parkSteps.find((s) => s.taskId === taskId) || {}).reason || "";
    assert.match(reasonOf(HANG_ID), /no exit code|timed out/i, "hang killed by timeout and counted as one failure");
    assert.match(reasonOf(CRASH_ID), /failed/i, "crash recorded as a failed hop");
    assert.match(reasonOf(DIRTY_ID), /Invalid cw:result JSON/i, "dirty return rejected at the accept layer");
    console.log("t2-acceptance: hang killed+counted, crash counted, dirty rejected ok");

    // ---- deterministic record order (task order, not completion order) ------
    const recordedOrder = result.steps.filter((s) => s.action === "accept" || s.action === "park").map((s) => s.taskId);
    const expectedOrder = taskIds.filter((id) => recordedOrder.includes(id));
    assert.deepEqual(recordedOrder, expectedOrder, "results recorded in deterministic batch task order");
    console.log("t2-acceptance: deterministic record order ok");

    // ---- no disk corruption + replay answers who passed / who failed --------
    const stateRaw = fs.readFileSync(run.paths.state, "utf8");
    const reloaded = JSON.parse(stateRaw); // parses ⇒ not corrupted
    const completedIds = reloaded.tasks.filter((t) => t.status === "completed").map((t) => t.id).sort();
    const failedIds = reloaded.tasks.filter((t) => t.status === "failed").map((t) => t.id).sort();
    assert.equal(completedIds.length, TOTAL - 3, "replay: 13 completed recorded on disk");
    assert.deepEqual(failedIds, [HANG_ID, CRASH_ID, DIRTY_ID].sort(), "replay: exactly the 3 forced failures recorded failed");
    for (const id of completedIds) {
      const task = reloaded.tasks.find((t) => t.id === id);
      assert.ok(task.resultPath && fs.existsSync(task.resultPath), `replay: accepted result.md on disk for ${id}`);
    }
    console.log("t2-acceptance: state replays who passed / who failed, no corruption ok");
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log("concurrent-failure-semantics-smoke: ok (collect-all; hang killed+counted; no deadlock; deterministic order; replay-complete)");
}

function readTimingLog(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function assertConcurrentTiming(events) {
  const starts = events.filter((event) => event.event === "start");
  const goodStarts = starts.filter((event) => event.behavior === "good").map((event) => event.time).sort((a, b) => a - b);
  const goodEnds = events.filter((event) => event.event === "end" && event.behavior === "good").map((event) => event.time).sort((a, b) => a - b);
  assert.equal(starts.length, TOTAL, "every worker process recorded a start");
  assert.equal(goodStarts.length, TOTAL - 3, "all good workers recorded starts");
  assert.equal(goodEnds.length, TOTAL - 3, "all good workers recorded ends");
  assert.ok(goodStarts[goodStarts.length - 1] < goodEnds[0], "good worker intervals overlap, proving concurrent dispatch");
  assert.ok(starts.some((event) => event.behavior === "hang"), "hung worker recorded a start");
  assert.ok(starts.some((event) => event.behavior === "crash"), "crashed worker recorded a start");
  assert.ok(starts.some((event) => event.behavior === "dirty"), "dirty worker recorded a start");
}

main();
