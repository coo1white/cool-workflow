#!/usr/bin/env node
"use strict";

// smoke-duration-scheduling-smoke — perf cycle P1-5.
//
// run-all.js's parallel pool used to pull the queue in plain alphabetical
// (filesystem discovery) order, and --sample <n> (the fast-estimation subset
// npm test/coverage-gate use) ranked candidates by file-name hash alone --
// neither had any signal about actual runtime cost. Measured live: the single
// slowest real smoke (36s) sat near the very end of alphabetical order, so a
// worker pool that had already drained every other file sat mostly idle
// waiting on it alone, instead of overlapping its 36s with the rest of the
// suite from the start.
//
// Fixed by reading a static, committed duration snapshot (smoke-durations.js
// [sic] -- smoke-durations.json, next to this file) as a pure scheduling hint:
// the parallel pool now runs longest-known-duration first, and --sample now
// ranks candidates by duration ascending (fastest first, hash as tie-breaker)
// instead of by hash alone.
//
// Proven deterministically (not by real wall-clock timing on the real 194-file
// suite, which is exactly the kind of environment-noisy measurement this
// whole batch has learned to avoid): stand up an isolated copy of the runner
// plus a small pool of trivial, near-instant fake smokes (same pattern as the
// pre-existing sample-determinism-smoke.js) and a FAKE, fully-controlled
// smoke-durations.json, then inspect the runner's own --json-summary output.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDir = __dirname;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-duration-schedule-"));
fs.copyFileSync(path.join(testDir, "run-all.js"), path.join(temp, "run-all.js"));

// 6 trivial, near-instant fake smokes -- their REAL runtime is irrelevant
// (all ~0ms); only the FAKE durations.json below drives scheduling decisions.
const pool = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
for (const name of pool) {
  fs.writeFileSync(path.join(temp, `${name}-smoke.js`), `process.stdout.write('${name}: ok\\n');\n`, "utf8");
}

// ---------------------------------------------------------------------
// 1. Parallel-pool queue order: with concurrency 1 (sequential), the queue
//    order IS the run order IS the completion order -- the cleanest way to
//    observe scheduling without any async race between workers. Durations
//    are assigned in REVERSE alphabetical order (foxtrot largest, alpha
//    smallest) specifically so descending-duration order and alphabetical
//    order are two DIFFERENT, easily-distinguished sequences -- a fix that
//    coincidentally matched alphabetical order for some other duration
//    assignment would not actually prove anything.
// ---------------------------------------------------------------------
// The runner deliberately re-sorts its `results` array alphabetically before
// printing the summary/writing --json-summary (for stable, readable
// reporting) -- so neither reflects real execution order. The "  PASS  <file>
// (Xms)" lines it prints AS EACH TEST COMPLETES, before that final re-sort,
// are the only place real completion order survives; with --concurrency 1
// (sequential), completion order IS queue order IS scheduling order, so
// parsing those lines is the correct way to observe scheduling here.
function runOrderFromStdout(stdout) {
  const order = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(?:PASS|FAIL)\s+(\S+\.js)\s/);
    if (m) order.push(m[1]);
  }
  return order;
}

{
  const durations = { "foxtrot-smoke.js": 90000, "echo-smoke.js": 500, "delta-smoke.js": 400, "charlie-smoke.js": 300, "bravo-smoke.js": 200, "alpha-smoke.js": 100 };
  fs.writeFileSync(path.join(temp, "smoke-durations.json"), JSON.stringify(durations), "utf8");

  const result = cp.spawnSync(process.execPath, [path.join(temp, "run-all.js"), "--concurrency", "1"], { cwd: temp, encoding: "utf8" });
  assert.equal(result.status, 0, `runner exited ${result.status}: ${result.stderr}`);
  const runOrder = runOrderFromStdout(result.stdout);

  assert.deepEqual(
    runOrder,
    ["foxtrot-smoke.js", "echo-smoke.js", "delta-smoke.js", "charlie-smoke.js", "bravo-smoke.js", "alpha-smoke.js"],
    `pooled smokes must run in DESCENDING known-duration order regardless of file name, got: ${runOrder.join(", ")}`
  );
}

// ---------------------------------------------------------------------
// 2. --sample selection: with the SAME 6 fake files but no --concurrency
//    constraint needed here (selection happens before any run), a sample of
//    3 must pick the 3 files with the SMALLEST known duration (delta, echo,
//    foxtrot), not the 3 with the lowest file-name hash (whichever those
//    happen to be -- the failure mode this fix closes: a slow file could
//    previously land in the "fast" sample purely by hash luck).
// ---------------------------------------------------------------------
{
  const durations = { "alpha-smoke.js": 90000, "bravo-smoke.js": 60000, "charlie-smoke.js": 30000, "delta-smoke.js": 300, "echo-smoke.js": 200, "foxtrot-smoke.js": 100 };
  fs.writeFileSync(path.join(temp, "smoke-durations.json"), JSON.stringify(durations), "utf8");

  const summaryPath = path.join(temp, "sample-summary.json");
  const result = cp.spawnSync(
    process.execPath,
    [path.join(temp, "run-all.js"), "--sample", "3", "--concurrency", "1", "--json-summary", summaryPath],
    { cwd: temp, encoding: "utf8" }
  );
  assert.equal(result.status, 0, `runner exited ${result.status}: ${result.stderr}`);
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const sampled = summary.results.map((r) => r.file).sort();

  assert.deepEqual(
    sampled,
    ["delta-smoke.js", "echo-smoke.js", "foxtrot-smoke.js"],
    `--sample 3 must pick the 3 FASTEST known files, got: ${sampled.join(", ")}`
  );
}

// ---------------------------------------------------------------------
// 3. A file with NO recorded duration must default to the median of every
//    OTHER known duration -- neither always-first (treated as slowest) nor
//    always-last (treated as fastest). alpha/bravo/charlie/delta/echo are
//    given durations of 500/400/300/200/100ms (median 300); foxtrot has NO
//    entry at all and must schedule as if it were also ~300ms, landing in
//    the MIDDLE of the run order, not at either end.
// ---------------------------------------------------------------------
{
  const durations = { "alpha-smoke.js": 500, "bravo-smoke.js": 400, "charlie-smoke.js": 300, "delta-smoke.js": 200, "echo-smoke.js": 100 };
  fs.writeFileSync(path.join(temp, "smoke-durations.json"), JSON.stringify(durations), "utf8");

  const result = cp.spawnSync(process.execPath, [path.join(temp, "run-all.js"), "--concurrency", "1"], { cwd: temp, encoding: "utf8" });
  assert.equal(result.status, 0, `runner exited ${result.status}: ${result.stderr}`);
  const runOrder = runOrderFromStdout(result.stdout);
  const foxtrotPosition = runOrder.indexOf("foxtrot-smoke.js");

  assert.ok(foxtrotPosition > 0 && foxtrotPosition < runOrder.length - 1, `an unknown-duration file must default to the median (landing in the middle), not first or last -- ran at position ${foxtrotPosition} of ${runOrder.length}: ${runOrder.join(", ")}`);
}

fs.rmSync(temp, { recursive: true, force: true });

process.stdout.write("smoke-duration-scheduling-smoke: ok\n");
