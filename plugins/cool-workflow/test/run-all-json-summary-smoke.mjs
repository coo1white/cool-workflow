#!/usr/bin/env node
// run-all-json-summary-smoke: exercise test/run-all.mjs in a tiny copied test
// directory so the summary feature is covered without recursively running the
// repository's full smoke suite.

import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDir = import.meta.dirname;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-all-summary-"));
const runner = path.join(temp, "run-all.mjs");
fs.copyFileSync(path.join(testDir, "run-all.mjs"), runner);
fs.writeFileSync(path.join(temp, "tiny-smoke.mjs"), "process.stdout.write('tiny: ok\\n');\n", "utf8");

const noSummaryPath = path.join(temp, "absent.json");
const plain = cp.spawnSync(process.execPath, [runner, "--concurrency", "1"], { cwd: temp, encoding: "utf8" });
assert.equal(plain.status, 0, `plain runner failed\n${plain.stdout}\n${plain.stderr}`);
assert.match(plain.stdout, /Running 1 smoke\(s\) — concurrency 1/);
assert.match(plain.stdout, /PASS  tiny-smoke\.mjs/);
assert.equal(fs.existsSync(noSummaryPath), false, "no summary file is written unless requested");

const summaryPath = path.join(temp, "summary.json");
const withSummary = cp.spawnSync(process.execPath, [runner, "--concurrency", "1", "--json-summary", summaryPath], {
  cwd: temp,
  encoding: "utf8"
});
assert.equal(withSummary.status, 0, `summary runner failed\n${withSummary.stdout}\n${withSummary.stderr}`);
assert.match(withSummary.stdout, /Running 1 smoke\(s\) — concurrency 1/, "normal stdout is still printed");
assert.ok(fs.existsSync(summaryPath), "summary file is written on request");
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
assert.equal(summary.schemaVersion, 1);
assert.equal(summary.concurrency, 1);
assert.equal(summary.results.length, 1);
assert.equal(summary.results[0].file, "tiny-smoke.mjs");
assert.equal(summary.results[0].ok, true);
assert.equal(summary.slowest.length, 1);
assert.equal(typeof summary.wallElapsedMs, "number");
assert.equal(typeof summary.sumChildElapsedMs, "number");

fs.rmSync(temp, { recursive: true, force: true });
process.stdout.write("run-all-json-summary-smoke: ok\n");
