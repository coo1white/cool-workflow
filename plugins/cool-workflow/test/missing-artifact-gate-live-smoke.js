#!/usr/bin/env node
// missing-artifact-gate-live-smoke — the fail-closed "missing artifact" gate
// must actually FIRE in the live shell, not sit dead behind a `() => true`
// path check.
//
// Two findings, one root cause: the core gate + the reclamation dangling-
// artifact proof BOTH take a `pathExists` callback that defaults to
// `() => true` (no path is ever "missing") so a pure core/ module never
// touches the filesystem. Every real caller lives in shell/ and MUST pass
// `fs.existsSync`, or the fail-closed check is a no-op.
//
//   Finding #6 — shell/reclamation-io.ts prepareFree() proved a re-pointed
//   node "stays valid" with `loadNodeSnapshot(run, fresh)` and NO pathExists,
//   so a re-pointed node that keeps a DANGLING artifact (a path that is not
//   on disk) slipped through and the scratch bytes were freed anyway.
//
//   Finding #5 — the shell `runPipelineStage` wrapper passed the pipeline
//   through the core runner with NO pathExists, so the default contract's
//   `plan` stage (requiredArtifacts: ["state"], requireReadablePaths: true)
//   ADVANCED even when the input node's required "state" artifact path was
//   gone.
//
// Both parts ADVANCE/succeed against the pre-fix build (that is the bug) and
// only refuse after fs.existsSync is wired in from the shell.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/shell/run-store");
const { createStateNode } = require("../dist/core/state/state-node");
const { prepareFree, ReclamationError } = require("../dist/shell/reclamation-io");
// The SHELL-bound runPipelineStage (core runner + recordFeedback + the live
// path check). This is the impure seam every pipeline caller routes the gate
// through, so this is where fs.existsSync must be wired.
const { runPipelineStage } = require("../dist/shell/error-feedback-io");

