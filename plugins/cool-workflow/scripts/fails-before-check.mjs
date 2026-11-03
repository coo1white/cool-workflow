#!/usr/bin/env node
// fails-before-check.mjs — AGENTS.md Iteration Loop, IMPLEMENT and VERIFY:
// a fix needs a test that fails before the change and passes after it.
// That rule was prose a reviewer read at the last step; this script holds it
// in PR CI.
//
// What it checks, for the diff from the merge base of HEAD and a base ref
// (default origin/main; `--base REF` for another) to the working tree:
//   1. If no file under plugins/cool-workflow/src/ changed: skip, exit 0,
//      silent. Docs, tests, scripts and CI files need no fails-before proof
//      from this script.
//   2. Else the diff must add or change at least one test file:
//      plugins/cool-workflow/test/**/*.test.mjs or
//      plugins/cool-workflow/test/*-smoke.mjs.
//   3. In a temp `git worktree` at the merge base, every added or changed
//      file under plugins/cool-workflow/test/ is copied in (so a changed
//      helper or fixture goes with its test; only src/ and dist/ are old),
//      and each changed test file is run with node against the base's
//      committed dist/ (dist is committed, so nothing is built). At least
//      one of them must FAIL there. All passing at base means no test holds
//      the change. The temp worktree is taken away after, pass or fail.
//   Each test runs in its own scratch HOME, CW_HOME, TMPDIR and cwd, with
//   CW_NO_AUTO_AGENT=1 and no agent or signing env, the way test/run-all.mjs
//   runs a smoke. The plugin's node_modules (if there is one) is linked into
//   the worktree, so a missing dev package does not pass for a real fail.
//
// Limits, said plainly: a test that fails at base for a reason other than
// the change (a time limit, a new helper not copied) still counts as a
// fail; a test is read as failing on any non-zero exit. The reviewer still
// reads the test. A deleted test file is not counted.
//
// Fail closed: a base ref that does not resolve, no merge base (a shallow
// clone), or a worktree that cannot be made is a refusal, exit 1.
//
// Output: silent, exit 0 on success (Rule of Silence). Faults on stderr,
// exit 1. `--json` prints one JSON object on stdout (exit code the same).
//
// Consumers: npm script `fails-before:check`, the `fails-before` job in
// .github/workflows/ci.yml (pull requests only, not a required check),
// test/fails-before-check-smoke.mjs.
// Test override: CW_FAILS_BEFORE_ROOT is the git root to check in place of
// this repo.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const PLUGIN = "plugins/cool-workflow";
const SRC = `${PLUGIN}/src/`;
const TEST = `${PLUGIN}/test/`;
const TEST_FILE = /^plugins\/cool-workflow\/test\/(?:.+\.test\.mjs|[^/]+-smoke\.mjs)$/;
const PER_TEST_TIMEOUT_MS = Math.max(1000, Number(process.env.CW_TEST_TIMEOUT_MS) || 120000);
const STRIP_ENV = [
  "CW_AGENT_COMMAND",
  "CW_AGENT_ENDPOINT",
  "CW_AGENT_MODEL",
  "CW_AGENT_TIMEOUT_MS",
  "CW_AGENT_ATTEST_PUBKEY",
  "CW_AGENT_ATTEST_PRIVKEY",
  "CW_REQUIRE_ATTESTED_TELEMETRY",
  "CW_BACKEND",
  "CW_RELEASE_VERDICT_PRIVKEY",
  "CW_FAILS_BEFORE_ROOT"
];

const pluginRoot = path.resolve(import.meta.dirname, "..");
const root = process.env.CW_FAILS_BEFORE_ROOT || path.resolve(pluginRoot, "..", "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const baseArg = (() => {
  const i = args.indexOf("--base");
  if (i === -1) return "origin/main";
  const value = args[i + 1];
  return value && !value.startsWith("--") ? value : null;
})();

class Refusal extends Error {}

