#!/usr/bin/env node
// run-all-timeout-header-smoke: a smoke's `// @cw-smoke: timeout <seconds>`
// header must raise its own limit above the default (CW_TEST_TIMEOUT_MS), and
// a smoke without the header keeps the default. Runs test/run-all.mjs in a tiny
// copied directory, never the repository's own suite.

import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-all-timeout-"));
try {
  const runner = path.join(temp, "run-all.mjs");
  fs.copyFileSync(path.join(import.meta.dirname, "run-all.mjs"), runner);
  const sleeper = "setTimeout(() => process.stdout.write('slept: ok\\n'), 2500);\n";
  fs.writeFileSync(path.join(temp, "long-header-smoke.mjs"), `// @cw-smoke: timeout 10\n${sleeper}`, "utf8");
  fs.writeFileSync(path.join(temp, "long-plain-smoke.mjs"), sleeper, "utf8");

  const env = { ...process.env, CW_TEST_TIMEOUT_MS: "1000" };
  const run = (filter) => cp.spawnSync(process.execPath, [runner, "--concurrency", "1", "--filter", filter], { cwd: temp, encoding: "utf8", env });

  const withHeader = run("long-header");
  assert.equal(withHeader.status, 0, `header-raised smoke must pass\n${withHeader.stdout}\n${withHeader.stderr}`);
  assert.match(withHeader.stdout, /PASS  long-header-smoke\.mjs/);

  const plain = run("long-plain");
  assert.notEqual(plain.status, 0, "a smoke past the default timeout with no header must fail");
  assert.match(plain.stdout, /long-plain-smoke\.mjs \(exit null\) \(TIMEOUT after 1000ms\)/);

  console.log("run-all-timeout-header-smoke: ok");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
