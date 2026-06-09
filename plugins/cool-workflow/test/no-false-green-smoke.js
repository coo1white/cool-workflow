#!/usr/bin/env node
"use strict";
// HARD no-false-green gate (v0.1.43).
//
// Empty-capture (a worker result with NO findings AND NO grounded evidence, even
// after robust normalization) is ACCEPTED with a recorded `captureWarning` — but
// it MUST NOT be presentable as a clean/green verifier-gated commit.
//
// The dangerous shape this gate closes: a `verified` verifier node that carries
// only a NON-grounded summary fallback as "evidence" (evidence.length === 1) for
// an OPTIONAL-evidence task (e.g. `map:` — taskRequiresEvidence === false). Such a
// node passes the verifier-not-verified check, the evidence-length check, AND the
// grounding check (which only fires for evidence-requiring tasks), so WITHOUT this
// gate it commits clean/green even though the backing result captured zero real
// signal. This test reconstructs that exact state and proves:
//
//   1. The commit FAILS CLOSED with `commit-rationale-empty-capture`, visibly:
//      a thrown CommitGateError + a `commit-gate-failed` state node + feedback,
//      and NO verifier-gated commit is produced.   <-- RED without the gate.
//   2. Candidate SELECTION of the same empty-capture verifier node also fails
//      closed (`candidate-selection-empty-capture`), keeping selection in sync.
//   3. The decision reads ONLY persisted node metadata, so the reloaded-from-disk
//      run reaches the SAME commit failure (replay-stable, no clock/ordering).
//   4. A worker result that normalizes TO real grounded evidence flows all the way
//      through the REAL pipeline to a verifier-gated commit with
//      rationale.evidenceCount > 0 — the gate blocks false-green, never real work.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const { createStateNode, appendRunNode, linkStateNodes } = require("../dist/state-node");
const { DEFAULT_PIPELINE_CONTRACT_ID } = require("../dist/pipeline-contract");
const { recordWorkerOutput, allocateWorkerScope, writeWorkerManifest } = require("../dist/worker-isolation");
const { registerCandidate, scoreCandidate, selectCandidate } = require("../dist/candidate-scoring");
const { commitState, CommitGateError } = require("../dist/commit");
const { listTrustAuditEvents } = require("../dist/trust-audit");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-no-false-green-"));

// A stable, on-disk grounded locator for the POSITIVE scenario.
const evidenceFile = path.join(tmp, "evidence.md");
fs.writeFileSync(evidenceFile, "# Evidence\nLine two backs the verdict.\n", "utf8");
const groundedLocator = `${evidenceFile}:2`;

function buildRun(runId, taskId) {
  const paths = createRunPaths(path.join(tmp, ".cw", "runs", runId));
  ensureRunDirs(paths);
  const taskPath = path.join(paths.tasksDir, "task.md");
  fs.writeFileSync(taskPath, "map the system\n", "utf8");
  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    cwd: tmp,
    workflow: { id: runId, title: "No False Green", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: {},
    loopStage: "interpret",
    phases: [{ id: "map", name: "Map", status: "pending", taskIds: [taskId] }],
    tasks: [
      {
        id: taskId,
        kind: "agent",
        phase: "Map",
        status: "pending",
        // OPTIONAL evidence (a non-verify/verdict id) is the dangerous case: the
        // grounding check does NOT fire, so only the empty-capture gate stops a
        // 0-real-evidence green commit.
        requiresEvidence: false,
        prompt: "Map the system.",
        taskPath,
        resultPath: "",
        loopStage: "interpret",
        stateNodeId: `${runId}:task:${taskId}`
      }
    ],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: [],
    candidates: [],
    candidateSelections: []
  };
  saveCheckpoint(run);
  return run;
}

