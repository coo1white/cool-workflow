// fails-before-check-smoke — proves scripts/fails-before-check.mjs
// (`npm run fails-before:check`) has teeth. Every case runs against a tiny
// throwaway git repo (CW_FAILS_BEFORE_ROOT) with the plugin's layout: a
// src/ file, its committed dist/ build, and tests that import dist/. The
// real tree is never touched.

import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(pluginRoot, "scripts", "fails-before-check.mjs");
const P = "plugins/cool-workflow";

function git(args, cwd) {
  return cp.execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

function run(root, args = ["--base", "main"]) {
  return cp.spawnSync(process.execPath, [script, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: { ...process.env, CW_FAILS_BEFORE_ROOT: root }
  });
}

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function worktrees(root) {
  return git(["worktree", "list", "--porcelain"], root).split("\n").filter((l) => l.startsWith("worktree ")).length;
}

const root = tmpDir("cw-fails-before-");
git(["init", "-q", "-b", "main"], root);
git(["config", "user.email", "test@example.com"], root);
git(["config", "user.name", "test"], root);
write(root, `${P}/src/add.ts`, "export const add = (a: number, b: number) => a - b;\n");
write(root, `${P}/dist/add.js`, "export const add = (a, b) => a - b;\n");
write(root, `${P}/test/old.test.mjs`, "import { add } from '../dist/add.js';\nif (typeof add !== 'function') process.exit(1);\n");
write(root, `${P}/README.md`, "# x\n");
git(["add", "-A"], root);
git(["commit", "-q", "-m", "base"], root);
git(["checkout", "-q", "-b", "work"], root);

function fixSrc() {
  write(root, `${P}/src/add.ts`, "export const add = (a: number, b: number) => a + b;\n");
  write(root, `${P}/dist/add.js`, "export const add = (a, b) => a + b;\n");
}

// 1. No src change: skip, silent, exit 0, and no worktree is made.
{
  write(root, `${P}/README.md`, "# x, more words\n");
  write(root, `${P}/test/new.test.mjs`, "process.exit(0);\n");
  const r = run(root);
  assert.equal(r.status, 0, `a diff with no src change must pass: ${r.stderr}`);
  assert.equal(r.stdout, "", "silent on success (stdout)");
  assert.equal(r.stderr, "", "silent on success (stderr)");
  const j = JSON.parse(run(root, ["--base", "main", "--json"]).stdout);
  assert.equal(j.skipped, true);
  assert.equal(j.ok, true);
  assert.equal(worktrees(root), 1);
  git(["checkout", "-q", "--", "."], root);
  fs.rmSync(path.join(root, `${P}/test/new.test.mjs`));
}

// 2. A src change with no test change: fails, says what to do.
{
  fixSrc();
  write(root, `${P}/test/fixtures/data.txt`, "not a test\n");
  const r = run(root);
  assert.equal(r.status, 1, "a src change with no test must fail");
  assert.equal(r.stdout, "", "faults go to stderr only");
  assert.match(r.stderr, /fails-before:check: 1 file\(s\) under plugins\/cool-workflow\/src\/ changed .* no test file/);
  const j = JSON.parse(run(root, ["--base", "main", "--json"]).stdout);
  assert.deepEqual(j.faults.map((f) => f.fault), ["no-test"]);
  git(["checkout", "-q", "--", "."], root);
  fs.rmSync(path.join(root, `${P}/test/fixtures`), { recursive: true });
}

// 3. A src change whose only test passes at base too: fails.
{
  fixSrc();
  write(root, `${P}/test/weak-smoke.mjs`, "import { add } from '../dist/add.js';\nif (typeof add !== 'function') process.exit(1);\n");
  const r = run(root);
  assert.equal(r.status, 1, "a test that passes at base proves nothing");
  assert.match(r.stderr, /every changed test passes at main .*weak-smoke\.mjs/);
  const j = JSON.parse(run(root, ["--base", "main", "--json"]).stdout);
  assert.deepEqual(j.faults.map((f) => f.fault), ["passes-at-base"]);
  assert.deepEqual(j.tests.map((t) => [t.test, t.failedAtBase]), [[`${P}/test/weak-smoke.mjs`, false]]);
  assert.equal(worktrees(root), 1, "the temp worktree is taken away after a fault");
  git(["checkout", "-q", "--", "."], root);
  fs.rmSync(path.join(root, `${P}/test/weak-smoke.mjs`));
}

// 4. A src change with a test that fails at base (old dist: 2 - 2 = 0) and
//    a changed helper copied in with it: passes, silent, worktree gone.
//    Committed, the way CI sees a PR.
{
  fixSrc();
  write(root, `${P}/test/helpers/want.mjs`, "export const want = 4;\n");
  write(
    root,
    `${P}/test/core/add.test.mjs`,
    "import assert from 'node:assert/strict';\nimport { add } from '../../dist/add.js';\nimport { want } from '../helpers/want.mjs';\nassert.equal(add(2, 2), want);\n"
  );
  assert.equal(cp.spawnSync(process.execPath, [path.join(root, `${P}/test/core/add.test.mjs`)]).status, 0, "the test passes at head");
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "fix add"], root);
  const r = run(root);
  assert.equal(r.status, 0, `a test that fails at base must pass the check: ${r.stderr}`);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
  const j = JSON.parse(run(root, ["--base", "main", "--json"]).stdout);
  assert.equal(j.ok, true);
  assert.equal(j.base.commit, git(["rev-parse", "main"], root).trim(), "base is the merge base with main");
  assert.deepEqual(j.tests.map((t) => [t.test, t.failedAtBase]), [[`${P}/test/core/add.test.mjs`, true]]);
  assert.match(j.tests[0].why, /AssertionError/, "the helper was copied, so the fail is the assert, not a missing import");
  assert.equal(worktrees(root), 1, "the temp worktree is taken away after a pass");
}

// 5. Fail closed: a base ref that is not there, and --base with no ref.
{
  const r = run(root, ["--base", "no-such-branch"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused: the base ref no-such-branch is not in this clone/);
  const j = run(root, ["--base", "no-such-branch", "--json"]);
  assert.equal(j.status, 1);
  assert.equal(JSON.parse(j.stdout).ok, false);
  const empty = run(root, ["--base"]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /refused: --base needs a ref/);
}

// 6. No merge base (unrelated history): refuses.
{
  git(["checkout", "-q", "--orphan", "lone"], root);
  git(["rm", "-rq", "--cached", "."], root);
  fs.rmSync(path.join(root, P), { recursive: true });
  write(root, "x.txt", "x\n");
  git(["add", "x.txt"], root);
  git(["commit", "-q", "-m", "lone"], root);
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused: HEAD and main have no merge base/);
}

process.stdout.write("fails-before-check smoke: ok\n");
