#!/usr/bin/env node
// dead-export-removal-guard-smoke: the deep dogfood audit's dead-surface trace
// found 10 production exports defined but read by NO module (each verified at
// exactly its own definition, 0 external refs). They were removed. This guards
// re-growth: the dead exports must stay gone, and the LIVE exports beside them
// must stay present (so the removal was surgical, not a blanket cut).

import assert from "node:assert/strict";

const cases = [
  { mod: "../dist/shell/term", dead: ["cwLabel", "formatDuration"], live: ["bold", "dim", "tryHint"] },
  {
    mod: "../dist/core/state/validation",
    // tryValidateCandidateScore went with its one reader (evidence-reasoning.ts)
    // and the rest of the multi-agent family (slim-and-esm step 2).
    dead: ["tryValidateWorkerScope", "tryValidateNodeSnapshot", "tryValidateNodeReplayRun", "tryValidateCandidateRecord", "tryValidateCandidateScore"],
    live: ["validateWorkerScope", "validateNodeSnapshot"]
  },
  {
    mod: "../dist/shell/execution-backend/registry",
    dead: ["backendSelectionFrom", "clearProbeCache", "listExecutionBackends"],
    // resolveBackendSelection is KEPT — used by dispatch.ts + worker-isolation.ts.
    live: ["resolveBackendSelection", "runBackend", "attestSandbox"]
  },
  // Round 2 (found once PR 3/6/7 rewrote away the last outside mentions):
  // each of these is called only inside its own file now. (The
  // state-explosion report, multi-agent runtime and collaboration cases went
  // with those modules, slim-and-esm step 2.)
  { mod: "../dist/core/state/node-snapshot", dead: ["findRunNode"], live: ["snapshotNode"] },
  { mod: "../dist/shell/reclamation-io", dead: ["sha256OfFile"], live: ["planReclamation"] },
  { mod: "../dist/shell/sandbox-profile", dead: ["isBundledSandboxProfileId", "validateSandboxRead"], live: ["sandboxPolicyForWorker"] },
  { mod: "../dist/shell/workflow-app-loader", dead: ["listWorkflowAppRecords"], live: ["loadWorkflowApp"] }
];

for (const { mod, dead, live } of cases) {
  const m = await import(`${mod}.js`);
  for (const name of dead) {
    assert.equal(m[name], undefined, `${mod}: dead export ${name} must stay removed`);
  }
  for (const name of live) {
    assert.equal(typeof m[name], "function", `${mod}: live export ${name} must remain`);
  }
}

process.stdout.write("dead-export-removal-guard-smoke: ok\n");
