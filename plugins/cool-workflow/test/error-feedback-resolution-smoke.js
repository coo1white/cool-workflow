#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// v2 split the old flat `dist/state`: createRunPaths/ensureRunDirs/saveCheckpoint
// now live in shell/run-store, writeJson in shell/fs-atomic.
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/shell/run-store");
const { writeJson } = require("../dist/shell/fs-atomic");
const { createStateNode, appendRunNode } = require("../dist/core/state/state-node");
// REAL GAP (v2): recordFeedback ported to shell/error-feedback-io, but
// resolveFeedback + listFeedback have NO v2 equivalent — no function in
// src/ or dist/ transitions a feedback record to resolved (the
// resolvedAt/resolutionNote fields exist on ErrorFeedbackRecord but nothing
// writes them). Reported for a human judgement call; this smoke stays red.
const { recordFeedback } = require("../dist/shell/error-feedback-io");
const { resolveFeedback, listFeedback } = require("../dist/shell/error-feedback-io");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-feedback-resolution-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "feedback-resolution"));
ensureRunDirs(paths);
fs.mkdirSync(paths.feedbackDir, { recursive: true });

const run = {
  schemaVersion: 1,
  id: "feedback-resolution",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "feedback-resolution",
    title: "Feedback Resolution",
    summary: "",
    limits: { maxAgents: 1, maxConcurrentAgents: 1 }
  },
  inputs: {},
  loopStage: "interpret",
  phases: [],
  tasks: [],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: []
};
saveCheckpoint(run);

// Record feedback from a failed node to get a feedback record
const errorNode = appendRunNode(run, createStateNode({
  id: "feedback-resolution:error",
  kind: "error",
  status: "failed",
  loopStage: "act",
  errors: [{ code: "test-error", message: "test failure", at: new Date().toISOString() }]
}));
recordFeedback(run, {
  error: { code: "test-error", message: "test failure" },
  nodeId: errorNode.id,
  source: "pipeline-runner"
});

const feedbackList = listFeedback(run);
assert.ok(feedbackList.length > 0, "should have collected feedback");
const fb = feedbackList[0];
assert.equal(fb.status, "open");
assert.equal(fb.resolvedAt, undefined, "unresolved feedback should not have resolvedAt");
assert.equal(fb.resolutionNote, undefined);

// Resolve the feedback with a verified node
const verifierNode = appendRunNode(run, createStateNode({
  id: "feedback-resolution:verifier",
  kind: "verifier",
  status: "verified",
  loopStage: "adjust",
  evidence: [{ id: "ev-1", source: "test", locator: "test:1" }]
}));

const resolved = resolveFeedback(run, fb.id, {
  status: "resolved",
  nodeId: verifierNode.id,
  message: "test fix applied and verified"
});

assert.equal(resolved.status, "resolved");
assert.ok(resolved.resolvedAt, "resolved feedback should have resolvedAt timestamp");
assert.equal(resolved.resolutionNote, "test fix applied and verified");

// Verify the timestamp is recent (within last 5 seconds)
const resolvedAtMs = Date.parse(resolved.resolvedAt);
const nowMs = Date.now();
assert.ok(Number.isFinite(resolvedAtMs), "resolvedAt should be a valid date");
assert.ok(nowMs - resolvedAtMs < 5000, "resolvedAt should be within last 5s");

process.stdout.write("error-feedback-resolution-smoke: ok\n");
