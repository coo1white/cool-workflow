#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
// DEFERRED-TOOLING (v2 cutover): this smoke has no dist imports of its own — it
// shells out to scripts/dogfood-release.js and asserts on that script's JSON.
// That script still does require("../dist/orchestrator.js"), a flat v0 dist path
// gone in v2 (the CoolWorkflowRunner facade now lives at
// dist/shell/run-registry-io.js). The test file needs no rewrite; the fix is to
// repoint the SCRIPT's require, which is Phase C/D tooling-repoint work, not this
// smoke-rewrite job. Do NOT edit scripts/dogfood-release.js from here.
const summary = JSON.parse(
  execFileSync(process.execPath, [path.join(pluginRoot, "scripts/dogfood-release.js"), "--smoke", "--json"], {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 30,
    env: { ...process.env, CW_DOGFOOD_SMOKE_TEST: "1" }
  })
);

assert.equal(summary.ok, true);
assert.equal(summary.mode, "smoke");
assert.equal(summary.dryRun, true);
assert.match(summary.runId, /^release-cut-/);
assert.ok(fs.existsSync(summary.statePath), "dogfood state must exist");
assert.ok(fs.existsSync(summary.reportPath), "dogfood report must exist");
assert.ok(fs.existsSync(summary.auditSummaryPath), "audit summary must exist");
assert.ok(fs.existsSync(summary.summaryPath), "machine summary must exist");
assert.match(summary.verifierNodeId, /:verifier:verdict:release$/, "commit is gated on the verdict task's verifier node");
for (const key of ["candidateId", "scoreId", "selectionId"]) assert.equal(key in summary, false, `summary has no ${key}`);
assert.ok(summary.commitId);
assert.equal(summary.checkpointId, null);
assert.equal(summary.releaseVerdict, "ready-dry-run");
assert.equal(summary.releaseActions.skipped, true);

const state = JSON.parse(fs.readFileSync(summary.statePath, "utf8"));
assert.equal(state.workflow.id, "release-cut");
assert.equal(state.workflow.app.id, "release-cut");
assert.equal(state.workflow.app.version, "0.3.0");
assert.equal(state.inputs.repo, repoRoot);
assert.equal(state.inputs.version, "0.3.0");
assert.equal(state.inputs.previousVersion, "0.1.31");
assert.equal(state.inputs.dryRun, "true");

assert.ok(state.workers.length >= 6, "dogfood run must allocate isolated workers");
assert.ok(state.workers.every((worker) => worker.sandboxProfileId), "workers must carry sandbox profiles");
assert.ok(state.tasks.every((task) => task.status === "completed"), "all release-cut tasks must complete");
assert.ok(state.tasks.every((task) => task.workerId), "all tasks must be tied to workers");
assert.ok(state.tasks.every((task) => task.verifierNodeId), "all tasks must have verifier nodes");

assert.equal((state.candidates || []).length, 0, "the release path registers no candidate");

const commit = state.commits.find((entry) => entry.id === summary.commitId);
assert.ok(commit, "verifier-gated commit must exist");
assert.equal(commit.verifierGated, true);
assert.equal(commit.checkpoint, false);
assert.equal(commit.verifierNodeId, summary.verifierNodeId);
assert.ok(commit.evidence.length > 0, "commit must preserve evidence");

const audit = JSON.parse(fs.readFileSync(summary.auditSummaryPath, "utf8"));
assert.ok(audit.eventCount >= state.workers.length, "trust audit records must be durable");
assert.ok(audit.byKind["worker.sandbox-profile"] >= state.workers.length);
assert.ok(audit.byKind["commit.gate"] >= 1);

const report = fs.readFileSync(summary.reportPath, "utf8");
assert.match(report, /Workflow App: release-cut@0\.3\.0/);
assert.match(report, /## Trust Audit/);

assert.ok(summary.commandResults.some((entry) => entry.id === "npm-pack-dry-run" && entry.status === 0));
assert.ok(summary.commandResults.some((entry) => entry.id === "app-validate-release-cut" && entry.status === 0));
assert.ok(summary.commandResults.every((entry) => fs.existsSync(entry.logPath)));

process.stdout.write("dogfood-release-smoke: ok\n");
