#!/usr/bin/env node
"use strict";

// release-oneclick-smoke — exercises scripts/release-oneclick.js, the
// operator's one-command release orchestrator (npm run release -- X.Y.Z).
//
// Scope: the FAIL-FAST layer and the red lines. The orchestrator's stages 1-3
// are thin sequencing over gh/git/release-flow.js that only a real release
// exercises end to end (the same reason every release-flow --cut smoke case
// is --dry-run: a non-dry-run run would mutate the real checkout). What this
// smoke pins:
//   - no version arg -> usage error, exit 1, nothing touched
//   - a version whose preflight must fail (no signed verdict key set)
//     dies in stage 0, BEFORE any branch/commit/PR side effect
//   - red lines: shell:false spawns only, no model SDK, no API key handling
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const ONECLICK = path.join(pluginRoot, "scripts", "release-oneclick.js");
assert.ok(fs.existsSync(ONECLICK), "release-oneclick.js must exist");

// ---- red lines (static) -----------------------------------------------------
{
  const src = fs.readFileSync(ONECLICK, "utf8");
  assert.match(src, /shell:\s*false/, "oneclick must spawn shell:false");
  for (const sdk of ["@anthropic-ai", "openai", "@google/generative-ai", "ollama", "cohere", "mistralai"]) {
    assert.ok(!new RegExp(`require\\(["'][^"']*${sdk}`).test(src), `oneclick must not import a model SDK: ${sdk}`);
  }
  assert.ok(!/api[._-]?key/i.test(src), "oneclick must not handle an API key");
  // The operator boundary: the signing key env var is never read here — it is
  // forwarded implicitly to release-flow.js's own signVerdictIfConfigured().
  assert.ok(
    !/CW_RELEASE_VERDICT_PRIVKEY/.test(src.replace(/\/\/[^\n]*/g, "")),
    "oneclick code must never read CW_RELEASE_VERDICT_PRIVKEY (comments may mention it)"
  );
}

function run(args, env = {}) {
  const childEnv = { ...process.env };
  // An operator's own shell must never leak a real signing key into this
  // test — every case gets this unset unless it opts in via env above.
  delete childEnv.CW_RELEASE_VERDICT_PRIVKEY;
  Object.assign(childEnv, env);
  const r = spawnSync(process.execPath, [ONECLICK, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: childEnv
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function treeState() {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  return (r.stdout || "").trim();
}

// ---- Case: no version arg -> usage, exit 1 ----------------------------------
{
  const before = treeState();
  const r = run([]);
  assert.notEqual(r.code, 0, "missing version must fail");
  assert.match(r.err, /usage: node scripts\/release-oneclick\.js X\.Y\.Z/, "should print usage");
  assert.equal(treeState(), before, "a usage error must not touch the tree");
}

// ---- Case: preflight failure stops stage 0 with NO side effects -------------
// With the signing key scrubbed by run(), release-flow's cut preflight must
// reject 99.99.99 on every machine: .cw-release/verdict-signing.pub is
// committed and no key is set, so check (b) rejects, deterministically;
// oneclick must stop right there — no branch, no commit, no PR attempt (the
// gh stub would loudly fail if reached).
{
  const before = treeState();
  const branchBefore = spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  const r = run(["99.99.99", "--dry-run"], { CW_ONECLICK_GH_CMD: "false" });
  assert.notEqual(r.code, 0, "a failing preflight must fail the whole run");
  assert.match(r.out + r.err, /\[0\/4\] preflight/, "stage 0 must have started");
  assert.match(r.out + r.err, /verdict-signing\.pub is committed|preflight failed/, "the preflight reason must surface");
  assert.doesNotMatch(r.out, /\[1\/4\]|\[2\/4\]|\[3\/4\]/, "no later stage may start after a failed preflight");
  assert.equal(treeState(), before, "a failed preflight must leave the tree untouched");
  const branchAfter = spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  assert.equal(branchAfter, branchBefore, "a failed preflight must not switch branches");
}

// ---- Case: an already-cut version resumes at stage 3 (dry-run, offline) -----
// After a successful cut the vX.Y.Z tag exists, and release-flow's preflight
// would refuse a fresh cut of it ("already exists"). A re-run of oneclick for
// that version must NOT be refused — it must skip stages 0-2 and go straight
// to the stage-3 wait/record work (that is what makes a re-run after a
// stage-3 death a resume). In --dry-run the decision uses the LOCAL tag only,
// so this case is fully offline. Uses whatever release tag this checkout has;
// skipped (loudly) when none is visible (e.g. a shallow CI clone).
{
  const tags = spawnSync("git", ["tag", "-l", "v[0-9]*"], { cwd: repoRoot, encoding: "utf8" })
    .stdout.trim().split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  if (tags.length === 0) {
    process.stdout.write("release-oneclick-smoke: NOTE no local release tag visible — resume case skipped\n");
  } else {
    const cutVersion = tags[tags.length - 1].slice(1);
    const before = treeState();
    const r = run([cutVersion, "--dry-run"], { CW_ONECLICK_GH_CMD: "false" });
    assert.equal(r.code, 0, `an already-cut version must resume, not be refused:\n${r.err}\n${r.out}`);
    assert.match(r.out, /already exists — the cut already happened; resuming at stage 3/, "must announce the resume");
    assert.match(r.out, /would resume at stage 3/, "dry-run must stop at the resume plan");
    assert.doesNotMatch(r.out, /\[0\/4\] preflight/, "resume must not run the fresh-cut preflight (it would refuse the existing tag)");
    assert.equal(treeState(), before, "a dry-run resume must leave the tree untouched");
  }
}

process.stdout.write("release-oneclick-smoke: ok (usage + stage-0 fail-fast leave the tree untouched; resume path; red lines hold)\n");
