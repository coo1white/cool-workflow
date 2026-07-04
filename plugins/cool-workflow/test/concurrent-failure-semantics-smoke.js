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
// v2 repoint: the old flat dist/orchestrator.js CoolWorkflowRunner facade +
// dist/orchestrator/lifecycle-operations.js plan() collapse into the pure
// shell/pipeline.js plan(app, inputs) (no runner object); dist/drive.js moves
// to shell/drive.js with the signature drive(runId, cwd, opts). The old
// LoadedWorkflowApp was a {app:{workflow,...}, source} record; v2's
// LoadedWorkflowApp is a FLAT {id,title,summary,version,workflow,
// sandboxProfiles,sourcePath}, so buildApp() (below) builds the flat shape.
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));

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

function buildApp(work) {
  const taskIds = [];
  for (let i = 1; i <= TOTAL; i++) taskIds.push(`map:t${String(i).padStart(2, "0")}`);
  const tasks = taskIds.map((id) => ({
    id,
    kind: "agent",
    status: "pending",
    prompt: `Probe the repo. BEHAVIOR=${behaviorFor(id)}`
  }));
  // v2 FLAT LoadedWorkflowApp (id/title/summary/version/workflow/
  // sandboxProfiles/sourcePath); plan() reads app.workflow directly (the old
  // build read appRecord.app.workflow through the {app,source} record).
  return {
    app: {
      id: "t2-acceptance",
      title: "Track 2 acceptance",
      summary: "16 concurrent agents: 1 hang + 1 crash + 1 dirty",
      version: "0.0.1",
      sandboxProfiles: [],
      sourcePath: path.join(work, "app.json"),
      workflow: {
        id: "t2-acceptance",
        title: "Track 2 acceptance",
        summary: "16 concurrent agents: 1 hang + 1 crash + 1 dirty",
        limits: { maxAgents: TOTAL, maxConcurrentAgents: TOTAL },
        inputs: [{ name: "repo", type: "path", required: true }],
        phases: [{ id: "fan", name: "Fan", status: "pending", mode: "parallel", tasks }]
      }
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
    const { app, taskIds } = buildApp(work);
    const run = plan(app, { repo: work });
    assert.equal(run.tasks.length, TOTAL, `planned ${TOTAL} tasks`);

    const timingLog = path.join(work, "concurrent-timing.jsonl");
    process.env.CW_TIMING_LOG = timingLog;
    const started = Date.now();
    // v2 drive: (runId, cwd, opts); no runner object. The old smoke forced
    // policy:{maxAttempts:1} so each failure parked on its FIRST attempt; v2's
    // drive hardcodes DEFAULT_SCHEDULING_POLICY.maxAttempts=3 and no longer
    // exposes a policy knob, so the hang/crash/dirty hops each retry to attempt
    // 3 before parking (see NO-EQUIVALENT note in the audit result).
    const result = drive(run.id, run.cwd, {
      now: FIXED_NOW,
      concurrency: TOTAL,
      agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag", timeoutMs: TIMEOUT_MS }
    });
    const elapsed = Date.now() - started;
    delete process.env.CW_TIMING_LOG;

    // ---- no deadlock + REAL parallelism ------------------------------------
    // NO-EQUIVALENT (v2 cutover audit): this smoke depends on single-attempt
    // parking, which the old drive gave via DriveOptions.policy={maxAttempts:1}
    // (old src/drive.ts:59). v2 dropped that knob from DriveOptions and
    // hardcodes DEFAULT_SCHEDULING_POLICY={maxAttempts:3}
    // (src/core/pipeline/drive-decide.ts:154); the field is threaded into
    // driveStep (src/shell/drive.ts:203) and maxIterations
    // (src/shell/drive.ts:610) with NO injection point (no option, no env var,
    // no task field). So the hang/crash/dirty hops now retry to attempt 3
    // before parking: the drive spans multiple retry rounds instead of one, and
    // the round-scoped assertions below no longer describe v2. Observed
    // breakage under maxAttempts=3: 20 (not 16) worker starts here; parkSteps
    // count 2 (not 3); park reasons carry an "(attempt N/3)" suffix. The
    // final-state assertions (status=parked, 13 completed, 3 parked, disk
    // replay) still hold. NOT weakened: left asserting the old single-attempt
    // contract so the gap stays visible for Phase B. First failure lands here:
    // "every worker process recorded a start" 20 !== 16.
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
