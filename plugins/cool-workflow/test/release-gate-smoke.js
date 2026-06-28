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
function runGate(dir) {
  const r = spawnSync("bash", [GATE], { cwd: dir, encoding: "utf8" });
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
  const r = runGate(dir);
  assert.equal(r.code, 0, `no-prev-tag should PASS:\n${r.out}`);
  const sha = git(dir, ["rev-parse", "HEAD"]);
  assert.ok(fs.existsSync(path.join(dir, ".cw-release", `gate-${sha}.ok`)),
    "PASS must write the gate-<sha>.ok marker");
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
