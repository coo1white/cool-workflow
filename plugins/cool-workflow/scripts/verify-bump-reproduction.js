#!/usr/bin/env node
"use strict";
// verify-bump-reproduction.js — closes the HEAD~1 verdict-replay bypass.
//
// release-gate.yml / npm-publish.yml tolerate a verdict written for the tag
// commit's PARENT (release-flow.js's cut() reviews content, then adds a
// mechanical version-bump + the verdict as a NEW child commit that actually
// gets tagged). A validly-signed verdict at the parent proves someone once
// approved THAT commit — it does NOT prove the child (the thing actually being
// tagged) is the deterministic bump cut() would have produced, rather than an
// attacker's own commit smuggling in arbitrary changes on top of an old,
// genuinely-approved parent (a real signature on a REPLAYED verdict).
//
// This script independently reproduces the bump: checks out the approved
// parent into a scratch worktree, runs the SAME bump:version/sync:project-index
// steps cut() runs, stages the SAME way cut() stages (git add -u + the
// explicit verdict/.sig paths, never -A), and requires the resulting tree to
// match the ACTUAL tagged commit's tree byte-for-byte. Any difference —
// anywhere, including a single added file — fails closed.
//
// (Node port of the former verify-bump-reproduction.sh; behavior kept line
// for line — same steps, same messages, same exit map.)
//
// Usage: verify-bump-reproduction.js <approved-parent-sha> <tagged-sha> <verdict-repo-relative-path> [sig-repo-relative-path]
//
// Exit 0: the tagged commit's tree matches the reproduced bump exactly.
// Exit 1: mismatch, or any step failed (install, bump, sync, worktree, etc).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Where THIS SCRIPT ITSELF lives — distinct from REPO_ROOT (the git repo being
// operated ON, resolved below from the invocation cwd). These coincide in
// ordinary production use (the script runs from within the same checkout it
// verifies), but conflating them is wrong: REPO_ROOT could be an ARBITRARY git
// context (e.g. a test harness's throwaway clone of old history, which never
// has this script's own sibling files, since they postdate whatever was
// cloned). Sibling files this script depends on must be found relative to
// where it is installed, never relative to the repo it happens to be pointed at.
const SCRIPT_DIR = __dirname;

function err(msg) {
  process.stderr.write(`${msg}\n`);
}

const [, , PARENT, TAGGED, VERDICT_REL, SIG_REL = ""] = process.argv;
if (!PARENT || !TAGGED || !VERDICT_REL) {
  err("usage: verify-bump-reproduction.js <parent-sha> <tagged-sha> <verdict-rel-path> [sig-rel-path]");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}
function gitIn(dir, args, opts = {}) {
  return run("git", ["-C", dir, ...args], opts);
}

const top = run("git", ["rev-parse", "--show-toplevel"]);
if (top.status !== 0) process.exit(1);
const REPO_ROOT = top.stdout.trim();

const SCRATCH_PARENT = fs.mkdtempSync(path.join(os.tmpdir(), "cw-bump-repro-"));
const SCRATCH = path.join(SCRATCH_PARENT, "wt");
function cleanup() {
  gitIn(REPO_ROOT, ["worktree", "remove", "--force", SCRATCH], { stdio: "ignore" });
  fs.rmSync(SCRATCH_PARENT, { recursive: true, force: true });
}

