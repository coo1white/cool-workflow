#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { commitState } = require("../dist/commit");
const { registerCandidate, scoreCandidate, selectCandidate } = require("../dist/candidate-scoring");
const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const { appendRunNode, createStateNode } = require("../dist/state-node");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-verifier-gated-commit-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "commit-smoke"));
ensureRunDirs(paths);

const resultPath = path.join(paths.resultsDir, "verified-result.md");
fs.writeFileSync(resultPath, "verified result\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "commit-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "commit-smoke",
    title: "Commit Smoke",
    summary: "",
    limits: { maxAgents: 1, maxConcurrentAgents: 1 }
  },
  inputs: {},
  loopStage: "checkpoint",
  phases: [],
  tasks: [
    {
      id: "task-one",
      kind: "agent",
      phase: "Verify",
      status: "completed",
      requiresEvidence: true,
      prompt: "Verify one result.",
      taskPath: "",
      resultPath,
      loopStage: "observe",
      resultNodeId: "commit-smoke:result:task-one",
      verifierNodeId: "commit-smoke:verifier:task-one",
      workerId: "worker-one",
      sandboxProfileId: "readonly"
    }
  ],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: [],
  workers: [
    {
      schemaVersion: 1,
      id: "worker-one",
      runId: "commit-smoke",
      taskId: "task-one",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verified",
      workerDir: path.join(paths.workersDir, "worker-one"),
      inputPath: path.join(paths.workersDir, "worker-one", "input.md"),
      resultPath,
      artifactsDir: path.join(paths.workersDir, "worker-one", "artifacts"),
      logsDir: path.join(paths.workersDir, "worker-one", "logs"),
      allowedPaths: [resultPath],
      sandboxProfileId: "readonly",
      resultNodeId: "commit-smoke:result:task-one",
      feedbackIds: [],
      errors: [],
      output: {
        workerId: "worker-one",
        taskId: "task-one",
        resultPath,
        recordedAt: new Date().toISOString(),
        stateNodeId: "commit-smoke:result:task-one",
        verifierNodeId: "commit-smoke:verifier:task-one"
      }
    }
  ],
  candidates: [],
  candidateSelections: []
};

appendRunNode(
  run,
  createStateNode({
    id: "commit-smoke:result:task-one",
    kind: "result",
    status: "completed",
    loopStage: "observe",
    artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
    evidence: [{ id: "result:1", source: "cw:result", locator: "test/verifier-gated-commit-smoke.js:1" }]
  })
);
appendRunNode(
  run,
  createStateNode({
    id: "commit-smoke:verifier:task-one",
    kind: "verifier",
    status: "verified",
    loopStage: "adjust",
    artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
    evidence: [{ id: "verify:1", source: "cw:result", locator: "test/verifier-gated-commit-smoke.js:1" }]
  })
);
appendRunNode(
  run,
  createStateNode({
    id: "commit-smoke:verifier:no-evidence",
    kind: "verifier",
    status: "verified",
    loopStage: "adjust",
    artifacts: [{ id: "result", kind: "markdown", path: resultPath }]
  })
);
saveCheckpoint(run);

const resultCommit = commitState(run, "result:task-one");
assert.equal(resultCommit.verifierGated, true);
assert.equal(resultCommit.checkpoint, false);
assert.equal(resultCommit.verifierNodeId, "commit-smoke:verifier:task-one");
assert.equal(resultCommit.evidence.length, 1);
// Regression guard: StateCommit must not carry the dropped spec-debt fields.
// `partial` / `partialTaskIds` / `parentCommitId` were defined but never read,
// so they were removed; a commit must not re-grow them.
assert.ok(!("partial" in resultCommit), "StateCommit must not carry the dropped `partial` field");
assert.ok(!("partialTaskIds" in resultCommit), "StateCommit must not carry the dropped `partialTaskIds` field");
assert.ok(!("parentCommitId" in resultCommit), "StateCommit must not carry the dropped `parentCommitId` field");
const resultCommitNode = run.nodes.find((node) => node.id === resultCommit.stateNodeId);
assert.equal(resultCommitNode.status, "committed");
assert.equal(resultCommitNode.metadata.verifierGated, true);
assert.equal(resultCommitNode.metadata.checkpoint, false);

