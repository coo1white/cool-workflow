#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// v2 layout: flat src/ was split into core/ (pure) + shell/ (stateful I/O).
// commitState moved to shell/;
// run-path + checkpoint helpers moved to shell/run-store; the pure state-node
// helpers moved to core/state/state-node. Signatures are unchanged.
import { commitState } from "../dist/shell/commit.js";
import {
  createRunPaths,
  ensureRunDirs,
  loadRunFromCwd,
  saveCheckpoint,
} from "../dist/shell/run-store.js";
import { appendRunNode, createStateNode } from "../dist/core/state/state-node.js";

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
    evidence: [{ id: "result:1", source: "cw:result", locator: "test/verifier-gated-commit-smoke.mjs:1" }]
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
    evidence: [{ id: "verify:1", source: "cw:result", locator: "test/verifier-gated-commit-smoke.mjs:1" }]
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
// A blocked commit leaves an operator-visible feedback record: commit.ts's
// recordCommitGateFailure calls recordFeedback (src/shell/error-feedback-io.ts)
// with the gate-failure code, onto the deduped, disk-persisted feedback
// surface (the one cw doctor/report reads).
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

// The candidate/selection gate options went with the multi-agent family
// (slim-and-esm step 2): a candidate or selection id is no longer a way to
// name the verifier, so a gated commit that names only one fails closed
// with commit-verifier-required — never a silent pass.
assert.throws(
  () =>
    commitState(run, {
      reason: "old candidate option",
      candidateId: "candidate-one",
      selectionId: "selection-one",
      verifierGated: true,
      source: "cli"
    }),
  /Verifier-gated commit requires --verifier$/
);

const verifierCommit = commitState(run, {
  reason: "explicit verifier",
  verifierNodeId: "commit-smoke:verifier:task-one",
  verifierGated: true,
  source: "cli"
});
assert.equal(verifierCommit.verifierGated, true);
assert.equal(verifierCommit.verifierNodeId, "commit-smoke:verifier:task-one");
assert.ok(!("candidateId" in verifierCommit), "a commit carries no candidate id");
assert.ok(!("selectionId" in verifierCommit), "a commit carries no selection id");
assert.ok(!("review" in verifierCommit), "a commit carries no review provenance (no review gate)");
const verifierCommitNode = run.nodes.find((node) => node.id === verifierCommit.stateNodeId);
assert.ok(verifierCommitNode.parents.includes("commit-smoke:verifier:task-one"));

saveCheckpoint(run);

assert.throws(
  () =>
    execFileSync("node", [path.join(import.meta.dirname, "../dist/cli.js"), "commit", "commit-smoke", "--reason", "plain manual"], {
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
      path.join(import.meta.dirname, "../dist/cli.js"),
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