function main() {
  const wt = gitIn(REPO_ROOT, ["worktree", "add", "--quiet", "--detach", SCRATCH, PARENT], { stdio: "ignore" });
  if (wt.status !== 0) {
    err(`verify-bump-reproduction: could not create a scratch worktree at ${PARENT}`);
    return 1;
  }

  // The target version comes from the TAGGED commit (not the parent, which may
  // still be pre-bump) — read via git plumbing, no separate checkout needed.
  const pkgShow = gitIn(REPO_ROOT, ["show", `${TAGGED}:plugins/cool-workflow/package.json`]);
  let VERSION = "";
  if (pkgShow.status === 0) {
    try {
      VERSION = JSON.parse(pkgShow.stdout).version || "";
    } catch {
      VERSION = "";
    }
  }
  if (!VERSION) {
    err(`verify-bump-reproduction: could not read package.json version from tagged commit ${TAGGED}`);
    return 1;
  }

  // sync-project-index.js embeds a wall-clock "Generated on <date>" line. Pin it
  // to the TAGGED commit's own committer date (UTC) via a Node --require preload
  // that overrides the global Date constructor (fake-date-for-reproduction.js),
  // NOT an application-level env var: the scratch worktree runs the APPROVED
  // PARENT's OWN checked-out copy of sync-project-index.js, which for every
  // release cut before this mechanism existed has no idea any such env var is
  // meant to be read — an app-level opt-in is a no-op against code that doesn't
  // know to opt in, so it can only ever "work" for releases cut after the
  // mechanism landed (confirmed empirically: re-running an already-shipped
  // release's real approved-parent/tagged pair on a later calendar day produced
  // a tree mismatch whose ONLY diff was that one date line). A global override
  // of the Date constructor, injected before any application code runs, is
  // transparent to the code being executed regardless of which version it is.
  const dateShow = gitIn(REPO_ROOT, ["show", "-s", "--format=%cd", "--date=format-local:%Y-%m-%d", TAGGED], {
    env: { ...process.env, TZ: "UTC" },
  });
  const CUT_DATE = dateShow.status === 0 ? dateShow.stdout.trim() : "";
  if (!CUT_DATE) {
    err("verify-bump-reproduction: could not read the tagged commit's committer date");
    return 1;
  }
  const FAKE_DATE_PRELOAD = path.join(SCRIPT_DIR, "fake-date-for-reproduction.js");

  // Each step's exit code is checked EXPLICITLY and immediately (not via one
  // combined chain) — a chain's overall success can silently survive an earlier
  // step's failure if a future edit ever loosens it, which would flip this
  // fail-closed gate to fail-open without changing its outward shape.
  // stdout/stderr from each step are captured (not discarded) so a real
  // failure — a transient npm registry hiccup vs. an actual reproduction
  // mismatch — is distinguishable in the workflow log instead of both
  // collapsing into the same generic message.
  const stepCwd = path.join(SCRATCH, "plugins", "cool-workflow");
  const stepEnv = {
    ...process.env,
    NODE_OPTIONS: `--require ${FAKE_DATE_PRELOAD}`,
    CW_FAKE_DATE: CUT_DATE,
  };
  function runStep(label, cmd, args) {
    const r = run(cmd, args, { cwd: stepCwd, env: stepEnv });
    const out = (r.stdout || "") + (r.stderr || "");
    const code = r.error ? 1 : r.status;
    if (code !== 0) {
      err(`verify-bump-reproduction: ${label} failed (exit ${code}):`);
      err(out);
      return false;
    }
    return true;
  }

  const bumpOk =
    runStep("npm install", "npm", ["install", "--no-package-lock", "--ignore-scripts"]) &&
    runStep("bump:version", "npm", ["run", "bump:version", "--", VERSION]) &&
    runStep("sync:project-index", "npm", ["run", "sync:project-index", "--", "--repo-only"]);
  if (!bumpOk) {
    err(`verify-bump-reproduction: reproducing the bump for ${PARENT} -> v${VERSION} failed`);
    return 1;
  }

  fs.mkdirSync(path.join(SCRATCH, ".cw-release"), { recursive: true });
  try {
    fs.copyFileSync(path.join(REPO_ROOT, VERDICT_REL), path.join(SCRATCH, VERDICT_REL));
  } catch {
    return 1;
  }
  if (SIG_REL && fs.existsSync(path.join(REPO_ROOT, SIG_REL))) {
    try {
      fs.copyFileSync(path.join(REPO_ROOT, SIG_REL), path.join(SCRATCH, SIG_REL));
    } catch {
      return 1;
    }
  }

  // Mirror cut()'s OWN staging exactly (git-add -u + the explicit verdict/.sig
  // paths) — never -A, so an untracked stray left by npm/tooling in the scratch
  // worktree can never silently ride into what we compare.
  gitIn(SCRATCH, ["add", "-u"]);
  gitIn(SCRATCH, ["add", "--", VERDICT_REL]);
  if (SIG_REL && fs.existsSync(path.join(SCRATCH, SIG_REL))) {
    gitIn(SCRATCH, ["add", "--", SIG_REL]);
  }

  const EXPECTED_TREE = gitIn(SCRATCH, ["write-tree"]).stdout.trim();
  const ACTUAL_TREE = gitIn(REPO_ROOT, ["rev-parse", `${TAGGED}^{tree}`]).stdout.trim();

  if (EXPECTED_TREE !== ACTUAL_TREE) {
    err(`verify-bump-reproduction: ${TAGGED}'s tree (${ACTUAL_TREE}) does not match the deterministic bump reproduced from approved parent ${PARENT} (${EXPECTED_TREE}) — refusing`);
    return 1;
  }

  return 0;
}

let code = 1;
try {
  code = main();
} finally {
  cleanup();
}
process.exit(code);
