#!/usr/bin/env node
"use strict";

// release-gate-smoke — exercises scripts/release-gate.sh against throwaway git
// fixtures. The gate's heavy steps (build, test) are satisfied by a fixture
// package.json whose build/test scripts are `true`, so the real script runs
// unmodified with NO recursion back into this suite. We assert the diff-driven
// gates (substance, test-evidence, cadence, branch naming) AND the previous-tag
// resolution that the tag-push CI depends on.
//
// Each assertion would FAIL if the corresponding gate logic were reverted:
//  - drop the substance fix  -> the "tooling-only diff passes" case goes red
//  - drop the PREV_TAG fix    -> the "HEAD already tagged" case false-fails
// Portable: node + git only, isolated tmpdir.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const GATE = path.resolve(__dirname, "..", "scripts", "release-gate.sh");
assert.ok(fs.existsSync(GATE), "release-gate.sh must exist");

let caseId = 0;
function freshRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-gate-${caseId++}-`));
  git(dir, ["init", "-q", "-b", "work"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "tag.gpgsign", "false"]);
  // Minimal plugin package so `npm run build` / `npm test` resolve to no-ops.
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
  const r = spawnSync("bash", [GATE], {
    cwd: dir,
    encoding: "utf8",
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// A "good" release: a non-types src change, a test change, and >=4 logged cycles.
function seedReleaseWork(dir) {
  write(dir, "plugins/cool-workflow/src/feature.ts", "export const x = 1;\n");
  write(dir, "plugins/cool-workflow/test/feature-smoke.js", "// asserts feature\n");
  write(dir, "ITERATION_LOG.md",
    "| cycle | goal |\n| 1 | a |\n| 2 | b |\n| 3 | c |\n| 4 | d |\n");
}

// ---- Case 1: no previous tag -> substance/evidence/cadence skipped, PASS ----
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  // A genuine first release now needs an EXPLICIT declaration to skip the
  // prior-release checks — an empty PREV_TAG on its own is ambiguous (it also
  // fits a --no-tags/shallow clone of a tagged repo, see Case 7b/7c).
  const r = runGate(dir, { CW_FIRST_RELEASE: "1" });
  assert.equal(r.code, 0, `declared first release should PASS:\n${r.out}`);
  const sha = git(dir, ["rev-parse", "HEAD"]);
  assert.ok(fs.existsSync(path.join(dir, ".cw-release", `gate-${sha}.ok`)),
    "PASS must write the gate-<sha>.ok marker");

  // ...and WITHOUT the declaration, the same repo must fail closed rather than
  // silently skip the checks (the fail-closed half of the 2026-07-12 fix).
  const r2 = runGate(dir);
  assert.equal(r2.code, 1, `undeclared empty-PREV_TAG must be REJECTED, not skipped:\n${r2.out}`);
  assert.match(r2.out, /CW_FIRST_RELEASE|not fetched|previous release tag/i,
    "should name the ambiguity + the explicit-declaration escape hatch");
}

// ---- Case 2: full valid release since a previous tag -> PASS ----
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  seedReleaseWork(dir);
  commitAll(dir, "real work");
  const r = runGate(dir);
  assert.equal(r.code, 0, `valid release should PASS:\n${r.out}`);
}

// ---- Case 2c: PREV_TAG resolved by SEMVER ORDER, not ancestry (P3 fix) ------
// Release tags live on non-ancestor leaves (the tag-only-push design), so
// `git describe --tags` (ancestry) picks the nearest ANCESTOR tag and skips the
// true, highest-version previous release. Build that topology: v0.0.1 is an OLD
// ancestor of HEAD; v0.0.9 is a RECENT non-ancestor leaf. The fixed gate must
// compare against v0.0.9 (recent + <4 cycles => cadence REJECT); the old
// ancestry walk compared against the old v0.0.1 and PASSED.
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  write(dir, "ITERATION_LOG.md", "| base |\n");
  git(dir, ["add", "-A"]);
  // A: an OLD commit so its tag v0.0.1 is >24h old (what the ancestry walk picks).
  const OLD = "2020-01-01T00:00:00";
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: OLD, GIT_COMMITTER_DATE: OLD } });
  git(dir, ["tag", "v0.0.1"]);
  const A = git(dir, ["rev-parse", "HEAD"]);
  // B: a sibling leaf off A, tagged v0.0.9 "now" — the highest-version tag, and
  // NOT an ancestor of HEAD.
  git(dir, ["checkout", "-q", "-b", "sibling", A]);
  write(dir, "sibling.ts", "export const s = 1;\n");
  commitAll(dir, "sibling release");
  git(dir, ["tag", "v0.0.9"]);
  // C = HEAD: real work off A (recent), with substance + tests but only 2 cycles.
  git(dir, ["checkout", "-q", "work"]);
  write(dir, "plugins/cool-workflow/src/feature.ts", "export const x = 1;\n");
  write(dir, "plugins/cool-workflow/test/feature-smoke.js", "// asserts feature\n");
  write(dir, "ITERATION_LOG.md", "| base |\n| 1 |\n| 2 |\n");
  commitAll(dir, "real work, too few cycles");
  const r = runGate(dir);
  assert.equal(r.code, 1, `must compare against the recent semver-prev v0.0.9, so <4 cycles REJECTS:\n${r.out}`);
  assert.match(r.out, /v0\.0\.9/, "the gate must resolve PREV_TAG to the highest-version tag (v0.0.9), not the ancestor v0.0.1");
  assert.doesNotMatch(r.out, /since v0\.0\.1/, "must NOT compare against the older ancestor tag v0.0.1 (the ancestry-walk bug)");
}

// ---- Case 3: substance — a NON-src, non-types/dist diff still counts -------
// Guards the fix that aligns the gate with its spec ("any file outside
// src/types/ and dist/"), not only files under src/.
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  write(dir, "docs/release.md", "tooling\n");                 // substance: outside src/types & dist
  write(dir, "plugins/cool-workflow/test/x-smoke.js", "//\n"); // test evidence
  write(dir, "ITERATION_LOG.md", "| 1 |\n| 2 |\n| 3 |\n| 4 |\n");
  commitAll(dir, "tooling-only but real");
  const r = runGate(dir);
  assert.equal(r.code, 0, `tooling diff outside src/types & dist should PASS substance:\n${r.out}`);
}

// ---- Case 4: spec accretion — only src/types/ + dist/ changed -> REJECT ----
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  write(dir, "plugins/cool-workflow/src/types/foo.ts", "export type Foo = { a?: number };\n");
  write(dir, "plugins/cool-workflow/dist/foo.js", "// built\n");
  commitAll(dir, "types + dist only");
  const r = runGate(dir);
  assert.equal(r.code, 1, `types/dist-only diff must be REJECTED:\n${r.out}`);
  assert.match(r.out, /spec accretion/, "should name spec accretion");
}

// ---- Case 5: zero test changes -> REJECT ----
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  write(dir, "plugins/cool-workflow/src/feature.ts", "export const y = 2;\n");
  write(dir, "ITERATION_LOG.md", "| 1 |\n| 2 |\n| 3 |\n| 4 |\n");
  commitAll(dir, "src but no tests");
  const r = runGate(dir);
  assert.equal(r.code, 1, `zero test changes must be REJECTED:\n${r.out}`);
  assert.match(r.out, /zero test changes/, "should name the test-evidence failure");
}

// ---- Case 6: cadence — <4 cycles and <24h -> REJECT ----
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]); // tag timestamp is "now" => <24h
  write(dir, "plugins/cool-workflow/src/feature.ts", "export const z = 3;\n");
  write(dir, "plugins/cool-workflow/test/z-smoke.js", "//\n");
  write(dir, "ITERATION_LOG.md", "| 1 |\n| 2 |\n"); // only 2 cycles
  commitAll(dir, "too few cycles");
  const r = runGate(dir);
  assert.equal(r.code, 1, `<4 cycles within 24h must be REJECTED:\n${r.out}`);
  assert.match(r.out, /cadence/, "should name the cadence failure");
}

// ---- Case 6b: cadence bypass via a recorded HOTFIX line -> PASS ----
// An urgent fix may ship inside the cadence window ONLY with an explicit, committed
// "HOTFIX:" reason. Same <4-cycles / <24h setup as Case 6, but the bypass is recorded.
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]); // tag timestamp is "now" => <24h
  write(dir, "plugins/cool-workflow/src/feature.ts", "export const h = 4;\n");
  write(dir, "plugins/cool-workflow/test/h-smoke.js", "//\n");
  write(dir, "ITERATION_LOG.md",
    "| 1 |\n| 2 |\nHOTFIX: live headline command broken on npm; ship inside 24h to stop user breakage\n");
  commitAll(dir, "urgent hotfix");
  const r = runGate(dir);
  assert.equal(r.code, 0, `a recorded HOTFIX must bypass cadence within the window:\n${r.out}`);
  assert.match(r.out, /cadence bypassed by recorded HOTFIX/, "must echo the bypass + reason (auditable, never silent)");
}

// ---- Case 7: version-number branch name -> REJECT ----
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  seedReleaseWork(dir);
  commitAll(dir, "work");
  git(dir, ["checkout", "-q", "-b", "feat/v999"]);
  const r = runGate(dir);
  assert.equal(r.code, 1, `version-number branch must be REJECTED:\n${r.out}`);
  assert.match(r.out, /version-number-driven/, "should name the branch-naming failure");
}

// ---- Case 7b: a shallow clone must FAIL, not skip checks like case 1 ------
// A shallow clone (or a clone with no tags) makes `git describe` fail the
// same way a true first release does, so PREV_TAG ends up empty in both
// cases. Before the fix, this mix-up let the gate skip
// substance/test-evidence/cadence and PASS on a shallow clone, even when an
// older tag was there, just outside the short history it can see. This
// case checks that it now FAILS.
// We build a REAL git repo with a tag, then make a REAL shallow clone of it
// (git clone --depth 1), so the test uses git's own shallow-check
// (git rev-parse --is-shallow-repository), not a stand-in.
{
  const srcDir = freshRepo();
  write(srcDir, "README.md", "init\n");
  commitAll(srcDir, "init");
  git(srcDir, ["tag", "v0.0.1"]); // a real past tag exists, just not in the shallow history
  write(srcDir, "README.md", "more\n");
  commitAll(srcDir, "second commit");

  const shallowDir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-gate-${caseId++}-shallow-`));
  const r0 = spawnSync("git", ["clone", "--depth", "1", "-q", `file://${srcDir}`, shallowDir], { encoding: "utf8" });
  assert.equal(r0.status, 0, `git clone --depth 1 must work:\n${r0.stderr}`);
  assert.equal(git(shallowDir, ["rev-parse", "--is-shallow-repository"]), "true",
    "fixture check: the clone must really be shallow");

  const r = runGate(shallowDir);
  assert.equal(r.code, 1, `shallow clone (real past tag hidden by shallow history) must be REJECTED:\n${r.out}`);
  assert.match(r.out, /shallow/i, "should name the shallow-clone problem, not skip checks like a true first release");
}

