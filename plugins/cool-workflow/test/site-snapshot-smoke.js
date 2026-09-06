#!/usr/bin/env node
// @cw-smoke: tags pages
// site-snapshot-smoke — the GitHub Pages snapshot script, end to end: runs
// `node scripts/build-ui.js` (skips, with a note, when it leaves no
// ui/workbench/out/index.html — e.g. no bun on this machine) then
// `node scripts/site-snapshot.js <tmp>` and checks the files a Pages
// deploy needs are there: the Next export's own index.html at the site
// root, its assets under ui/, and the two JSON routes as files.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");

const build = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "build-ui.js")], { cwd: pluginRoot, encoding: "utf8" });
if (build.status !== 0 || !fs.existsSync(path.join(pluginRoot, "ui", "workbench", "out", "index.html"))) {
  process.stdout.write(`site-snapshot-smoke: skipped, no ui/workbench/out/index.html after build-ui.js (${build.stderr.trim() || "build-ui.js did not run"})\n`);
  process.exit(0);
}

const site = fs.mkdtempSync(path.join(os.tmpdir(), "cw-site-snapshot-"));
const run = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "site-snapshot.js"), site], { cwd: pluginRoot, encoding: "utf8" });
assert.equal(run.status, 0, `site-snapshot.js exited 0: ${run.stderr}`);

assert.ok(fs.existsSync(path.join(site, "index.html")), "index.html at the site root");
assert.ok(fs.existsSync(path.join(site, "ui", "_next")), "ui/_next/ (the export's assets)");
assert.ok(fs.existsSync(path.join(site, "ui", "icon.svg")), "ui/icon.svg");
assert.ok(fs.existsSync(path.join(site, "api", "index")), "api/index");
assert.ok(fs.existsSync(path.join(site, ".nojekyll")), ".nojekyll");
assert.ok(fs.readFileSync(path.join(site, "index.html"), "utf8").includes('id="run-list"'), 'index.html has id="run-list"');

fs.rmSync(site, { recursive: true, force: true });
process.stdout.write("site-snapshot-smoke: ok\n");
