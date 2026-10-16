#!/usr/bin/env node
"use strict";

// run-all-timeout-header-smoke: a smoke's `// @cw-smoke: timeout <seconds>`
// header must raise its own limit above the default (CW_TEST_TIMEOUT_MS), and
// a smoke without the header keeps the default. Runs test/run-all.js in a tiny
// copied directory, never the repository's own suite.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-all-timeout-"));
try {
  const runner = path.join(temp, "run-all.js");
  fs.copyFileSync(path.join(__dirname, "run-all.js"), runner);
  const sleeper = "setTimeout(() => process.stdout.write('slept: ok\\n'), 2500);\n";
  fs.writeFileSync(path.join(temp, "long-header-smoke.js"), `// @cw-smoke: timeout 10\n${sleeper}`, "utf8");
  fs.writeFileSync(path.join(temp, "long-plain-smoke.js"), sleeper, "utf8");

  const env = { ...process.env, CW_TEST_TIMEOUT_MS: "1000" };
  const run = (filter) => cp.spawnSync(process.execPath, [runner, "--concurrency", "1", "--filter", filter], { cwd: temp, encoding: "utf8", env });

  const withHeader = run("long-header");
  assert.equal(withHeader.status, 0, `header-raised smoke must pass\n${withHeader.stdout}\n${withHeader.stderr}`);
  assert.match(withHeader.stdout, /PASS  long-header-smoke\.js/);

  const plain = run("long-plain");
  assert.notEqual(plain.status, 0, "a smoke past the default timeout with no header must fail");
  assert.match(plain.stdout, /long-plain-smoke\.js \(exit null\) \(TIMEOUT after 1000ms\)/);

  console.log("run-all-timeout-header-smoke: ok");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
