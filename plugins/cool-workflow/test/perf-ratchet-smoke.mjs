#!/usr/bin/env node
// perf-ratchet-smoke — holds CW's own work to the counts in
// scripts/bench/perf-ceilings.json (intent:
// project/docs/intent/2026-09-archive.md, the perf-ratchets part).
//
// 1. positive: the real counts equal the ceilings. A count above its ceiling
//    is a slowdown; a count below it is a gain that must be locked by
//    lowering the ceiling in the same diff (`node scripts/bench/perf-counts.mjs
//    --update`, which refuses to raise one).
// 2. the counts are real: the drive journey reads state, writes durably and
//    loads modules, and a second measure gives the same numbers.
// 3. teeth: ceilings one below, one above, missing, and extra are each
//    refused with one finding.

import assert from "node:assert/strict";
import path from "node:path";

// The module count reads module.registerHooks (Node 22.15+). Below that the
// hook refuses to count, so this smoke says so and stops; CI runs Node 22
// (newest) and 24, where it runs in full.
if (typeof nodeModule.registerHooks !== "function") {
  process.stdout.write(`perf-ratchet-smoke: skipped (module.registerHooks needs Node 22.15 or later; this is ${process.versions.node})\n`);
  process.exit(0);
}

import { compare, measure, readCeilings } from "../scripts/bench/perf-counts.mjs";
import nodeModule from "node:module";

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
