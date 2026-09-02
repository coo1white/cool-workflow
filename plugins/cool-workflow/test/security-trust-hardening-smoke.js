#!/usr/bin/env node
"use strict";
//
// CUTOVER STATUS: REAL-GAP (test left failing on purpose).
// Imports are repointed to v2 dist (shell/*). The pure-function + worker
// stages (lines ~87-118) pass under v2. The smoke then fails at the first
// `cw audit decision` call because v2 never ported three audit subcommands:
//   - `cw audit decision`   (record/validate a sandbox path/command/network/env decision)
//   - `cw audit worker`     (read trust/audit for one worker)
//   - `cw audit provenance` (inspect evidence provenance for a commit)
// and never ported the `evidenceProvenance()` library function used at line ~185.
// Evidence in v2 source:
//   src/core/capability-table.ts  declare cw_audit_worker /
//     cw_audit_provenance / cw_audit_decision as MCP tools, but NO
//     `path: ["audit","decision"|"worker"|"provenance"]` capability row is
//     registered (only verify/summary/multi-agent/policy/judge are — lines
//     1195, 2403, 2410, 2417, 2424), so these fall through to the audit.usage
//     error at capability-table.ts:2549-2561.
//   src/shell/trust-audit.ts  exports summarizeTrustAudit/normalizeEvidence but
//     has no `evidenceProvenance` export.
// This is Phase-B work (complete v2); do NOT weaken the assertions to force green.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// v2 cutover: OLD flat dist modules split into shell/ + core/.
//   ../dist/commit            -> ../dist/shell/commit
//   ../dist/candidate-scoring -> ../dist/shell/candidate-scoring-io
//   ../dist/state (run I/O)    -> ../dist/shell/run-store
//   ../dist/worker-isolation  -> ../dist/shell/worker-isolation
//   ../dist/trust-audit       -> ../dist/shell/trust-audit
const { commitState } = require("../dist/shell/commit");
const { registerCandidate, scoreCandidate, selectCandidate } = require("../dist/shell/candidate-scoring-io");
const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/shell/run-store");
const { allocateWorkerScope, recordWorkerOutput } = require("../dist/shell/worker-isolation");
// REAL-GAP: v2 dropped `evidenceProvenance`. src/shell/trust-audit.ts exports
// normalizeEvidence/summarizeTrustAudit but no evidenceProvenance function, and
// no CLI `audit provenance`/`audit worker`/`audit decision` handler exists
// (capability-table.ts:282-290 declare the MCP tools, but no `path: ["audit",
// "provenance"|"worker"|"decision"]` row is registered — they fall through to
// the audit.usage error). See report.
const { summarizeTrustAudit } = require("../dist/shell/trust-audit");
// v2 cutover: evidenceProvenance moved to shell/audit-provenance.js (the v2
// shell/trust-audit.ts is the audited chain writer and does not re-export the
// read/record helpers; audit-provenance.ts wraps them over its primitives).
const { evidenceProvenance } = require("../dist/shell/audit-provenance");

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
