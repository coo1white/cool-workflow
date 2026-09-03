#!/usr/bin/env node
"use strict";

// dead-export-removal-guard-smoke: the deep dogfood audit's dead-surface trace
// found 10 production exports defined but read by NO module (each verified at
// exactly its own definition, 0 external refs). They were removed. This guards
// re-growth: the dead exports must stay gone, and the LIVE exports beside them
// must stay present (so the removal was surgical, not a blanket cut).

const assert = require("node:assert/strict");

const cases = [
  { mod: "../dist/shell/term", dead: ["cwLabel", "formatDuration"], live: ["bold", "dim", "tryHint"] },
  {
    mod: "../dist/core/state/validation",
    dead: ["tryValidateWorkerScope", "tryValidateNodeSnapshot", "tryValidateNodeReplayRun", "tryValidateCandidateRecord"],
    // tryValidateCandidateScore is KEPT — it has real readers (evidence-reasoning.ts).
    live: ["validateWorkerScope", "validateNodeSnapshot", "tryValidateCandidateScore"]
  },
  {
    mod: "../dist/shell/execution-backend/registry",
    dead: ["backendSelectionFrom", "clearProbeCache", "listExecutionBackends"],
    // resolveBackendSelection is KEPT — used by dispatch.ts + worker-isolation.ts.
    live: ["resolveBackendSelection", "runBackend", "attestSandbox"]
  },
  // v2 relocations vs the old flat build: buildOperatorDigest was dead then
  // (0 external refs) but v2 keeps it exported and calls it from TWO modules
  // (shell/state-explosion-cli.ts + shell/multi-agent-operator-ux.ts), so it is
  // a LIVE cross-module export here. The old build's buildCompactGraph does not
  // live in report.ts in v2 at all — the compact-graph builder moved to
  // state-explosion/graph.ts as buildCompactGraphFromView — so this case checks
  // report.ts's real live pair instead.
  { mod: "../dist/core/state/state-explosion/report", dead: [], live: ["buildStateExplosionReport", "buildOperatorDigest"] },
  // Round 2 (found once PR 3/6/7 rewrote away the last outside mentions):
  // each of these 6 is called only inside its own file now.
  { mod: "../dist/core/multi-agent/runtime", dead: ["requireRunTask"], live: ["summarizeMultiAgent"] },
  { mod: "../dist/core/state/node-snapshot", dead: ["findRunNode"], live: ["snapshotNode"] },
  { mod: "../dist/shell/collaboration-io", dead: ["resolveReviewPolicy"], live: ["deriveReviewState"] },
  { mod: "../dist/shell/reclamation-io", dead: ["sha256OfFile"], live: ["planReclamation"] },
  { mod: "../dist/shell/sandbox-profile", dead: ["isBundledSandboxProfileId", "validateSandboxRead"], live: ["sandboxPolicyForWorker"] },
  { mod: "../dist/shell/workflow-app-loader", dead: ["listWorkflowAppRecords"], live: ["loadWorkflowApp"] }
];

for (const { mod, dead, live } of cases) {
  const m = require(mod);
  for (const name of dead) {
    assert.equal(m[name], undefined, `${mod}: dead export ${name} must stay removed`);
  }
  for (const name of live) {
    assert.equal(typeof m[name], "function", `${mod}: live export ${name} must remain`);
  }
}

process.stdout.write("dead-export-removal-guard-smoke: ok\n");
