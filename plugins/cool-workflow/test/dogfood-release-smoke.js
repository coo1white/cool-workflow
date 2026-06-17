#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
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
assert.equal(summary.candidateId, "dogfood-release-0.1.84");
assert.ok(summary.scoreId);
assert.ok(summary.selectionId);
assert.ok(summary.commitId);
assert.equal(summary.checkpointId, null);
assert.equal(summary.releaseVerdict, "ready-dry-run");
assert.equal(summary.releaseActions.skipped, true);

const state = JSON.parse(fs.readFileSync(summary.statePath, "utf8"));
assert.equal(state.workflow.id, "release-cut");
assert.equal(state.workflow.app.id, "release-cut");
assert.equal(state.workflow.app.version, "0.1.84");
assert.equal(state.inputs.repo, repoRoot);
assert.equal(state.inputs.version, "0.1.84");
assert.equal(state.inputs.previousVersion, "0.1.31");
assert.equal(state.inputs.dryRun, "true");

assert.ok(state.workers.length >= 6, "dogfood run must allocate isolated workers");
assert.ok(state.workers.every((worker) => worker.sandboxProfileId), "workers must carry sandbox profiles");
assert.ok(state.tasks.every((task) => task.status === "completed"), "all release-cut tasks must complete");
assert.ok(state.tasks.every((task) => task.workerId), "all tasks must be tied to workers");
assert.ok(state.tasks.every((task) => task.verifierNodeId), "all tasks must have verifier nodes");

const candidate = state.candidates.find((entry) => entry.id === summary.candidateId);
assert.ok(candidate, "release candidate must be registered");
assert.equal(candidate.status, "verified");
assert.ok(candidate.scores.includes(summary.scoreId), "candidate score must be linked");
assert.ok(candidate.evidence.length > 0, "candidate must preserve evidence");

const selection = state.candidateSelections.find((entry) => entry.id === summary.selectionId);
assert.ok(selection, "candidate selection must exist");
assert.equal(selection.candidateId, summary.candidateId);
assert.ok(selection.acceptanceRationale);
assert.equal(selection.acceptanceRationale.selectedCandidateId, summary.candidateId);
assert.equal(selection.acceptanceRationale.commitGateResult, "passed");

const commit = state.commits.find((entry) => entry.id === summary.commitId);
assert.ok(commit, "verifier-gated commit must exist");
assert.equal(commit.verifierGated, true);
assert.equal(commit.checkpoint, false);
assert.equal(commit.selectionId, summary.selectionId);
assert.equal(commit.candidateId, summary.candidateId);
assert.ok(commit.evidence.length > 0, "commit must preserve evidence");

const audit = JSON.parse(fs.readFileSync(summary.auditSummaryPath, "utf8"));
assert.ok(audit.eventCount >= state.workers.length, "trust audit records must be durable");
assert.ok(audit.byKind["worker.sandbox-profile"] >= state.workers.length);
assert.ok(audit.byKind["candidate.score"] >= 1);
assert.ok(audit.byKind["candidate.selection"] >= 1);
assert.ok(audit.byKind["commit.gate"] >= 1);

const report = fs.readFileSync(summary.reportPath, "utf8");
assert.match(report, /Workflow App: release-cut@0\.1\.84/);
assert.match(report, /## Candidates/);
assert.match(report, /## Trust Audit/);
assert.match(report, /## Acceptance Rationale/);
assert.match(report, /dogfood-release-0\.1\.84/);

assert.ok(summary.commandResults.some((entry) => entry.id === "canonical-apps" && entry.status === 0));
assert.ok(summary.commandResults.some((entry) => entry.id === "golden-path" && entry.status === 0));
assert.ok(summary.commandResults.every((entry) => fs.existsSync(entry.logPath)));

// v0.1.84: the architecture-review agent-delegation dogfood, --smoke half (CI-
// verifiable; the live full-drive against a real repo is the maintainer bar, OUT
// of CI). A hermetic STUB agent drives the real app to a committed audited report.
const archReview = JSON.parse(
  execFileSync(process.execPath, [path.join(pluginRoot, "scripts/dogfood-architecture-review.js"), "--smoke", "--json"], {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 30
  })
);
try {
  assert.equal(archReview.ok, true, "architecture-review --smoke drive ok");
  assert.equal(archReview.mode, "smoke");
  assert.ok(fs.existsSync(archReview.reportPath), "audited report exists");
  assert.ok(fs.existsSync(archReview.auditSummaryPath), "audit summary exists");
  assert.equal(archReview.verdictAccepted, true, "the Verdict node was accepted");
  assert.ok(archReview.agentDelegationEvents >= 1, "audit.byKind['worker.agent-delegation'] >= 1");
  assert.equal(archReview.completedWorkers, archReview.plannedWorkers, "every planned worker driven (zero hand-written result.md)");
} finally {
  if (archReview.workspace) fs.rmSync(archReview.workspace, { recursive: true, force: true });
}

process.stdout.write("dogfood-release-smoke: ok\n");
