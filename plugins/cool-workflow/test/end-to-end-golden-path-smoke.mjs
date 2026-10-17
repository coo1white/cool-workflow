#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const output = execFileSync(process.execPath, [path.join(pluginRoot, "scripts/golden-path.mjs"), "--json", "--cleanup"], {
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