// ---- Case 7c: a FULL (non-shallow) --no-tags clone must FAIL too -----------
// The shallow check (Case 7b) closed only half the hole: a `git clone
// --no-tags` of a long-tagged repo is NOT shallow (is-shallow-repository =
// false) yet has 0 local tags, so PREV_TAG is empty exactly like a true first
// release. Before this half of the fix it slipped past the shallow check and
// silently skipped substance/test-evidence/cadence. It must now be REJECTED
// unless a first release is explicitly declared.
{
  const srcDir = freshRepo();
  write(srcDir, "README.md", "init\n");
  commitAll(srcDir, "init");
  git(srcDir, ["tag", "v0.0.1"]); // a real past tag exists in the source repo
  write(srcDir, "README.md", "more\n");
  commitAll(srcDir, "second commit");

  const noTagsDir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-gate-${caseId++}-notags-`));
  const r0 = spawnSync("git", ["clone", "--no-tags", "-q", `file://${srcDir}`, noTagsDir], { encoding: "utf8" });
  assert.equal(r0.status, 0, `git clone --no-tags must work:\n${r0.stderr}`);
  assert.equal(git(noTagsDir, ["rev-parse", "--is-shallow-repository"]), "false",
    "fixture check: a --no-tags clone must be FULL, not shallow (that is the whole point of this case)");
  assert.equal(git(noTagsDir, ["tag"]), "", "fixture check: the --no-tags clone must have 0 local tags");

  const r = runGate(noTagsDir);
  assert.equal(r.code, 1, `full --no-tags clone (real past tag not fetched) must be REJECTED, not treated as a first release:\n${r.out}`);
  assert.match(r.out, /not fetched|CW_FIRST_RELEASE|previous release tag/i,
    "should name the not-fetched-tags cause and the explicit-declaration escape hatch, not just 'shallow'");
  assert.doesNotMatch(r.out, /shallow git clone/i, "must NOT misreport a full --no-tags clone as shallow");

  // And with an explicit first-release declaration, the same clone PASSES —
  // the escape hatch works, so a genuine first release is never blocked.
  const r2 = runGate(noTagsDir, { CW_FIRST_RELEASE: "1" });
  assert.equal(r2.code, 0, `declared first release must PASS even with 0 tags:\n${r2.out}`);
}

// ---- Case 8: PREV_TAG resolution — HEAD already carries the tag (CI case) --
// On a tag push, HEAD has the new tag. A naive `git describe` returns it and
// the range collapses to empty, false-failing substance. The fix steps back to
// the prior tag. With valid work between v0.0.1 and v0.0.2, this must PASS.
{
  const dir = freshRepo();
  write(dir, "README.md", "init\n");
  commitAll(dir, "init");
  git(dir, ["tag", "v0.0.1"]);
  seedReleaseWork(dir);
  commitAll(dir, "real work for v0.0.2");
  git(dir, ["tag", "v0.0.2"]); // HEAD now carries the tag being "released"
  const r = runGate(dir);
  assert.equal(r.code, 0,
    `gate run on the tagged commit must compare against the PREVIOUS tag and PASS:\n${r.out}`);
}

process.stdout.write("release-gate-smoke: ok\n");
