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
  // The .sig sidecar (verdict signing, opt-in) must ride in the SAME commit as
  // the verdict when present — every --cut test case is --dry-run (it would
  // corrupt this real working tree otherwise, see release-flow-smoke.js's
  // header), so this static guard is the ONLY thing that would catch a future
  // edit silently dropping or breaking this line.
  assert.ok(
    /git\(\s*\[\s*"add"\s*,\s*"--"\s*,\s*path\.relative\(repoRoot,\s*sigPath\)\s*\]/.test(src),
    "release-flow.js cut() must explicitly add the verdict's .sig sidecar when it exists"
  );
  // The push must be TAG-ONLY (refs/tags/v<version>). The old shape —
  // `git push --atomic origin HEAD v<x>` — either hit main's branch
  // protection (enforce_admins blocks even the owner) or minted a stray
  // remote branch named after whatever branch the cut ran from, and its
  // "half-pushed main" hazard does not exist when no branch ref is pushed
  // at all (a single-ref push is atomic by itself). The verdict commit is
  // a one-hop leaf on the reviewed commit, carried by the tag alone.
  assert.ok(
    /push"\s*,\s*"origin"\s*,\s*`refs\/tags\/v\$\{cutVersion\}`/.test(src),
    "release-flow.js cut() must push ONLY the tag ref (refs/tags/v<version>)"
  );
  assert.ok(
    !/push"\s*,\s*"--atomic"\s*,\s*"origin"\s*,\s*"HEAD"/.test(src),
    "release-flow.js cut() must NOT push HEAD/a branch (branch protection + stray-branch hazard)"
  );
  checks += 6;
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

// ---- Guard 4: steering-config-gate job (ci.yml) --------------------------------
{
  const p = path.join(wfDir, "ci.yml");
  const raw = fs.readFileSync(p, "utf8");
  const lines = raw.split(/\n/);

  // The workflow-level on: block must not gain a paths: key — that would
  // gate every job in the file, not just this new one.
  const onStart = lines.findIndex((l) => /^on:/.test(l));
  assert.ok(onStart >= 0, "ci.yml must have an on: block");
  let onBlock = lines[onStart];
  for (let i = onStart + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    onBlock += "\n" + lines[i];
  }
  assert.ok(
    !/^\s*paths:/m.test(onBlock),
    "ci.yml workflow-level on: must not gain a paths: filter (would also gate the three test legs)"
  );

  // The gate job must exist, and stay a single 2-space job key so it does
  // not fold into a neighbour job's step list.
  const jobStart = lines.findIndex((l) => /^ {2}steering-config-gate:/.test(l));
  assert.ok(jobStart >= 0, "ci.yml must define a steering-config-gate job");
  let jobEnd = lines.length;
  for (let i = jobStart + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) {
      jobEnd = i;
      break;
    }
  }
  const job = lines.slice(jobStart, jobEnd).join("\n");

  assert.match(
    job,
    /^\s+- run: node test\/run-all\.js --filter 'release-flow'$/m,
    "steering-config-gate must run the release-reviewer smokes via test/run-all.js --filter"
  );
  assert.match(
    job,
    /^\s+- run: npm run eval:replay$/m,
    "steering-config-gate must run the eval-replay harness smoke (npm run eval:replay)"
  );
  assert.match(
    job,
    /^\s+if: steps\.\w+\.outputs\.\w+ == 'true'$/m,
    "steering-config-gate must gate its real steps on a step-output check, scoped to this job alone"
  );
  assert.match(job, /AGENTS\\?\.md/, "steering-config-gate's path check must name AGENTS.md");
  assert.match(
    job,
    /plugins\/cool-workflow\/agents\//,
    "steering-config-gate's path check must name plugins/cool-workflow/agents/"
  );
  checks += 5;

  // The three matrix legs and the macOS leg must stay untouched.
  assert.match(raw, /node-version: \["18", "22", "24"\]/, "the three cool-workflow matrix legs must be unchanged");
  assert.match(raw, /^ {2}cool-workflow-macos:$/m, "the macOS leg must still be defined");
  checks += 2;
}

process.stdout.write(`release-pipeline-hygiene-smoke: ok (${checks} static guards)\n`);
