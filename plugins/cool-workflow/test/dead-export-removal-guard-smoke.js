#!/usr/bin/env node
"use strict";

// dead-export-removal-guard-smoke: the deep dogfood audit's dead-surface trace
// found 10 production exports defined but read by NO module (each verified at
// exactly its own definition, 0 external refs). They were removed. This guards
// re-growth: the dead exports must stay gone, and the LIVE exports beside them
// must stay present (so the removal was surgical, not a blanket cut).

const assert = require("node:assert/strict");

const cases = [
  { mod: "../dist/term", dead: ["cwLabel", "formatDuration"], live: ["bold", "dim", "tryHint"] },
  {
    mod: "../dist/validation",
    dead: ["tryValidateWorkerScope", "tryValidateNodeSnapshot", "tryValidateNodeReplayRun", "tryValidateCandidateRecord"],
    // tryValidateCandidateScore is KEPT — it has real readers (evidence-reasoning.ts).
    live: ["validateWorkerScope", "validateNodeSnapshot", "tryValidateCandidateScore"]
  },
  {
    mod: "../dist/execution-backend",
    dead: ["backendSelectionFrom", "clearProbeCache", "listExecutionBackends"],
    // resolveBackendSelection is KEPT — used by dispatch.ts + worker-isolation.ts.
    live: ["resolveBackendSelection", "runBackend", "attestSandbox"]
  },
  { mod: "../dist/state-explosion", dead: ["buildOperatorDigest"], live: ["buildStateExplosionReport", "buildCompactGraph"] }
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
