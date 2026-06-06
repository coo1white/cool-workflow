#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  collectRunErrors,
  createCorrectionTask,
  listFeedback,
  recordFeedback,
  resolveFeedback
} = require("../dist/error-feedback");
const { createPipelineRunner } = require("../dist/pipeline-runner");
const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const { appendRunNode, createStateNode } = require("../dist/state-node");

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
  verifierCommand: "node test/error-feedback-smoke.js"
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
    evidence: [{ id: "verified", source: "test", locator: "test/error-feedback-smoke.js" }]
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

const cliList = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "feedback", "list", "feedback-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliList.length, 2);

const cliShow = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "feedback", "show", "feedback-smoke", feedback[0].id], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliShow.id, feedback[0].id);

const nodeList = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "node", "list", "feedback-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.ok(nodeList.some((node) => node.id === "feedback-smoke:error:commit"));

const contractShow = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "contract", "show", "feedback-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(contractShow.id, contract.id);

process.stdout.write("error-feedback-smoke: ok\n");
