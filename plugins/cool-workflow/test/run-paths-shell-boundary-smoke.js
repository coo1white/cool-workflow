#!/usr/bin/env node
"use strict";

// Run path math belongs in core. Directory writes belong in shell.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const coreSource = fs.readFileSync(path.join(pluginRoot, "src", "core", "state", "run-paths.ts"), "utf8");
const coreRunPaths = require(path.join(pluginRoot, "dist", "core", "state", "run-paths.js"));
const runStore = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));

assert.doesNotMatch(coreSource, /node:fs|mkdirSync|ensureRunDirs/, "core run paths must be pure path math");
assert.equal(typeof coreRunPaths.createRunPaths, "function");
assert.equal(coreRunPaths.ensureRunDirs, undefined, "core must not export the directory writer");
assert.equal(runStore.createRunPaths, coreRunPaths.createRunPaths, "shell keeps the current createRunPaths export");
assert.equal(typeof runStore.ensureRunDirs, "function", "shell exports the directory writer");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-path-boundary-"));
const runDir = path.join(root, "run");
const paths = coreRunPaths.createRunPaths(runDir);
delete paths.auditDir;
delete paths.workersDir;
runStore.ensureRunDirs(paths);

for (const name of ["tasks", "results", "dispatches", "artifacts", "commits", "nodes", "feedback", "audit", "workers"]) {
  assert.ok(fs.statSync(path.join(runDir, name)).isDirectory(), `${name} directory is made`);
}

// candidates/multi-agent/blackboard/topologies stayed empty in the sample
// run (see the intent doc this PR closes) — ensureRunDirs no longer makes
// them up front; each is made on first use by its own writer instead.
for (const name of ["candidates", "multi-agent", "blackboard", "topologies"]) {
  assert.ok(!fs.existsSync(path.join(runDir, name)), `${name} is not made until the run writes to it`);
}

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("run-paths-shell-boundary-smoke: ok\n");
