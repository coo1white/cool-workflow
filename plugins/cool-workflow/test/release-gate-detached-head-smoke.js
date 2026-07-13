#!/usr/bin/env node
"use strict";

// release-gate-detached-head-smoke — the branch-naming check [6/6] on a
// DETACHED HEAD.
//
// The bug: `git rev-parse --abbrev-ref HEAD` prints the literal string "HEAD"
// on a detached checkout. The version-branch regex (^feat/(batch-)?v?[0-9]+)
// can never match "HEAD", so the check is a silent no-op. That matters because
// the tag-push CI (release-gate.yml) ALWAYS checks out the tag, so HEAD is
// detached there — the one place this check is meant to be the backstop is the
// one place it never fired.
//
// The fix resolves the real ref name(s) on a detached HEAD — the CI source
// branch (GITHUB_HEAD_REF / GITHUB_REF_NAME) plus every local/remote branch
// whose tip contains this commit — and judges each. Each case here FAILS
// against the unfixed script and PASSES after the fix:
//  - Case A: detached with a `feat/v999` branch pointing at HEAD -> must REJECT
//    (unfixed: BRANCH="HEAD", regex misses, gate PASSES).
//  - Case B: detached with only a non-version branch -> a valid release still
//    PASSES (guards against an over-eager reject).
//  - Case C: detached with GITHUB_HEAD_REF=feat/v123 -> must REJECT via the CI
//    source-branch signal.
// Portable: node + git only, isolated tmpdir.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const GATE = path.resolve(__dirname, "..", "scripts", "release-gate.js");
assert.ok(fs.existsSync(GATE), "release-gate.js must exist");

let caseId = 0;
function freshRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-gate-dh-${caseId++}-`));
  git(dir, ["init", "-q", "-b", "work"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "tag.gpgsign", "false"]);
  const pkgDir = path.join(dir, "plugins", "cool-workflow");
  fs.mkdirSync(pkgDir, { recursive: true });
  write(dir, "plugins/cool-workflow/package.json", JSON.stringify({
    name: "fixture", version: "0.0.0", scripts: { build: "true", test: "true", "test:gate": "true" }
  }));
  return dir;
}
function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function commitAll(dir, msg) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", msg]);
}
function runGate(dir, extraEnv) {
  // Blank out any GITHUB_* the harness itself may carry (this suite can run
  // inside GitHub Actions), so each case controls the CI signal on its own.
  const env = { ...process.env, GITHUB_HEAD_REF: "", GITHUB_REF_NAME: "", ...extraEnv };
  const r = spawnSync(process.execPath, [GATE], { cwd: dir, encoding: "utf8", env });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// A valid release body: a non-types src change, a test change, and >=4 cycles.
// With this seeded, the ONLY gate that can still reject is the branch-naming
// check — so each assertion isolates that check.
function seedReleaseWork(dir) {
  write(dir, "plugins/cool-workflow/src/feature.ts", "export const x = 1;\n");
  write(dir, "plugins/cool-workflow/test/feature-smoke.js", "// asserts feature\n");
  write(dir, "ITERATION_LOG.md",
    "| cycle | goal |\n| 1 | a |\n| 2 | b |\n| 3 | c |\n| 4 | d |\n");
}

// ---- Case A: detached HEAD, a feat/v999 branch points at it -> REJECT -------
// The tag-push CI shape: HEAD is detached. A version-number branch contains the
// commit and must still be caught. Unfixed, BRANCH resolves to the literal
// "HEAD", the regex misses, and this whole valid-looking release PASSES.
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  seedReleaseWork(dir);
  commitAll(dir, "real work");
  git(dir, ["branch", "feat/v999"]);   // version-number branch at HEAD
  git(dir, ["checkout", "-q", "--detach", "HEAD"]); // detach (CI tag-checkout shape)
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD",
    "fixture check: HEAD must really be detached");
  const r = runGate(dir);
  assert.equal(r.code, 1,
    `detached HEAD with a feat/v999 branch must be REJECTED, not a silent pass:\n${r.out}`);
  assert.match(r.out, /version-number-driven/,
    "should name the branch-naming failure and the offending branch");
  assert.match(r.out, /feat\/v999/, "should name the offending branch itself");
}

// ---- Case B: detached HEAD, only a non-version branch -> still PASS ---------
// The fix must not over-reject: a valid release on a detached HEAD whose only
// containing branch is well named still passes.
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  seedReleaseWork(dir);
  commitAll(dir, "real work");
  git(dir, ["checkout", "-q", "--detach", "HEAD"]); // detached, only "work" contains it
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD",
    "fixture check: HEAD must really be detached");
  const r = runGate(dir);
  assert.equal(r.code, 0,
    `detached HEAD with only a well-named branch must still PASS:\n${r.out}`);
}

// ---- Case C: detached HEAD, CI source branch is version-number -> REJECT ----
// A PR/push CI run exposes the source branch in GITHUB_HEAD_REF even though the
// checkout is detached. A version-number source branch must be caught there.
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  seedReleaseWork(dir);
  commitAll(dir, "real work");
  git(dir, ["checkout", "-q", "--detach", "HEAD"]);
  const r = runGate(dir, { GITHUB_HEAD_REF: "feat/v123" });
  assert.equal(r.code, 1,
    `detached HEAD with GITHUB_HEAD_REF=feat/v123 must be REJECTED:\n${r.out}`);
  assert.match(r.out, /version-number-driven/, "should name the branch-naming failure");
  assert.match(r.out, /feat\/v123/, "should name the offending CI source branch");
}

process.stdout.write("release-gate-detached-head-smoke: ok\n");
