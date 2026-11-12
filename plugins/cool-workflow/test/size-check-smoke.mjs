#!/usr/bin/env node
// size-check-smoke — scripts/size-check.mjs holds the src/ line ceiling:
// the real tree passes; a planted tree one line over the limit fails with
// exit 1; a tree at exactly the limit passes. The count matches
// `find src -name '*.ts' | xargs cat | wc -l` (newlines; .ts only).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const script = path.resolve(import.meta.dirname, "..", "scripts", "size-check.mjs");
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

// 1. The real src/ is under the limit.
{
  const r = run([]);
  assert.equal(r.status, 0, `the real src/ must pass: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^size-check: src\/ has \d+ lines \(limit 10000\) — ok\n/);
  assert.ok(r.stdout.trim().split("\n").length <= 11, "the total plus at most 10 files");
}

// 2. A planted overflow fails, named by argument and by env var.
const tree = tmpDir("cw-size-check-");
fs.mkdirSync(path.join(tree, "core"), { recursive: true });
fs.writeFileSync(path.join(tree, "core", "big.ts"), "x;\n".repeat(9000));
fs.writeFileSync(path.join(tree, "small.ts"), "y;\n".repeat(1001));
fs.writeFileSync(path.join(tree, "notes.md"), "z\n".repeat(5000)); // not .ts: not counted
for (const r of [run([tree]), run([], { CW_SIZE_CHECK_SRC: tree })]) {
  assert.equal(r.status, 1, "10,001 lines must fail");
  assert.match(r.stdout, /src\/ has 10001 lines \(limit 10000\) — OVER/);
  assert.match(r.stdout, /\n {4}9000 {2}core\/big\.ts\n {4}1001 {2}small\.ts\n/, "the biggest files, biggest first");
  assert.match(r.stderr, /1 lines over the limit/);
}

// 3. Exactly at the limit passes.
fs.writeFileSync(path.join(tree, "small.ts"), "y;\n".repeat(1000));
assert.equal(run([tree]).status, 0, "10,000 lines is allowed");

console.log("size-check-smoke: ok");
