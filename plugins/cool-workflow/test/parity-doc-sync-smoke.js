#!/usr/bin/env node
"use strict";

// parity-doc-sync-smoke — the CLI<->MCP parity matrix in docs/cli-mcp-parity.7.md
// declares itself "machine-complete by design", so it must STAY in sync with the
// capability registry. It drifted badly once (132 documented rows vs a
// 190-capability registry) because it was hand-maintained; now it is generated
// (scripts/gen-parity-doc.js) and this guard fails closed if the committed doc
// ever diverges from `node scripts/gen-parity-doc.js`.
//
// Included in `npm test` (and therefore the release gate).

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const gen = path.join(pluginRoot, "scripts", "gen-parity-doc.js");

// DEFERRED-TOOLING: this smoke spawns scripts/gen-parity-doc.js --check, and
// that SCRIPT (line 25) still require()s the old flat dist/capability-registry.js,
// which v2 removed (its source of truth is now core/capability-table's REGISTRY).
// So --check crashes with MODULE_NOT_FOUND and this assertion trips. Repointing the
// gen-parity-doc.js script to the v2 module is the separate tooling-repoint job
// (gen-parity-doc is on the deferred list); the test file's own import is already
// repointed below. Once the script is repointed, this smoke should go green as-is.
const r = spawnSync(process.execPath, [gen, "--check"], { cwd: pluginRoot, encoding: "utf8" });
assert.equal(
  r.status,
  0,
  `cli-mcp-parity.7.md is out of sync with the capability registry. ` +
    `Run \`node scripts/gen-parity-doc.js\` and commit.\n${r.stdout || ""}${r.stderr || ""}`
);

// Sanity: the generated matrix actually reflects the registry size (catches a
// generator that no-ops against an empty/partial registry).
// v2 repoint: the flat dist/capability-registry.js is gone. Its single source of
// truth is now core/capability-table's REGISTRY (same array shape: capability,
// surface, cli, mcp, ...). Same intent: the registry is not empty/partial.
const { REGISTRY: CAPABILITY_REGISTRY } = require(path.join(pluginRoot, "dist", "core", "capability-table.js"));
assert.ok(CAPABILITY_REGISTRY.length >= 180, `registry unexpectedly small (${CAPABILITY_REGISTRY.length})`);

process.stdout.write(`parity-doc-sync-smoke: ok (matrix generated + in sync; ${CAPABILITY_REGISTRY.length} capabilities)\n`);
