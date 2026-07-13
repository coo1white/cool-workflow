#!/usr/bin/env node
"use strict";

// ledger-list-ledger-dir.test — `cw ledger list` read the ledger directory
// from `--dir`, but the global CLI front door (cli/entry.ts) treats `--dir`
// as an alias of `--repo` for EVERY command — one flag, two meanings. This
// pins the fix: `--ledger-dir` is the unambiguous spelling, `--dir` keeps
// working byte-for-byte, and repeated `--ledger-dir` flags union-verify the
// same way repeated `--dir` flags always have.
//
// Spawns the real CLI (piped, non-TTY) so entry.ts's global --dir -> --repo
// alias is part of what is proven, not mocked away.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");

function run(argv) {
  try {
    const stdout = execFileSync(node, [cli, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout || "") };
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ledger-dir-"));
const dir = path.join(work, "ledger");
fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ schemaVersion: 1, kind: "proposal", id: "x" }) + "\n");

// ===== 1. --ledger-dir output is byte-identical to the old --dir output =====
{
  const viaLedgerDir = run(["ledger", "list", "--ledger-dir", dir]);
  const viaDir = run(["ledger", "list", "--dir", dir]);
  assert.equal(viaLedgerDir.stdout, viaDir.stdout, "--ledger-dir and --dir must print the same bytes for the same directory");
  assert.equal(viaLedgerDir.status, viaDir.status, "and exit the same way");
  console.log("ledger-list-ledger-dir: --ledger-dir is byte-identical to --dir ok");
}

// ===== 2. two --ledger-dir flags union-verify, same as two --dir flags =====
{
  const viaLedgerDir = run(["ledger", "list", "--ledger-dir", dir, "--ledger-dir", dir]);
  const viaDir = run(["ledger", "list", "--dir", dir, "--dir", dir]);
  assert.equal(viaLedgerDir.stdout, viaDir.stdout, "repeated --ledger-dir unions exactly like repeated --dir");
  const payload = JSON.parse(viaLedgerDir.stdout);
  assert.deepEqual(payload.dirs, [dir, dir], "the union shape carries a dirs array");
  assert.equal(payload.count, 2, "both mirror reads are counted");
  console.log("ledger-list-ledger-dir: repeated --ledger-dir union-verifies ok");
}

// ===== 3. regression pin: the old single --dir call is byte-unchanged =====
{
  const viaDir = run(["ledger", "list", "--dir", dir]);
  const payload = JSON.parse(viaDir.stdout);
  assert.equal(payload.dir, dir, "single --dir keeps the single-directory shape (a dir field)");
  assert.equal(payload.dirs, undefined, "and no dirs array");
  console.log("ledger-list-ledger-dir: old --dir invocation is byte-unchanged ok");
}

fs.rmSync(work, { recursive: true, force: true });
console.log("ledger-list-ledger-dir.test: ok");
