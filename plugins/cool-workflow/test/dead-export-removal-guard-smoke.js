#!/usr/bin/env node
"use strict";

// dead-export-removal-guard-smoke: the deep dogfood audit's dead-surface trace
// found 10 production exports defined but read by NO module (each verified at
// exactly its own definition, 0 external refs). They were removed. This guards
// re-growth: the dead exports must stay gone, and the LIVE exports beside them
// must stay present (so the removal was surgical, not a blanket cut).

const assert = require("node:assert/strict");

// NO-EQUIVALENT (v2 cutover): this guard is a snapshot of the OLD flat build's
// dead-surface audit — an exact "these exports were surgically removed, these
// siblings stay" partition on src/{term,validation,execution-backend,
// state-explosion}.ts. v2 is a clean rebuild with a different core/ + shell/
// layout, so it never went through that removal and the partition no longer
// holds. Imports are repointed to v2 dist for the record, but the assertions
// cannot be met and must NOT be flipped (that would change what this verifies):
//   - dist/core/state/validation: validateWorkerScope + tryValidateCandidateScore
//     are asserted LIVE, but do not exist anywhere in v2 dist (grep -rl finds 0).
//   - dist/core/state/state-explosion/report: buildOperatorDigest is asserted
//     DEAD/removed, but is a LIVE export in v2 (report.js:2).
// There is no v2 equivalent guard; left failing on purpose. Phase B decides
// whether v2 needs its own dead-export audit.
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
  { mod: "../dist/core/state/state-explosion/report", dead: ["buildOperatorDigest"], live: ["buildStateExplosionReport", "buildCompactGraph"] }
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