assert.throws(
  () =>
    commitState(run, {
      reason: "missing verifier",
      verifierNodeId: "commit-smoke:verifier:missing",
      verifierGated: true,
      source: "cli"
    }),
  /Verifier node not found/
);
assert.ok(run.feedback.some((record) => record.code === "commit-verifier-not-found"));

assert.throws(
  () =>
    commitState(run, {
      reason: "no evidence",
      verifierNodeId: "commit-smoke:verifier:no-evidence",
      verifierGated: true,
      source: "cli"
    }),
  /has no evidence/
);
assert.ok(run.feedback.some((record) => record.code === "commit-verifier-missing-evidence"));

const checkpoint = commitState(run, {
  reason: "explicit compatibility checkpoint",
  allowUnverifiedCheckpoint: true,
  source: "cli"
});
assert.equal(checkpoint.verifierGated, false);
assert.equal(checkpoint.checkpoint, true);
const checkpointNode = run.nodes.find((node) => node.id === checkpoint.stateNodeId);
assert.equal(checkpointNode.status, "completed");
assert.equal(checkpointNode.metadata.verifierGated, false);

const unscored = registerCandidate(
  run,
  {
    id: "candidate-unscored",
    kind: "manual",
    resultNodeId: "commit-smoke:result:task-one",
    verifierNodeId: "commit-smoke:verifier:task-one",
    resultPath
  },
  { persist: false }
);
assert.throws(
  () =>
    commitState(run, {
      reason: "unscored candidate",
      candidateId: unscored.id,
      verifierGated: true,
      source: "cli"
    }),
  /has no score evidence|has no verified selection|not verifier-gated/
);

const candidate = registerCandidate(
  run,
  {
    id: "candidate-one",
    kind: "worker-output",
    workerId: "worker-one",
    taskId: "task-one",
    resultNodeId: "commit-smoke:result:task-one",
    verifierNodeId: "commit-smoke:verifier:task-one",
    resultPath
  },
  { persist: false }
);
scoreCandidate(
  run,
  candidate.id,
  {
    id: "score-one",
    scorer: "smoke",
    criteria: { correctness: 4, evidence: 4, fit: 2 },
    maxTotal: 10,
    evidence: [{ id: "score:evidence", source: "test", locator: "test/verifier-gated-commit-smoke.js:1" }]
  },
  { persist: false }
);
const selection = selectCandidate(run, candidate.id, { reason: "verified winner" }, { persist: false });
const selectionCommit = commitState(run, {
  reason: "selected candidate",
  selectionId: selection.id,
  verifierGated: true,
  source: "cli"
});
assert.equal(selectionCommit.verifierGated, true);
assert.equal(selectionCommit.candidateId, candidate.id);
assert.equal(selectionCommit.selectionId, selection.id);
assert.equal(selectionCommit.verifierNodeId, "commit-smoke:verifier:task-one");
const selectionNode = run.nodes.find((node) => node.metadata && node.metadata.selectionId === selection.id);
const selectionCommitNode = run.nodes.find((node) => node.id === selectionCommit.stateNodeId);
assert.ok(selectionCommitNode.parents.includes(selectionNode.id));

saveCheckpoint(run);

assert.throws(
  () =>
    execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "commit", "commit-smoke", "--reason", "plain manual"], {
      cwd: tmp,
      encoding: "utf8",
      stdio: "pipe"
    }),
  /Verifier-gated commit requires/
);
const afterPlain = loadRunFromCwd("commit-smoke", tmp);
assert.ok(afterPlain.feedback.some((record) => record.code === "commit-verifier-required"));

const cliCheckpoint = JSON.parse(
  execFileSync(
    "node",
    [
      path.join(__dirname, "../dist/cli.js"),
      "commit",
      "commit-smoke",
      "--allow-unverified-checkpoint",
      "--reason",
      "operator checkpoint"
    ],
    {
      cwd: tmp,
      encoding: "utf8"
    }
  )
);
assert.equal(cliCheckpoint.commit.verifierGated, false);
assert.equal(cliCheckpoint.commit.checkpoint, true);

process.stdout.write("verifier-gated-commit-smoke: ok\n");
