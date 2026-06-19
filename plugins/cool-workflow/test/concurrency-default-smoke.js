#!/usr/bin/env node
"use strict";

// concurrency-default-smoke - verify run-all.js concurrency defaults.
//
// - Default (no flag, no env): concurrency > 1 (auto, cores-capped parallel).
// - CW_TEST_CONCURRENCY=1: concurrency === 1 (sequential gate mode).
// - --concurrency 4: explicit override respected.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDir = __dirname;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-concurrency-default-"));
const runner = path.join(temp, "run-all.js");
fs.copyFileSync(path.join(testDir, "run-all.js"), runner);
fs.writeFileSync(path.join(temp, "tiny-smoke.js"), "process.stdout.write('tiny: ok\\n');\n", "utf8");

function runRunner(extraEnv = {}, extraArgs = []) {
  const summaryPath = path.join(temp, "summary.json");
  const args = [runner, ...extraArgs, "--json-summary", summaryPath];
  const env = { ...process.env, ...extraEnv };
  delete env.CW_TEST_CONCURRENCY;
  if (extraEnv.CW_TEST_CONCURRENCY !== undefined) env.CW_TEST_CONCURRENCY = extraEnv.CW_TEST_CONCURRENCY;
  const result = cp.spawnSync(process.execPath, args, {
    cwd: temp,
    encoding: "utf8",
    env
  });
  return { status: result.status, summary: JSON.parse(fs.readFileSync(summaryPath, "utf8")) };
}

function main() {
  // 1. Default (no flag, no env): should be > 1 (auto / parallel)
  {
    const r = runRunner();
    assert.equal(r.status, 0, `default runner exited ${r.status}`);
    assert.ok(r.summary.concurrency > 1,
      `default concurrency should be > 1 (auto), got ${r.summary.concurrency}`);
    console.log(`concurrency-default: default auto → concurrency ${r.summary.concurrency} OK`);
  }

  // 2. CW_TEST_CONCURRENCY=1: gate sequential mode
  {
    const r = runRunner({ CW_TEST_CONCURRENCY: "1" });
    assert.equal(r.status, 0, `gate mode runner exited ${r.status}`);
    assert.equal(r.summary.concurrency, 1,
      `gate mode concurrency should be 1, got ${r.summary.concurrency}`);
    console.log("concurrency-default: CW_TEST_CONCURRENCY=1 → concurrency 1 OK");
  }

  // 3. --concurrency 4: explicit override
  {
    const r = runRunner({}, ["--concurrency", "4"]);
    assert.equal(r.status, 0, `--concurrency 4 runner exited ${r.status}`);
    assert.equal(r.summary.concurrency, 4,
      `--concurrency 4 should yield concurrency 4, got ${r.summary.concurrency}`);
    console.log("concurrency-default: --concurrency 4 → concurrency 4 OK");
  }

  // 4. CW_TEST_CONCURRENCY=1 with --concurrency 4: flag wins over env
  {
    const r = runRunner({ CW_TEST_CONCURRENCY: "1" }, ["--concurrency", "4"]);
    assert.equal(r.status, 0, `flag-over-env runner exited ${r.status}`);
    assert.equal(r.summary.concurrency, 4,
      `flag should win over env, got ${r.summary.concurrency}`);
    console.log("concurrency-default: --concurrency 4 over CW_TEST_CONCURRENCY=1 OK");
  }

  fs.rmSync(temp, { recursive: true, force: true });
  process.stdout.write("concurrency-default-smoke: ok\n");
}

main();
