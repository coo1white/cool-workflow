#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// This smoke exercises the whole collect -> task -> resolve flow: the pure
// decision half (core/pipeline/error-feedback: classifyFeedback /
// buildFeedbackRecord / summarizeFeedback) and the collect/list/resolve/
// correction-task/record API in shell/error-feedback-io.
import {
  recordFeedback,
  collectRunErrors,
  createCorrectionTask,
  listFeedback,
  resolveFeedback,
  runPipelineStage,
} from "../dist/shell/error-feedback-io.js";
import {
  createRunPaths,
  ensureRunDirs,
  loadRunFromCwd,
  saveCheckpoint,
} from "../dist/shell/run-store.js";
import { appendRunNode, createStateNode } from "../dist/core/state/state-node.js";
import { getRunContract } from "../dist/core/pipeline/runner.js";
// The pipeline runner is a set of free functions in core/pipeline/runner
// (getRunContract, runPipelineStage, advancePipeline, ...); the smoke's
// `runner.getRunContract` / `runner.runPipelineStage` below map to them.
// runPipelineStage is the shell-bound wrapper in error-feedback-io
// (recordFeedback wired in), so a failed stage writes a durable
// ErrorFeedback record.
const createPipelineRunner = () => ({ getRunContract, runPipelineStage });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-error-feedback-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "feedback-smoke"));
ensureRunDirs(paths);
fs.writeFileSync(paths.state, "{}\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "feedback-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "feedback-smoke",
    title: "Feedback Smoke",
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
  contracts: []
};
saveCheckpoint(run);

const runner = createPipelineRunner();
const contract = runner.getRunContract(run);
const input = appendRunNode(
  run,
  createStateNode({
    id: "feedback-smoke:input",
    kind: "input",
    status: "completed",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: paths.state }],
    contractId: contract.id
  })
);

const failed = runner.runPipelineStage(run, "commit", input.id, {
  outputNodeId: "feedback-smoke:error:commit"
});
assert.equal(failed.status, "failed");
assert.equal(failed.error.code, "unexpected-node-kind");

const feedback = listFeedback(run);
assert.equal(feedback.length, 1);
assert.equal(feedback[0].classification, "contract-violation");
assert.equal(feedback[0].retryable, false);
assert.ok(fs.existsSync(path.join(paths.feedbackDir, `${feedback[0].id}.json`)));
assert.ok(fs.existsSync(path.join(paths.feedbackDir, "index.json")));

const collected = collectRunErrors(run);
assert.equal(collected.length, 0);

const manual = recordFeedback(run, {
  source: "verifier",
  error: new Error("Task verify:result requires cw:result evidence"),
  taskId: "verify:result",
  retryable: false
});
assert.equal(manual.classification, "missing-evidence");

const tasked = createCorrectionTask(run, feedback[0].id, {
  verifierCommand: "node test/error-feedback-smoke.mjs"
});
assert.equal(tasked.status, "tasked");
assert.ok(tasked.correctionTaskId);
assert.ok(fs.existsSync(path.join(paths.tasksDir, `${tasked.correctionTaskId}.md`)));

assert.throws(
  () => resolveFeedback(run, feedback[0].id, { status: "resolved", nodeId: input.id }),
  /must be verified or committed/
);

const verified = appendRunNode(
  run,
  createStateNode({
    id: "feedback-smoke:verifier",
    kind: "verifier",
    status: "verified",
    loopStage: "adjust",
    evidence: [{ id: "verified", source: "test", locator: "test/error-feedback-smoke.mjs" }]
  })
);
const resolved = resolveFeedback(run, feedback[0].id, {
  status: "resolved",
  nodeId: verified.id,
  message: "Verified by smoke test"
});
assert.equal(resolved.status, "resolved");
assert.equal(resolved.resolvedByNodeId, verified.id);

const loaded = loadRunFromCwd("feedback-smoke", tmp);
assert.equal(loaded.paths.feedbackDir, paths.feedbackDir);
assert.equal(loaded.feedback.length, 2);

const cliList = JSON.parse(execFileSync("node", [path.join(import.meta.dirname, "../dist/cli.js"), "feedback", "list", "feedback-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliList.length, 2);

const cliShow = JSON.parse(execFileSync("node", [path.join(import.meta.dirname, "../dist/cli.js"), "feedback", "show", "feedback-smoke", feedback[0].id], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliShow.id, feedback[0].id);

const nodeList = JSON.parse(execFileSync("node", [path.join(import.meta.dirname, "../dist/cli.js"), "node", "list", "feedback-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.ok(nodeList.some((node) => node.id === "feedback-smoke:error:commit"));

const contractShow = JSON.parse(execFileSync("node", [path.join(import.meta.dirname, "../dist/cli.js"), "contract", "show", "feedback-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(contractShow.id, contract.id);

process.stdout.write("error-feedback-smoke: ok\n");
