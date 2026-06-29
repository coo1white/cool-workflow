#!/usr/bin/env node
"use strict";

// release-pipeline-hygiene-smoke.js — static guards over the RELEASE PIPELINE's
// own code, so the three classes of bug that hit the v0.1.96 release can never
// silently come back. These paths (CI workflows + the cut's git side-effects)
// only run at release time, so a normal-cycle smoke is the only place they get
// exercised before they ship.
//
// Guards:
//   1. release-flow.js cut() must NOT `git add -A` (an untracked stray — e.g. the
//      reviewer transcript with the operator's home path — must never ride into the
//      immutable tag commit). It must stage tracked changes with `git add -u`.
//   2. npm-publish.yml must check out BEFORE any `run:` step (a pre-checkout run
//      under the job's working-directory cannot start bash) and must NOT derive the
//      release tag from `workflow_run.head_branch` (that is the triggering branch,
//      not the tag).
//   3. No workflow-level `concurrency:` group may reference `matrix.*` (out of scope
//      at workflow level → every run fails fast with a workflow-file error).
//
// Portable: node + fs only, no YAML dependency (the suite is zero-dep).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pluginRoot = path.resolve(__dirname, "..");
const wfDir = path.join(repoRoot, ".github", "workflows");
let checks = 0;

// ---- Guard 1: cut() staging --------------------------------------------------
{
  const src = fs.readFileSync(path.join(pluginRoot, "scripts", "release-flow.js"), "utf8");
  assert.ok(
    !/git\(\s*\[\s*"add"\s*,\s*"-A"\s*\]/.test(src),
    "release-flow.js cut() must not `git add -A` — stage tracked changes with `git add -u` plus the explicit verdict path so no untracked stray rides into the tag"
  );
  assert.ok(
    /git\(\s*\[\s*"add"\s*,\s*"-u"\s*\]/.test(src),
    "release-flow.js cut() must stage tracked modifications with `git add -u`"
  );
  // The single intended new file (the verdict) is added explicitly.
  assert.ok(
    /git\(\s*\[\s*"add"\s*,\s*"--"\s*,\s*path\.relative\(repoRoot,\s*resultPath\)\s*\]/.test(src),
    "release-flow.js cut() must explicitly add the verdict file (the only new path it may commit)"
  );
  // The atomic push protects against a half-pushed main (commit lands, tag does not).
  assert.ok(
    /push"\s*,\s*"--atomic"/.test(src),
    "release-flow.js cut() must push HEAD and the tag atomically (`git push --atomic`)"
  );
  checks += 4;
}

// ---- Guard 2: npm-publish.yml ordering + tag derivation ----------------------
{
  const p = path.join(wfDir, "npm-publish.yml");
  const lines = fs.readFileSync(p, "utf8").split(/\n/);
  const idxSteps = lines.findIndex((l) => /^\s*steps:\s*$/.test(l));
  assert.ok(idxSteps >= 0, "npm-publish.yml must have a steps: block");
  const after = lines.slice(idxSteps + 1);
  const idxCheckout = after.findIndex((l) => /uses:\s*actions\/checkout/.test(l));
  const idxRun = after.findIndex((l) => /^\s+run:/.test(l));
  assert.ok(idxCheckout >= 0, "npm-publish.yml must check out the repo");
  assert.ok(
    idxRun === -1 || idxCheckout < idxRun,
    "npm-publish.yml must run actions/checkout BEFORE any run: step — a pre-checkout run under the job working-directory cannot start bash"
  );
  const src = lines.join("\n");
  assert.ok(
    !/workflow_run\.head_branch/.test(src),
    "npm-publish.yml must not derive the release tag from workflow_run.head_branch (it is the triggering branch, not the tag); resolve it from head_sha"
  );
  checks += 3;
}

// ---- Guard 3: no workflow-level concurrency references matrix.* ----------------
{
  const files = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0, "expected workflow files under .github/workflows");
  for (const f of files) {
    const lines = fs.readFileSync(path.join(wfDir, f), "utf8").split(/\n/);
    // A workflow-level key sits at column 0. Read the `concurrency:` block (if any)
    // until the next column-0 key, and assert it does not reference matrix.*.
    const start = lines.findIndex((l) => /^concurrency:/.test(l));
    if (start === -1) continue;
    let block = lines[start];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break; // next column-0 key ends the block
      block += "\n" + lines[i];
    }
    assert.ok(
      !/matrix\./.test(block),
      `${f}: workflow-level concurrency: must not reference matrix.* (out of scope → every run fails fast)`
    );
    checks += 1;
  }
}

process.stdout.write(`release-pipeline-hygiene-smoke: ok (${checks} static guards)\n`);
