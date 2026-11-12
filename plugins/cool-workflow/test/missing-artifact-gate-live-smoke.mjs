#!/usr/bin/env node
// missing-artifact-gate-live-smoke — the fail-closed "missing artifact" gate
// must actually FIRE in the live shell, not sit dead behind a `() => true`
// path check.
//
// The core gate takes a `pathExists` callback that defaults to
// `() => true` (no path is ever "missing") so a pure core/ module never
// touches the filesystem. Every real caller lives in shell/ and MUST pass
// `fs.existsSync`, or the fail-closed check is a no-op.
//
//   Finding #5 — the shell `runPipelineStage` wrapper passed the pipeline
//   through the core runner with NO pathExists, so the default contract's
//   `plan` stage (requiredArtifacts: ["state"], requireReadablePaths: true)
//   ADVANCED even when the input node's required "state" artifact path was
//   gone.
//
// The stage ADVANCES against the pre-fix build (that is the bug) and only
// refuses after fs.existsSync is wired in from the shell.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createRunPaths, ensureRunDirs } from "../dist/shell/run-store.js";
import { createStateNode } from "../dist/core/state/state-node.js";
// The SHELL-bound runPipelineStage (core runner + recordFeedback + the live
// path check). This is the impure seam every pipeline caller routes the gate
// through, so this is where fs.existsSync must be wired.
import { runPipelineStage } from "../dist/shell/error-feedback-io.js";
import { tmpDir } from "./helpers/workspace.mjs";

let SEQ = 0;
function freshRepo(tag) {
  return tmpDir(`cw-artifact-gate-${tag}-${SEQ++}-`);
}

// ---------------------------------------------------------------------------
// The shell pipeline gate refuses a stage whose input node is missing
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

partB_pipelineGateRefusesMissingArtifact();

process.stdout.write("missing-artifact-gate-live-smoke: ok\n");
