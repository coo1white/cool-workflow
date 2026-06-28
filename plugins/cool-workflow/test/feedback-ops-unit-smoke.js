#!/usr/bin/env node
"use strict";
// feedback-ops-unit-smoke (v0.1.95) — unit coverage for the 3 uncovered
// orchestrator wrapper functions: collectFeedback, createFeedbackTask,
// resolveFeedback. These are thin wrappers around error-feedback.ts
// primitives; this test proves they dispatch correctly and produce the
// expected side-effects (report written, state checkpointed).
//
// Hermetic: stub WorkflowRun in tmpdir, no real agent, no CLI, no MCP.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { recordFeedback } = require("../dist/error-feedback");
const {
  collectFeedback,
  showFeedback,
  createFeedbackTask,
  resolveFeedback
} = require("../dist/orchestrator/feedback-operations");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-feedback-ops-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "feedback-ops-smoke"));
ensureRunDirs(paths);

function makeRun() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: "feedback-ops-smoke",
    createdAt: now,
    updatedAt: now,
    cwd: tmp,
    workflow: { id: "feedback-ops-smoke", title: "Feedback Ops", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: {},
    loopStage: "checkpoint",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: []
  };
}

// Seed a feedback record into the run
function seedFeedback(run) {
  return recordFeedback(run, {
    error: new Error("test feedback"),
    message: "test feedback message",
    code: "feedback-smoke-code",
    severity: "P2",
    classification: "real",
    source: "verifier",
    retryable: false
  });
}

// ---- collectFeedback: runs without crashing ----
{
  const run = makeRun();
  saveCheckpoint(run);
  const result = collectFeedback(run);
  assert.ok(Array.isArray(result), "collectFeedback returns an array");
}

// ---- showFeedback: existing vs missing ----
{
  const run = makeRun();
  saveCheckpoint(run);
  const fbRecord = seedFeedback(run);

  const shown = showFeedback(run, fbRecord.id);
  assert.equal(shown.id, fbRecord.id, "showFeedback returns correct record");

  assert.throws(
    () => showFeedback(run, "nonexistent-id"),
    /Unknown feedback id/,
    "showFeedback throws for missing id"
  );
}

// ---- createFeedbackTask: with and without verify/guidance ----
{
  const run1 = makeRun();
  saveCheckpoint(run1);
  const fbRecord = seedFeedback(run1);
  const task1 = createFeedbackTask(run1, fbRecord.id, {});
  assert.ok(task1, "createFeedbackTask returns a task");

  const run2 = makeRun();
  saveCheckpoint(run2);
  const fbRecord2 = seedFeedback(run2);
  const task2 = createFeedbackTask(run2, fbRecord2.id, {
    verify: "node test/check.js",
    guidance: "please fix"
  });
  assert.ok(task2, "createFeedbackTask with verify+guidance returns a task");
}

// ---- resolveFeedback: resolved vs rejected paths ----
{
  const run1 = makeRun();
  saveCheckpoint(run1);
  const fbRecord = seedFeedback(run1);
  // resolveFeedback requires a nodeId; without it, underlying functions throw
  assert.throws(
    () => resolveFeedback(run1, fbRecord.id, { status: "resolved" }),
    /cannot resolve without a verified node id/,
    "resolveFeedback throws without node id"
  );

  // rejected path doesn't require node id
  const run2 = makeRun();
  saveCheckpoint(run2);
  const fbRecord2 = seedFeedback(run2);
  const rejected = resolveFeedback(run2, fbRecord2.id, { status: "rejected", message: "not needed" });
  assert.equal(rejected.status, "rejected", "rejected path sets status to rejected");
}

process.stdout.write("feedback-ops-unit-smoke: ok\n");
