#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { commitState } = require("../dist/commit");
const { registerCandidate, scoreCandidate, selectCandidate } = require("../dist/candidate-scoring");
const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const { allocateWorkerScope, recordWorkerOutput } = require("../dist/worker-isolation");
const { summarizeTrustAudit, evidenceProvenance } = require("../dist/trust-audit");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-security-trust-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "trust-smoke"));
ensureRunDirs(paths);

const cli = path.join(__dirname, "../dist/cli.js");
const taskPath = path.join(paths.tasksDir, "trust.md");
fs.writeFileSync(taskPath, "trust task\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "trust-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "trust-smoke",
    title: "Trust Smoke",
    summary: "",
    limits: { maxAgents: 2, maxConcurrentAgents: 2 }
  },
  inputs: {},
  loopStage: "interpret",
  phases: [{ id: "trust", name: "Trust", status: "pending", taskIds: ["trust:accept", "trust:deny"] }],
  tasks: [
    {
      id: "trust:accept",
      kind: "agent",
      phase: "Trust",
      status: "pending",
      requiresEvidence: true,
      prompt: "Produce accepted trust evidence.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: "trust-smoke:task:trust:accept"
    },
    {
      id: "trust:deny",
      kind: "agent",
      phase: "Trust",
      status: "pending",
      requiresEvidence: false,
      prompt: "Exercise denied trust decisions.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: "trust-smoke:task:trust:deny"
    }
  ],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: [],
  workers: [],
  sandboxProfiles: [],
  candidates: [],
  candidateSelections: []
};

const accepted = allocateWorkerScope(run, run.tasks[0], {
  workerId: "worker-accepted",
  sandboxProfileId: "readonly",
  persist: false
});
const denied = allocateWorkerScope(run, run.tasks[1], {
  workerId: "worker-denied",
  sandboxProfileId: "readonly",
  persist: false
});
assert.equal(accepted.sandboxProfileId, "readonly");
assert.equal(accepted.sandboxPolicy.network.mode, "none");

fs.writeFileSync(
  accepted.resultPath,
  [
    "# Accepted",
    "",
    "Readonly worker returned evidence.",
    "",
    "```cw:result",
    JSON.stringify({
      summary: "accepted trust result",
      findings: [],
      evidence: ["test/security-trust-hardening-smoke.js:1"]
    }),
    "```",
    ""
  ].join("\n"),
  "utf8"
);
const output = recordWorkerOutput(run, accepted.id, accepted.resultPath, { persist: false });
assert.ok(output.auditEventIds.length >= 2);
saveCheckpoint(run);

const deniedPath = path.join(tmp, "outside.md");
const pathDecision = runJson(["audit", "decision", "trust-smoke", denied.id, "--path", deniedPath]);
assert.equal(pathDecision.decision, "denied");
const commandDecision = runJson(["audit", "decision", "trust-smoke", denied.id, "--command", "npm test"]);
assert.equal(commandDecision.decision, "allowed");
const networkDecision = runJson(["audit", "decision", "trust-smoke", denied.id, "--network", "example.com"]);
assert.equal(networkDecision.decision, "denied");
const envDecision = runJson(["audit", "decision", "trust-smoke", denied.id, "--env", "SECRET_TOKEN=do-not-store"]);
assert.equal(envDecision.decision, "denied");
assert.deepEqual(envDecision.envVars, ["SECRET_TOKEN"]);

let loaded = loadRunFromCwd("trust-smoke", tmp);
assert.ok(loaded.feedback.some((record) => record.classification === "sandbox-policy"));
assert.ok(loaded.feedback.some((record) => record.code === "sandbox-network-denied"));
assert.ok(loaded.feedback.some((record) => record.code === "sandbox-env-denied"));

const resultNode = loaded.nodes.find((node) => node.id === output.stateNodeId);
const verifierNode = loaded.nodes.find((node) => node.id === output.verifierNodeId);
assert.equal(resultNode.evidence[0].provenance.workerId, accepted.id);
assert.equal(verifierNode.status, "verified");

const candidate = registerCandidate(
  loaded,
  {
    id: "trust-candidate",
    kind: "worker-output",
    workerId: accepted.id,
    taskId: "trust:accept",
    resultNodeId: output.stateNodeId,
    verifierNodeId: output.verifierNodeId,
    resultPath: accepted.resultPath
  },
  { persist: false }
);
const score = scoreCandidate(
  loaded,
  candidate.id,
  {
    id: "trust-score",
    scorer: "trust-smoke",
    criteria: { correctness: 4, evidence: 4, leastPrivilege: 2 },
    maxTotal: 10,
    evidence: [{ id: "score:evidence", source: "test", locator: "test/security-trust-hardening-smoke.js:1" }]
  },
  { persist: false }
);
const selection = selectCandidate(loaded, candidate.id, { reason: "trust chain selected" }, { persist: false });
assert.equal(selection.acceptanceRationale.selectedCandidateId, candidate.id);
assert.equal(selection.acceptanceRationale.scoreId, score.id);
assert.equal(selection.acceptanceRationale.sandboxProfileId, "readonly");
assert.equal(selection.acceptanceRationale.workerId, accepted.id);

const commit = commitState(loaded, {
  reason: "trust verifier-gated commit",
  selectionId: selection.id,
  verifierGated: true,
  source: "cli"
});
assert.equal(commit.verifierGated, true);
assert.equal(commit.acceptanceRationale.selectedCandidateId, candidate.id);
assert.equal(commit.acceptanceRationale.commitGateResult, "passed");
assert.ok(commit.evidence.every((entry) => entry.provenance && entry.provenance.commitId === commit.id));
saveCheckpoint(loaded);

const summary = summarizeTrustAudit(loaded);
assert.ok(summary.eventCount >= 10);
assert.equal(summary.bySandboxProfile.readonly >= 1, true);
assert.ok(summary.workers.find((worker) => worker.workerId === denied.id).denied >= 3);
assert.ok(summary.commits.find((entry) => entry.commitId === commit.id).rationale);
assert.ok(fs.existsSync(summary.eventLogPath));
assert.ok(fs.existsSync(summary.summaryPath));
assert.ok(fs.existsSync(summary.indexPath));

const provenance = evidenceProvenance(loaded, { commitId: commit.id });
assert.ok(provenance.evidence.length > 0);
assert.ok(provenance.evidence.every((entry) => entry.provenance.commitId === commit.id));

const cliSummary = runJson(["audit", "summary", "trust-smoke"]);
assert.equal(cliSummary.runId, "trust-smoke");
assert.ok(cliSummary.eventCount >= summary.eventCount);
const cliWorker = runJson(["audit", "worker", "trust-smoke", accepted.id]);
assert.ok(cliWorker.events.some((event) => event.kind === "worker.output"));
const cliProvenance = runJson(["audit", "provenance", "trust-smoke", "--commit", commit.id]);
assert.ok(cliProvenance.evidence.length > 0);

process.stdout.write("security-trust-hardening-smoke: ok\n");

function runJson(args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: tmp, encoding: "utf8" }));
}
