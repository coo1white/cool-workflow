#!/usr/bin/env node
"use strict";

// run-unit — the core unit-test runner.
//
// Separate from run-all.js (the *-smoke.js runner) on purpose: these tests are
// pure functions of dist/core/* (no fs.mkdtemp aside from a test's own scratch
// dir, no CW_HOME/repo .cw/ state), so they need none of run-all.js's per-test
// sandbox isolation. Keeping them in their own file/script also means restoring
// this suite never changes what `npm test`/`test:gate`/`test:ci` run — those
// stay smoke-only, byte-for-byte as before.
//
// Discovery is the same fail-closed contract run-all.js uses: every
// test/*.test.js on disk runs, nothing hand-maintained to forget to wire up.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const testDir = __dirname;
const SELF = path.basename(__filename);

const units = fs
  .readdirSync(testDir)
  .filter((file) => file.endsWith(".test.js"))
  .sort();

if (units.length === 0) {
  process.stderr.write(`${SELF}: no test/*.test.js files found — refusing to pass vacuously.\n`);
  process.exit(1);
}

process.stdout.write(`Running ${units.length} unit test(s)\n\n`);

const failures = [];
for (const file of units) {
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [path.join(testDir, file)], {
    encoding: "utf8",
  });
  const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  const ok = result.status === 0;
  process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${file}  (${elapsedMs}ms)\n`);
  if (!ok) failures.push({ file, result });
}

if (failures.length > 0) {
  process.stdout.write(`\n${"=".repeat(70)}\nFailures:\n`);
  for (const { file, result } of failures) {
    process.stdout.write(`\n--- ${file} (exit ${result.status}) ---\n`);
    if (result.stderr && result.stderr.trim()) process.stdout.write(`[stderr]\n${result.stderr.trimEnd()}\n`);
    if (result.stdout && result.stdout.trim()) process.stdout.write(`[stdout]\n${result.stdout.trimEnd()}\n`);
  }
  process.stdout.write(`\n${failures.length}/${units.length} unit test(s) failed.\n`);
  process.exit(1);
}

process.stdout.write(`\nAll ${units.length} unit test(s) passed.\n`);