function git(gitArgs, cwd = root) {
  try {
    return execFileSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function resolveBase() {
  if (baseArg === null) throw new Refusal("--base needs a ref, e.g. --base origin/main");
  const ref = git(["rev-parse", "--verify", "--quiet", `${baseArg}^{commit}`]);
  if (!ref) {
    throw new Refusal(`the base ref ${baseArg} is not in this clone. Fetch it (git fetch origin main) or pass --base REF.`);
  }
  const mergeBase = git(["merge-base", "HEAD", ref]);
  if (!mergeBase) {
    const shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
    throw new Refusal(
      `HEAD and ${baseArg} have no merge base in this clone` +
        (shallow ? " (it is a shallow clone)" : "") +
        ". Fetch the full history: git fetch --unshallow (CI: fetch-depth: 0)."
    );
  }
  return { ref: baseArg, commit: mergeBase };
}

// Changed paths, base against the working tree, plus files not yet added.
function changedFiles(base) {
  const out = git(["diff", "--name-status", "--no-renames", base]);
  if (out === null) throw new Refusal(`git diff against ${base} failed`);
  const files = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    files.push({ path: file, deleted: status === "D" });
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard"]) || "";
  for (const file of untracked.split("\n").filter(Boolean)) files.push({ path: file, deleted: false });
  return files;
}

function sandboxEnv(dir) {
  const home = path.join(dir, "home");
  const tmp = path.join(dir, "tmp");
  for (const d of [home, tmp, path.join(dir, "cwd")]) fs.mkdirSync(d, { recursive: true });
  const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home, HOME: home, TMPDIR: tmp, CW_NO_AUTO_AGENT: "1", CW_REQUIRE_RESOLVABLE_EVIDENCE: "0" };
  for (const key of STRIP_ENV) delete env[key];
  return env;
}

function runAtBase(base, copies, tests) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-fails-before-")));
  const tree = path.join(scratch, "tree");
  const added = git(["worktree", "add", "--detach", "--quiet", tree, base]);
  try {
    if (added === null) throw new Refusal(`git worktree add at ${base} failed`);
    for (const rel of copies) {
      const to = path.join(tree, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(root, rel), to);
    }
    const modules = path.join(root, PLUGIN, "node_modules");
    const linkTo = path.join(tree, PLUGIN, "node_modules");
    if (fs.existsSync(modules) && !fs.existsSync(linkTo) && fs.existsSync(path.dirname(linkTo))) {
      fs.symlinkSync(modules, linkTo, "dir");
    }
    return tests.map((rel, i) => {
      const box = path.join(scratch, `box-${i}`);
      const env = sandboxEnv(box);
      const r = spawnSync(process.execPath, [path.join(tree, rel)], {
        cwd: path.join(box, "cwd"),
        env,
        encoding: "utf8",
        timeout: PER_TEST_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"]
      });
      // The first error line says why it failed; the end of a node stack
      // says only the node version.
      const lines = `${r.stderr || ""}`.split("\n").map((l) => l.trim()).filter(Boolean);
      const why = lines.find((l) => /^[A-Za-z]*Error\b/.test(l)) || lines[0] || "";
      return { test: rel, failedAtBase: r.status !== 0, exit: r.status, signal: r.signal || null, why: why.slice(0, 300) };
    });
  } finally {
    if (added !== null) git(["worktree", "remove", "--force", tree]);
    fs.rmSync(scratch, { recursive: true, force: true });
    git(["worktree", "prune"]);
  }
}

function check() {
  const base = resolveBase();
  const changed = changedFiles(base.commit);
  const src = changed.filter((f) => f.path.startsWith(SRC)).map((f) => f.path).sort();
  if (src.length === 0) return { ok: true, skipped: true, base, src, tests: [], faults: [] };
  const copies = changed.filter((f) => !f.deleted && f.path.startsWith(TEST)).map((f) => f.path).sort();
  const tests = copies.filter((p) => TEST_FILE.test(p));
  if (tests.length === 0) {
    return {
      ok: false,
      skipped: false,
      base,
      src,
      tests: [],
      faults: [
        {
          fault: "no-test",
          message:
            `${src.length} file(s) under ${SRC} changed since ${base.ref} (${base.commit.slice(0, 12)}), but no test file ` +
            `(test/**/*.test.mjs or test/*-smoke.mjs) was added or changed. Add a test that fails before the change.`
        }
      ]
    };
  }
  const results = runAtBase(base.commit, copies, tests);
  const faults = [];
  if (!results.some((r) => r.failedAtBase)) {
    faults.push({
      fault: "passes-at-base",
      message:
        `every changed test passes at ${base.ref} (${base.commit.slice(0, 12)}), before the src change: ` +
        `${tests.join(", ")}. A fix needs a test that fails before it; make one assert the new behavior.`
    });
  }
  return { ok: faults.length === 0, skipped: false, base, src, tests: results, faults };
}

function main() {
  let result;
  try {
    result = check();
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    else process.stderr.write(`fails-before:check: refused: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else for (const f of result.faults) process.stderr.write(`fails-before:check: ${f.message}\n`);
  if (!result.ok) process.exitCode = 1;
}

main();