// ---------------------------------------------------------------------------
// Scenario A — EMPTY CAPTURE must fail closed (the core no-false-green promise).
//
// We reconstruct the exact false-green state: an ACCEPTED empty-capture result
// node (carrying the captureWarning marker, as ingest sets it) feeding a
// VERIFIED verifier node whose only "evidence" is a non-grounded summary fallback.
// ---------------------------------------------------------------------------
{
  const runId = "no-false-green-empty";
  const taskId = "map:empty";
  const run = buildRun(runId, taskId);
  const task = run.tasks[0];

  // The accepted-but-empty result node — mirrors worker-isolation/lifecycle ingest:
  // no findings, no evidence, and the captureWarning marker in metadata.
  const resultNode = createStateNode({
    id: `${runId}:result:${taskId}`,
    kind: "result",
    status: "completed",
    loopStage: "observe",
    inputs: { taskId },
    outputs: { summary: "looks clean", findings: [], evidence: [] },
    artifacts: [{ id: "result", kind: "markdown", path: task.taskPath }],
    evidence: [],
    parents: [task.stateNodeId],
    contractId: DEFAULT_PIPELINE_CONTRACT_ID,
    metadata: { taskId, captureWarning: "no findings or evidence captured from result.md" }
  });
  appendRunNode(run, resultNode);
  task.resultNodeId = resultNode.id;
  task.status = "completed";

  // A VERIFIED verifier node fed by the empty result, carrying ONLY the summary
  // fallback (length 1, source "summary", NOT grounded) — the shape that slips
  // past the not-verified / length / grounding checks for an optional-evidence task.
  const verifierNode = createStateNode({
    id: `${runId}:verifier:${taskId}`,
    kind: "verifier",
    status: "verified",
    loopStage: "adjust",
    inputs: { inputNodeId: resultNode.id, stageId: "verify" },
    outputs: { accepted: true },
    evidence: [{ id: "result:summary", source: "summary", summary: "looks clean" }],
    parents: [resultNode.id],
    contractId: DEFAULT_PIPELINE_CONTRACT_ID,
    metadata: { taskId, pipelineStage: "verify" }
  });
  const [, linkedVerifier] = linkStateNodes(resultNode, verifierNode);
  appendRunNode(run, linkedVerifier);
  task.verifierNodeId = verifierNode.id;
  saveCheckpoint(run);

  // (1) The DIRECT verifier-gated commit (completeTask's `result:<taskId>` path)
  //     fails closed with the empty-capture code — NOT a silent clean commit.
  let commitError;
  try {
    commitState(run, `result:${taskId}`);
  } catch (err) {
    commitError = err;
  }
  assert.ok(commitError instanceof CommitGateError, "verifier-gated commit on empty capture is blocked");
  assert.equal(
    commitError.structured.code,
    "commit-rationale-empty-capture",
    "commit gate fails with the empty-capture code (RED without the gate)"
  );
  // VISIBLE state: a commit-gate-failed node + feedback, and NO clean commit landed.
  assert.ok(commitError.stateNodeId, "commit gate failure recorded a state node id");
  const failNode = run.nodes.find((n) => n.id === commitError.stateNodeId);
  assert.ok(failNode && /commit-gate-failed/.test(failNode.id), "commit-gate-failed state node persisted");
  assert.ok(commitError.feedbackId, "commit gate failure recorded visible feedback");
  assert.ok(
    !run.commits.some((c) => c.verifierGated),
    "no clean/green verifier-gated commit was produced from empty capture"
  );

  // (2) Candidate SELECTION of the same empty-capture verifier node fails closed too.
  const candidate = registerCandidate(run, {
    id: "cand-empty",
    workerId: "worker-empty",
    taskId,
    resultNodeId: resultNode.id,
    verifierNodeId: verifierNode.id
  });
  scoreCandidate(run, candidate.id, {
    criteria: { correctness: 5 },
    maxTotal: 5,
    evidence: [{ id: "score-ev", source: "operator-recorded", locator: groundedLocator, summary: groundedLocator }]
  });
  let selectionError;
  try {
    selectCandidate(run, candidate.id, { reason: "should be blocked" });
  } catch (err) {
    selectionError = err;
  }
  assert.ok(selectionError, "selection of an empty-capture candidate throws");
  assert.match(
    String(selectionError.message),
    /empty-capture|no real evidence/i,
    "selection error names the empty-capture cause (selection + commit in sync)"
  );

  // (3) Replay-stable: reload from disk and re-run the commit -> same failure.
  saveCheckpoint(run);
  const reloaded = loadRunFromCwd(runId, tmp);
  let replayError;
  try {
    commitState(reloaded, `result:${taskId}`);
  } catch (err) {
    replayError = err;
  }
  assert.ok(replayError instanceof CommitGateError, "reloaded run reaches the same commit failure");
  assert.equal(replayError.structured.code, "commit-rationale-empty-capture", "replay failure is the same cause");

  console.log("no-false-green: empty capture fails closed at commit + selection (visible, replay-stable) ok");
}

