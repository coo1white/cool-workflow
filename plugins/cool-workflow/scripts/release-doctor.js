#!/usr/bin/env node
"use strict";

// release-doctor.js — fast release preflight (`npm run release:doctor`).
//
//   npm run release:doctor [-- X.Y.Z] [--json] [--offline]
//   node scripts/release-doctor.js [X.Y.Z] [--json] [--offline]
//
// Runs every check in scripts/release-preflight.js (the SAME checks
// `npm run release -- X.Y.Z` runs first, in its stage 0) and reports ALL
// problems at once, each with the exact command that fixes it. It runs no
// test suite, no gate, no reviewer and no model: a few git calls, one
// `git fetch origin main`, one `git ls-remote`, and `gh auth status`
// (`--offline` skips those three network steps). It changes nothing.
//
// The version defaults to plugins/cool-workflow/package.json's version (the
// release prep PR sets it), read from the repository the doctor runs in
// (`git rev-parse --show-toplevel` of the working directory).
//
// Output: diagnostics on stderr; with --json, one stable JSON object on
// stdout ({ ok, mode, version, failures, warnings, checks[] }) and nothing
// else there. Exit 0 when no check fails (warnings allowed), 1 otherwise.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runChecks, formatFindings } = require("./release-preflight.js");

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const OFFLINE = argv.includes("--offline");
const unknown = argv.filter((a) => a.startsWith("-") && !["--json", "--offline"].includes(a));
const positional = argv.filter((a) => !a.startsWith("-"));

function usage(msg) {
  process.stderr.write(`release:doctor: ${msg}\nusage: node scripts/release-doctor.js [X.Y.Z] [--json] [--offline]\n`);
  process.exit(1);
}
if (unknown.length) usage(`unknown flag ${unknown[0]}`);
if (positional.length > 1) usage("at most one version");

const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", shell: false });
if (top.status !== 0) usage("not inside a git work tree");
const repoRoot = top.stdout.trim();

let version = positional[0];
if (!version) {
  try {
    version = JSON.parse(fs.readFileSync(path.join(repoRoot, "plugins", "cool-workflow", "package.json"), "utf8")).version;
  } catch {
    version = undefined;
  }
}

const result = runChecks({ repoRoot, version, offline: OFFLINE, mode: "doctor" });
process.stderr.write(formatFindings(result));
process.stderr.write(result.ok
  ? `release:doctor: ready${result.version ? ` for v${result.version}` : ""} (${result.warnings} warning${result.warnings === 1 ? "" : "s"})\n`
  : `release:doctor: NOT ready — ${result.failures} problem${result.failures === 1 ? "" : "s"} to fix (see FAIL lines above)\n`);
if (JSON_OUT) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);
