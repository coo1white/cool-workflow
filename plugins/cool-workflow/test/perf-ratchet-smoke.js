#!/usr/bin/env node
"use strict";

// perf-ratchet-smoke — holds CW's own work to the counts in
// scripts/bench/perf-ceilings.json (intent:
// project/docs/intent/2026-09-26-perf-ratchets.md).
//
// 1. positive: the real counts equal the ceilings. A count above its ceiling
//    is a slowdown; a count below it is a gain that must be locked by
//    lowering the ceiling in the same diff (`node scripts/bench/perf-counts.js
//    --update`, which refuses to raise one).
// 2. the counts are real: the drive journey reads state, writes durably and
//    loads modules, and a second measure gives the same numbers.
// 3. teeth: ceilings one below, one above, missing, and extra are each
//    refused with one finding.

const assert = require("node:assert/strict");
const path = require("node:path");

const { compare, measure, readCeilings } = require(path.join(__dirname, "..", "scripts", "bench", "perf-counts.js"));

// 1. The real counts against the committed ceilings.
const counts = measure();
const ceilings = readCeilings();
assert.deepEqual(compare(counts, ceilings), [], "perf counts must equal scripts/bench/perf-ceilings.json");

// 2. The counts measure real work, and they do not move between runs.
for (const key of ["drive.stateReads", "drive.stateRoundTrips", "drive.fsyncs", "drive.renames", "drive.modules", "version.modules"]) {
  assert.ok(counts[key] > 0, `${key} counts real work`);
}
assert.ok(counts["drive.modules"] > counts["version.modules"], "a drive loads more modules than a version print");
assert.deepEqual(measure(), counts, "the counts are exact: a second run gives the same numbers");

// 3. Teeth.
const key = "drive.stateReads";
const refusals = [
  [{ ...ceilings, [key]: counts[key] - 1 }, `${key}: ${counts[key]} is above its ceiling ${counts[key] - 1}`],
  [{ ...ceilings, [key]: counts[key] + 1 }, `${key}: ${counts[key]} is below its ceiling ${counts[key] + 1}; lower it (run --update)`],
  [Object.fromEntries(Object.entries(ceilings).filter(([k]) => k !== key)), `${key}: no ceiling (run --update)`],
  [{ ...ceilings, "gone.modules": 1 }, "gone.modules: ceiling for a count that is no longer measured"],
];
for (const [badCeilings, finding] of refusals) {
  assert.deepEqual(compare(counts, badCeilings), [finding]);
}

process.stdout.write("perf-ratchet-smoke: ok\n");
