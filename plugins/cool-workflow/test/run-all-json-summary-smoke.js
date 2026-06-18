#!/usr/bin/env node
"use strict";

// run-all-json-summary-smoke: exercise test/run-all.js in a tiny copied test
// directory so the summary feature is covered without recursively running the
// repository's full smoke suite.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDir = __dirname;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-all-summary-"));
const runner = path.join(temp, "run-all.js");
fs.copyFileSync(path.join(testDir, "run-all.js"), runner);
fs.writeFileSync(path.join(temp, "tiny-smoke.js"), "process.stdout.write('tiny: ok\\n');\n", "utf8");

const noSummaryPath = path.join(temp, "absent.json");
const plain = cp.spawnSync(process.execPath, [runner, "--concurrency", "1"], { cwd: temp, encoding: "utf8" });
assert.equal(plain.status, 0, `plain runner failed\n${plain.stdout}\n${plain.stderr}`);
assert.match(plain.stdout, /Running 1 smoke\(s\) — concurrency 1/);
assert.match(plain.stdout, /PASS  tiny-smoke\.js/);
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
assert.equal(summary.results[0].file, "tiny-smoke.js");
assert.equal(summary.results[0].ok, true);
assert.equal(summary.slowest.length, 1);
assert.equal(typeof summary.wallElapsedMs, "number");
assert.equal(typeof summary.sumChildElapsedMs, "number");

fs.rmSync(temp, { recursive: true, force: true });
process.stdout.write("run-all-json-summary-smoke: ok\n");
