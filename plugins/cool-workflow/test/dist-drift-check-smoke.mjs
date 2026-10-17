#!/usr/bin/env node
// dist-drift-check-smoke — proves scripts/dist-drift-check.mjs catches a
// hand-edited dist/ file even with a warm tsc cache (before this PR, tsc's
// incremental build emits nothing when src/ is unchanged, so a stale cache
// let a hand-edit pass as "matches"). Runs in a private COPY of the package
// (src/, dist/, package.json, tsconfig.json, the one script, a symlinked
// node_modules) — the real dist/ is shared with ~100 other smokes that run
// in parallel and invoke dist/cli.js, so mutating it here would race them.

import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-dist-drift-"));
try {
  for (const rel of ["package.json", "tsconfig.json", "src", "dist"]) {
    fs.cpSync(path.join(pluginRoot, rel), path.join(tmp, rel), { recursive: true });
  }
  fs.mkdirSync(path.join(tmp, "scripts"));
  fs.cpSync(path.join(pluginRoot, "scripts", "dist-drift-check.mjs"), path.join(tmp, "scripts", "dist-drift-check.mjs"));
  fs.symlinkSync(path.join(pluginRoot, "node_modules"), path.join(tmp, "node_modules"));

  const script = path.join(tmp, "scripts", "dist-drift-check.mjs");
  const target = path.join(tmp, "dist", "cli.js");
  const original = fs.readFileSync(target, "utf8");
  const run = () => cp.spawnSync(process.execPath, [script], { cwd: tmp, encoding: "utf8" });

  fs.appendFileSync(target, "// dist-drift-check-smoke probe\n");
  const dirty = run();
  assert.equal(dirty.status, 1, `must FAIL on a hand-edited dist file. exit=${dirty.status}\n${dirty.stdout}${dirty.stderr}`);
  assert.match(dirty.stderr, /changed:\s+cli\.js/, `failure must name the changed file, got: ${dirty.stderr}`);

  fs.writeFileSync(target, original);
  const clean = run();
  assert.equal(clean.status, 0, `must PASS once dist/ is restored. exit=${clean.status}\n${clean.stdout}${clean.stderr}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("dist-drift-check-smoke: ok\n");
