#!/usr/bin/env node
"use strict";

// bump-version-idempotent-smoke — `bump:version <current>` must be a no-op that
// exits 0 ("already at"), not a hard failure. The gated `release-flow --cut`
// relies on this when the version surfaces were already bumped in a prior PR
// (release-prep), so the cut can still commit the verdict + tag without
// re-bumping. Pins both: idempotent re-run AND that it does NOT mutate surfaces.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const bump = path.join(pluginRoot, "scripts", "bump-version.js");
const pkgPath = path.join(pluginRoot, "package.json");

const current = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
const pkgBefore = fs.readFileSync(pkgPath, "utf8");

// Re-bumping to the CURRENT version is a no-op success (exit 0), not a fail.
const r = spawnSync(process.execPath, [bump, current], { cwd: pluginRoot, encoding: "utf8" });
assert.equal(r.status, 0, `bump:version ${current} (already at) must exit 0, got ${r.status}\n${r.stdout}${r.stderr}`);
assert.match(`${r.stdout}${r.stderr}`, /already at/, "idempotent run reports 'already at'");

// And it must not have rewritten any surface (package.json byte-identical).
assert.equal(fs.readFileSync(pkgPath, "utf8"), pkgBefore, "no-op bump must not mutate package.json");

// A malformed version still fails closed.
const bad = spawnSync(process.execPath, [bump, "not-a-version"], { cwd: pluginRoot, encoding: "utf8" });
assert.notEqual(bad.status, 0, "a non-semver version must fail closed");

process.stdout.write("bump-version-idempotent-smoke: ok (re-bump is a no-op exit 0; surfaces untouched; bad version fails closed)\n");
