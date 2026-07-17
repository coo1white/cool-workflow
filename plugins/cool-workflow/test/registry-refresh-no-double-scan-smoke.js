#!/usr/bin/env node
"use strict";

// registry-refresh-no-double-scan-smoke — perf cycle P2-2.
//
// `cw registry refresh` (repo scope, the default) builds the repo-scope
// index, then ALWAYS cascades into building the home-scope index too
// (`refresh()`'s own `if (scope === "repo") { ... buildIndex("home") ...}`
// branch). `buildIndex("home")` scans EVERY known repo -- which, for the
// common case of a single cw-enabled repo (no others registered), is just
// THIS SAME repo a second time: every run directory's state.json (plus its
// reclaimed.json, if any) got read and derived ONCE for the repo-scope
// index, then read and derived AGAIN, moments later, for the home-scope
// index, for no reason -- the records were already fresh. Measured live:
// 1500 runs, single registered repo: 341.5ms before this fix, 218.0ms
// after (the repo's own single-scope buildIndex alone measured ~120ms, so
// before this fix `refresh` was paying for roughly TWO full scans).
//
// Fixed by having `refresh()` pass its already-current repo-scope records
// into the home-scope build (a new `reuse` parameter on `buildIndex`),
// which substitutes them for that ONE repo instead of re-deriving from
// disk a second time -- every OTHER known repo (if any) is still scanned
// fresh, so a genuinely multi-repo home index is unaffected.
//
// Proven deterministically (not by wall-clock timing, which this whole
// batch has learned is flaky under this repo's concurrent test suite): a
// monkeypatched `fs.readFileSync` counts real reads of each run's
// `state.json` path specifically. With no other repo registered, `cw
// registry refresh` must read each run's state.json EXACTLY ONCE per
// refresh -- not twice.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

function cw(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-registry-no-double-scan-")));
fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
const cwd0 = process.cwd();
try {
  process.chdir(work);

  const N = 6;
  const statePaths = [];
  for (let i = 0; i < N; i++) {
    const plan = JSON.parse(cw(["plan", "end-to-end-golden-path", "--repo", work, "--question", `registry no-double-scan ${i}`], work));
    statePaths.push(plan.statePath);
  }

  // Run `registry refresh` (repo scope, the default) IN-PROCESS -- not as
  // a child process -- so a monkeypatched fs.readFileSync in THIS process
  // can observe every real read of each run's state.json.
  const { RunRegistry } = require(path.join(pluginRoot, "dist/shell/run-registry-io"));
  const registry = new RunRegistry(work);

  const statePathSet = new Set(statePaths);
  const readCounts = new Map(statePaths.map((p) => [p, 0]));
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(file, ...rest) {
    if (statePathSet.has(file)) readCounts.set(file, (readCounts.get(file) || 0) + 1);
    return originalReadFileSync.call(fs, file, ...rest);
  };
  let report;
  try {
    report = registry.refresh({ scope: "repo" });
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  assert.equal(report.index.records.length, N, "the repo-scope index must still list every run");
  for (const [statePath, count] of readCounts) {
    assert.equal(count, 1, `${path.basename(path.dirname(statePath))}'s state.json was read ${count} times by one \`registry refresh\` (repo scope, no other repo registered) -- expected exactly 1, not a second redundant scan for the home-scope cascade`);
  }
} finally {
  process.chdir(cwd0);
  fs.rmSync(work, { recursive: true, force: true });
}

process.stdout.write("registry-refresh-no-double-scan-smoke: ok\n");
