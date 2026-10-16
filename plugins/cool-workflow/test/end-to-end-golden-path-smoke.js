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
assert.ok(summary.workerId);
// The commit is gated on the worker's own verifier node (no candidate or
// selection step since slim-and-esm step 2).
assert.match(summary.verifierNodeId, /:verifier:/);
assert.equal(summary.candidateId, undefined);
assert.equal(summary.selectionId, undefined);
assert.ok(summary.commitId);
assert.ok(Array.isArray(summary.evidence));
assert.ok(summary.evidence.length >= 3);

process.stdout.write("end-to-end-golden-path-smoke: ok\n");
