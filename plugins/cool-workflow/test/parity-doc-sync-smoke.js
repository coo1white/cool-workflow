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

const r = spawnSync(process.execPath, [gen, "--check"], { cwd: pluginRoot, encoding: "utf8" });
assert.equal(
  r.status,
  0,
  `cli-mcp-parity.7.md is out of sync with the capability registry. ` +
    `Run \`node scripts/gen-parity-doc.js\` and commit.\n${r.stdout || ""}${r.stderr || ""}`
);

// Sanity: the generated matrix actually reflects the registry size (catches a
// generator that no-ops against an empty/partial registry).
const { CAPABILITY_REGISTRY } = require(path.join(pluginRoot, "dist", "capability-registry.js"));
assert.ok(CAPABILITY_REGISTRY.length >= 180, `registry unexpectedly small (${CAPABILITY_REGISTRY.length})`);

process.stdout.write(`parity-doc-sync-smoke: ok (matrix generated + in sync; ${CAPABILITY_REGISTRY.length} capabilities)\n`);
