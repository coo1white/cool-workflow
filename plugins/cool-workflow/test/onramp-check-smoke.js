#!/usr/bin/env node
"use strict";

// onramp-check-smoke — the change-contract gate must make the development path
// explicit: behavior changes need smoke coverage, surface changes need docs, and
// source/app/script changes need an iteration-log row.
//
// CUTOVER AUDIT (v2) — REAL-GAP. This smoke require()s ../dist/onramp.js
// (exports evaluateOnrampContract + recommendSmokeTests) and drives
// `cw doctor --onramp --json`. The whole onramp change-contract subsystem is
// MISSING from v2: there is no onramp module and no equivalent export anywhere
// under dist/ (grep for evaluateOnrampContract / recommendSmokeTests / the
// issue codes runtime-smoke-required, types-without-runtime,
// surface-docs-required returns nothing in src/ or dist/). The old build had a
// full src/onramp.ts (added in #198, 300+ lines: evaluateOnrampContract,
// recommendSmokeTests, resolveChangedFiles, buildDoctorOnramp). v2 dropped it
// on purpose for now — src/shell/doctor.ts:6-10 states the --onramp section
// (buildDoctorOnramp) is "intentionally NOT wired here" as later-milestone
// work, so `cw doctor --onramp --json` silently ignores the flag and emits no
// `onramp` key. The require below cannot be repointed (no target exists), so
// the smoke fails at import time on genuine missing functionality, not a moved
// path. Assertions are left UNCHANGED — this must go green only once v2 grows
// the onramp gate back (Phase B). Do not weaken to force green.

const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const {
  evaluateOnrampContract,
  recommendSmokeTests
} = require(path.join(pluginRoot, "dist", "shell", "onramp.js"));

function codes(report) {
  return report.issues.map((issue) => issue.code).sort();
}

function contract(files) {
  return evaluateOnrampContract(files, { cwd: pluginRoot });
}

// Runtime behavior without a smoke fails closed.
{
  const report = contract([
    "plugins/cool-workflow/src/doctor.ts",
    "ITERATION_LOG.md"
  ]);
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("runtime-smoke-required"));
}

// Type-only source changes are invalid even if a smoke and log row exist.
{
  const report = contract([
    "plugins/cool-workflow/src/types/run.ts",
    "plugins/cool-workflow/test/onramp-check-smoke.js",
    "ITERATION_LOG.md"
  ]);
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("types-without-runtime"));
}

// Surface changes need public docs.
{
  const report = contract([
    "plugins/cool-workflow/src/capability-registry.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js",
    "ITERATION_LOG.md"
  ]);
  assert.equal(report.ok, false);
  assert.ok(codes(report).includes("surface-docs-required"));
}

// The intended onramp-risk batch shape passes: runtime + script + smoke + docs + log.
{
  const report = contract([
    "plugins/cool-workflow/src/doctor.ts",
    "plugins/cool-workflow/src/onramp.ts",
    "plugins/cool-workflow/src/orchestrator.ts",
    "plugins/cool-workflow/scripts/onramp-check.js",
    "plugins/cool-workflow/test/doctor-smoke.js",
    "plugins/cool-workflow/test/onramp-check-smoke.js",
    "plugins/cool-workflow/docs/getting-started.md",
    "plugins/cool-workflow/README.md",
    "README.md",
    "ITERATION_LOG.md"
  ]);
  assert.equal(report.ok, true, codes(report).join(", "));
}

// Recommendation map covers both local feature work and surface drift work.
{
  const smokes = recommendSmokeTests([
    "plugins/cool-workflow/src/doctor.ts",
    "plugins/cool-workflow/src/capability-registry.ts"
  ], pluginRoot);
  assert.ok(smokes.includes("doctor-smoke.js"), "doctor smoke is recommended");
  assert.ok(smokes.includes("cli-mcp-parity-smoke.js"), "CLI/MCP parity smoke is recommended");
  const report = contract([
    "plugins/cool-workflow/src/capability-registry.ts",
    "plugins/cool-workflow/test/cli-mcp-parity-smoke.js",
    "plugins/cool-workflow/docs/cli-mcp-parity.7.md",
    "ITERATION_LOG.md"
  ]);
  assert.ok(report.recommendedCommands.some((command) => command.includes("npm run test:fast")));
  assert.ok(report.recommendedCommands.some((command) => command.includes("npm run parity:check")));
  assert.ok(report.recommendedCommands.some((command) => command.includes("npm run release:check")));
}

// Curated hits should not be widened by filename-token fallback matches.
{
  const smokes = recommendSmokeTests([
    "plugins/cool-workflow/src/onramp.ts",
    "plugins/cool-workflow/src/orchestrator.ts"
  ], pluginRoot);
  assert.ok(smokes.includes("doctor-smoke.js"), "onramp work keeps the doctor smoke");
  assert.ok(smokes.includes("onramp-check-smoke.js"), "onramp work keeps the contract smoke");
  assert.ok(smokes.includes("cli-mcp-parity-smoke.js"), "help/surface work keeps the parity smoke");
  assert.ok(!smokes.includes("parallel-onramp-smoke.js"), "DSL parallel smoke is not recommended for onramp gate work");
  assert.ok(!smokes.includes("cli-command-surface-smoke.js"), "CLI entrypoint architecture smoke is not recommended for help text");
  assert.ok(!smokes.includes("cli-jsonmode-parity-smoke.js"), "JSON-mode smoke is not recommended for help text");
}

// The CLI exposes the changed-file recommendation structure under doctor --onramp.
{
  const stdout = execFileSync(process.execPath, [cli, "doctor", "--onramp", "--changed-from", "HEAD", "--json"], {
    cwd: pluginRoot,
    encoding: "utf8"
  });
  const report = JSON.parse(stdout);
  assert.equal(report.onramp.changedFiles.baseRef, "HEAD");
  assert.ok(Array.isArray(report.onramp.changedFiles.files));
  assert.ok(Array.isArray(report.onramp.recommendedChecks.commands));
  assert.ok(report.onramp.recommendedChecks.commands.some((command) => command.includes("npm run test:fast")));
  assert.equal(typeof report.onramp.contract.ok, "boolean");
}

process.stdout.write("onramp-check-smoke: ok\n");
