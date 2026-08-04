#!/usr/bin/env node
"use strict";

// onramp-baseref-failclosed-smoke — the onramp base-ref resolver must FAIL
// CLOSED, never degrade to a vacuous HEAD..HEAD "no changes" pass, when a base
// ref was EXPECTED (a pull_request CI context sets GITHUB_BASE_REF) but git
// cannot resolve it. This mirrors PR #446, which closed the same vacuous-pass
// class one layer below in gitLinesOrThrow: an empty change set has no issues,
// so evaluateOnrampContract([]) reports ok:true -- a real, committed change
// could slip past the gate with no test at all (finding #11).
//
// It also proves the two guardrails the fix must keep:
//   * the LEGITIMATE local "show my own changes" use (no base ref requested or
//     expected, no remote) still works: it surfaces the uncommitted change and
//     does NOT throw.
//   * a HUNG git cannot block the gate forever: every onramp git spawn now
//     carries a finite timeout, so resolveChangedFiles fails closed in seconds
//     instead of hanging (finding #20).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const onrampPath = path.join(pluginRoot, "dist", "shell", "onramp.js");
const { resolveChangedFiles } = require(onrampPath);

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
}

// A throwaway git repo with ONE commit and a CLEAN working tree. Nothing is
// uncommitted, so a HEAD..HEAD diff is empty -- the exact state in which the
// old HEAD fallback produced a vacuous "0 changed files" pass.
function makeCleanRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onramp-baseref-"));
  git(dir, ["init", "-q"]);
  const author = ["-c", "user.email=cw@example.com", "-c", "user.name=cw", "-c", "commit.gpgsign=false"];
  fs.writeFileSync(path.join(dir, "file.txt"), "one\n");
  git(dir, [...author, "add", "file.txt"]);
  git(dir, [...author, "commit", "-q", "-m", "one"]);
  return dir;
}

// (1) FAIL CLOSED when a base ref was EXPECTED but cannot resolve.
// GITHUB_BASE_REF marks a pull_request context, so onramp must diff against
// origin/<base>. There is no remote here, so merge-base finds nothing. The old
// code fell back to HEAD and returned { baseRef: "HEAD", files: [] } (a vacuous
// pass); the fix must throw instead.
{
  const dir = makeCleanRepo();
  try {
    assert.throws(
      () => resolveChangedFiles({ cwd: dir, env: { GITHUB_BASE_REF: "no-such-base" } }),
      /base ref|fail closed|merge-base/i,
      "onramp must fail closed when a PR base ref was expected but git cannot resolve it, not degrade to an empty HEAD..HEAD diff"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// (2) GUARD: the legitimate local "show my own changes" use still works.
// No base ref requested or expected, no remote. merge-base against origin/main
// finds nothing, so onramp falls back to HEAD -- and `git diff HEAD` DOES
// surface the uncommitted change. This must NOT throw and must NOT be empty.
{
  const dir = makeCleanRepo();
  try {
    fs.writeFileSync(path.join(dir, "file.txt"), "one\ntwo\n"); // uncommitted edit
    const changed = resolveChangedFiles({ cwd: dir, env: {} });
    assert.equal(changed.baseRef, "HEAD", "local no-base use resolves to HEAD");
    assert.ok(
      changed.files.some((f) => f.endsWith("file.txt")),
      `local uncommitted change must be surfaced, got ${JSON.stringify(changed.files)}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// (3) A HUNG git cannot block the gate forever (finding #20). A fake `git` on
// PATH that never returns stands in for a cold fsmonitor daemon or a credential
// prompt. With the per-spawn timeout, resolveChangedFiles fails closed within a
// few seconds; WITHOUT it the call blocks until the child is killed. We run it
// in a child process with a wall-clock bound and assert the child EXITS ON ITS
// OWN (fail closed) rather than being killed at the bound. This block assumes
// the internal git timeout is ~5s (two spawns before the fail-closed throw
// ~= 10s), comfortably under the 18s bound.
{
  const dir = makeCleanRepo();
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "onramp-fakegit-"));
  const fakeGit = path.join(fakeBin, "git");
  fs.writeFileSync(fakeGit, "#!/bin/sh\nexec sleep 30\n");
  fs.chmodSync(fakeGit, 0o755);
  const runner =
    "const {resolveChangedFiles}=require(process.argv[1]);" +
    "try{resolveChangedFiles({cwd:process.argv[2],env:{GITHUB_BASE_REF:'x'}});process.exit(0);}" +
    "catch(e){process.exit(3);}";
  let killed = false;
  let status;
  try {
    execFileSync(process.execPath, ["-e", runner, onrampPath, dir], {
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
      timeout: 18000,
      stdio: ["ignore", "ignore", "ignore"]
    });
    status = 0;
  } catch (error) {
    if (error && (error.killed || error.signal)) killed = true;
    else status = error && typeof error.status === "number" ? error.status : undefined;
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(
    !killed,
    "a hung git must not block the onramp gate; every git spawn needs a finite timeout so resolveChangedFiles fails closed in seconds"
  );
  assert.notEqual(
    status,
    0,
    "resolveChangedFiles must fail closed (throw) when git never returns, not report zero changes"
  );
}

process.stdout.write("onramp-baseref-failclosed-smoke: ok\n");