let SEQ = 0;
function freshRepo(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cw-artifact-gate-${tag}-${SEQ++}-`));
}

// ---------------------------------------------------------------------------
// Part A — reclamation prepareFree() catches a re-pointed DANGLING artifact
// (finding #6). Before the fix the dangling-artifact proof is dead: it must
// throw "repoint-incomplete" once fs.existsSync is wired.
// ---------------------------------------------------------------------------
function partA_reclamationDanglingArtifactProof() {
  const repo = freshRepo("recl");
  const runId = "recl-dangling";
  const paths = createRunPaths(path.join(repo, ".cw", "runs", runId));
  ensureRunDirs(paths);
  const runDir = paths.runDir;

  // A real scratch dir the tombstone will free.
  const scratchRel = path.join("workers", "w1");
  const scratchDir = path.join(runDir, scratchRel);
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.writeFileSync(path.join(scratchDir, "scratch-log.md"), "scratch\n".repeat(20), "utf8");

  // The RETAINED result the scratch artifact is re-pointed onto. It MUST exist
  // on disk or repointResultNodeArtifacts refuses to move the reference.
  const resultsDir = path.join(runDir, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const retainedResult = path.join(resultsDir, "map.md");
  fs.writeFileSync(retainedResult, "# result\nok\n", "utf8");

  // A DANGLING artifact path: not under scratch, not a commit snapshot, and
  // NOT on disk. The scratch-reference proof cannot see it — ONLY the
  // loadNodeSnapshot freshness proof (the one missing its pathExists) can.
  const danglingPath = path.join(runDir, "gone", "missing.json");

  const resultNode = createStateNode({
    id: `${runId}:result:t1`,
    kind: "result",
    status: "completed",
    loopStage: "adjust",
    artifacts: [
      { id: "scratch-log", kind: "markdown", path: path.join(scratchDir, "scratch-log.md") },
      { id: "result", kind: "markdown", path: retainedResult },
      { id: "dangling", kind: "json", path: danglingPath },
    ],
    evidence: [{ id: "e1", source: "summary", summary: "ok" }],
  });

  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: repo,
    workflow: { id: "gate-smoke", title: "Gate Smoke", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 }, app: { id: "gate-smoke", version: "0.0.0" } },
    inputs: {},
    loopStage: "adjust",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [resultNode],
    contracts: [],
    feedback: [],
    workers: [],
  };
  saveCheckpoint(run);

  const tombstone = { freed: [{ kind: "scratch", path: scratchRel }] };

  let threw = null;
  try {
    prepareFree(run, tombstone);
  } catch (error) {
    threw = error;
  }

  assert.ok(
    threw,
    "prepareFree MUST fail closed when a re-pointed node keeps a dangling artifact (finding #6: the loadNodeSnapshot proof was dead)"
  );
  assert.ok(threw instanceof ReclamationError, `expected a ReclamationError, got ${threw && threw.name}: ${threw && threw.message}`);
  assert.equal(threw.code, "repoint-incomplete", `expected code repoint-incomplete, got ${threw && threw.code}`);
  assert.match(threw.message, /dangling|absent/i, `unexpected reason: ${threw && threw.message}`);

  // The re-point still happened — the scratch artifact was moved onto the
  // retained result BEFORE the proof caught the unrelated dangling one.
  const moved = run.nodes[0].artifacts.find((a) => a.id === "scratch-log");
  assert.equal(moved.path, retainedResult, "the scratch artifact was still re-pointed onto the retained result");
}

// ---------------------------------------------------------------------------
// Part B — the shell pipeline gate refuses a stage whose input node is missing
// a REQUIRED artifact on disk (finding #5). The default contract's plan stage
// requires "state" and requireReadablePaths is true.
// ---------------------------------------------------------------------------
function partB_pipelineGateRefusesMissingArtifact() {
  const repo = freshRepo("plan");
  const runId = "gate-plan";
  const paths = createRunPaths(path.join(repo, ".cw", "runs", runId));
  ensureRunDirs(paths);

  // The input node's REQUIRED "state" artifact points at a path that is not on
  // disk. The pre-fix gate (pathExists = () => true) treats it as present and
  // ADVANCES; the fixed gate (fs.existsSync) refuses.
  const missingState = path.join(paths.runDir, "state-that-is-not-there.json");
  assert.ok(!fs.existsSync(missingState), "precondition: the required state artifact path is absent");

  const inputNode = createStateNode({
    id: `${runId}:input`,
    kind: "input",
    status: "completed",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: missingState }],
  });

  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: repo,
    workflow: { id: "gate-smoke", title: "Gate Smoke", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 }, app: { id: "gate-smoke", version: "0.0.0" } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [inputNode],
    contracts: [],
    feedback: [],
    workers: [],
  };

  const result = runPipelineStage(
    run,
    "plan",
    `${runId}:input`,
    { outputNodeId: `${runId}:task:t1`, outputStatus: "pending", loopStage: "interpret" },
    { persist: false }
  );

  assert.equal(
    result.status,
    "failed",
    "the plan stage MUST refuse when the input's required 'state' artifact path is missing (finding #5: the gate had no live pathExists)"
  );
  assert.equal(result.error && result.error.code, "missing-artifact-path", `expected missing-artifact-path, got ${result.error && result.error.code}`);

  // A run whose required "state" artifact IS on disk still advances — the live
  // gate must not refuse a legitimate run.
  const okRepo = freshRepo("plan-ok");
  const okPaths = createRunPaths(path.join(okRepo, ".cw", "runs", "gate-plan-ok"));
  ensureRunDirs(okPaths);
  fs.writeFileSync(okPaths.state, "{}\n", "utf8");
  const okInput = createStateNode({
    id: "gate-plan-ok:input",
    kind: "input",
    status: "completed",
    loopStage: "interpret",
    artifacts: [{ id: "state", kind: "json", path: okPaths.state }],
  });
  const okRun = { ...run, id: "gate-plan-ok", paths: okPaths, nodes: [okInput], feedback: [], contracts: [] };
  const okResult = runPipelineStage(
    okRun,
    "plan",
    "gate-plan-ok:input",
    { outputNodeId: "gate-plan-ok:task:t1", outputStatus: "pending", loopStage: "interpret" },
    { persist: false }
  );
  assert.equal(okResult.status, "advanced", "a run whose required 'state' artifact exists on disk still advances (no false refusal)");
}

partA_reclamationDanglingArtifactProof();
partB_pipelineGateRefusesMissingArtifact();

process.stdout.write("missing-artifact-gate-live-smoke: ok\n");