// ---------------------------------------------------------------------------
// Scenario B — REAL evidence still passes all the way to a committed state,
// driven through the REAL worker -> verify -> candidate -> commit pipeline.
// ---------------------------------------------------------------------------
{
  const runId = "no-false-green-real";
  const taskId = "map:real";
  const run = buildRun(runId, taskId);

  // A worker result that normalizes TO real grounded evidence (a path:line locator
  // in the canonical evidence array) — NOT an empty capture.
  const realResult = [
    "# Verdict",
    "",
    "Found a concrete issue, cited below.",
    "",
    "```cw:result",
    JSON.stringify({
      summary: "one real finding",
      findings: [{ id: "f1", classification: "real", severity: "P1", evidence: [groundedLocator] }],
      evidence: [groundedLocator]
    }),
    "```",
    ""
  ].join("\n");

  const scope = allocateWorkerScope(run, run.tasks[0], { workerId: "worker-real", persist: false });
  writeWorkerManifest(run, scope);
  fs.writeFileSync(scope.resultPath, realResult, "utf8");
  recordWorkerOutput(run, "worker-real", scope.resultPath, { persist: false });

  const task = run.tasks[0];
  assert.equal(task.status, "completed", "real-evidence worker output accepted");
  const resultNode = run.nodes.find((n) => n.id === task.resultNodeId);
  assert.equal(resultNode.metadata.captureWarning, undefined, "non-empty result carries NO capture warning");
  const verifierNode = run.nodes.find((n) => n.id === task.verifierNodeId);
  assert.equal(verifierNode.status, "verified", "real-evidence verify stage passes");
  assert.equal(
    listTrustAuditEvents(run).some((e) => e.kind === "worker.capture-warning"),
    false,
    "no capture warning audit event for a real-evidence result"
  );

  const candidate = registerCandidate(run, {
    id: "cand-real",
    workerId: "worker-real",
    taskId,
    resultNodeId: task.resultNodeId,
    verifierNodeId: task.verifierNodeId
  });
  scoreCandidate(run, candidate.id, {
    criteria: { correctness: 5 },
    maxTotal: 5,
    evidence: [{ id: "score-ev", source: "operator-recorded", locator: groundedLocator, summary: groundedLocator }]
  });

  const selection = selectCandidate(run, candidate.id, { reason: "real evidence passes" });
  assert.ok(selection.id, "selection of a real-evidence candidate succeeds");

  const commit = commitState(run, { reason: "no-false-green real evidence commit", selectionId: selection.id });
  assert.equal(commit.verifierGated, true, "real evidence produces a verifier-gated commit");
  assert.ok(commit.acceptanceRationale, "commit carries an acceptance rationale");
  assert.ok(commit.acceptanceRationale.evidenceCount > 0, "rationale evidenceCount > 0 for a real-evidence commit");

  console.log("no-false-green: real evidence passes selection + verifier-gated commit ok");
}

console.log("no-false-green-smoke: ok");
