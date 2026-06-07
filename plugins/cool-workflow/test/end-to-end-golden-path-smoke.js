#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const output = execFileSync(process.execPath, [path.join(pluginRoot, "scripts/golden-path.js"), "--json", "--cleanup"], {
  cwd: pluginRoot,
  encoding: "utf8"
});
const summary = JSON.parse(output);

assert.equal(summary.ok, true);
assert.match(summary.runId, /^end-to-end-golden-path-/);
assert.equal(summary.candidateId, "golden-candidate");
assert.ok(summary.workerId);
assert.ok(summary.selectionId);
assert.ok(summary.commitId);
assert.ok(Array.isArray(summary.evidence));
assert.ok(summary.evidence.length >= 3);

process.stdout.write("end-to-end-golden-path-smoke: ok\n");
