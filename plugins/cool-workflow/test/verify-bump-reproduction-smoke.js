#!/usr/bin/env node
"use strict";

// verify-bump-reproduction-smoke — exercises scripts/verify-bump-reproduction.js
// against THIS REPO'S REAL git history (not a toy fixture), which is the only
// way to prove it actually works with the real bump-version.js/
// sync-project-index.js (canonical-apps list, manifest propagation, dist/
// regeneration, and all). verdict-signing-workflow-smoke.js's fixtures use
// stub npm scripts to test the orchestration cheaply; this test proves the
// orchestration ALSO works against the genuinely complex real tooling.
//
// Two cases:
//   1. real release — v0.2.2's actual approved-parent/tagged-commit pair
//      must reproduce to a byte-exact tree match (this is EXACTLY how the
//      approach was validated before being implemented: reproducing v0.2.2
//      by hand gave an identical tree hash).
//   2. the actual attack — clone the repo, replay v0.2.2's already-committed,
//      genuinely-signed-shaped verdict onto a NEW commit that also smuggles
//      in an arbitrary file, and confirm the reproduction rejects it.
//
// Slow by nature (git clone + npm ci against the real, non-trivial repo) —
// acceptable; this is the one place that proves the real tooling integration
// works, not just the orchestration shape.
//
// Portable: node + git + npm only, isolated tmpdir/clone. Never touches the
// actual working tree.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REAL_REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL = "plugins/cool-workflow/scripts/verify-bump-reproduction.js";
assert.ok(fs.existsSync(path.join(REAL_REPO_ROOT, SCRIPT_REL)), `${SCRIPT_REL} must exist`);

// A real, historical approved-parent -> tagged-release pair from this repo's
// own history (v0.2.2). Confirmed present via:
//   git log --oneline --all -- '.cw-release/review-a9a78134....verdict'
// If this pair is ever pruned (should never happen for a real release), any
// other real pair found the same way works just as well.
const REAL_PARENT = "a9a78134c9729c4514dcb7a4a8fc56f5d1a93b57";
const REAL_TAGGED = "36092b713585b4a0d8eb1a246ca9da16ce2a800d";
const REAL_VERDICT_REL = `.cw-release/review-${REAL_PARENT}.verdict`;

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// Always run the SCRIPT FILE from the current, real checkout (targetCwd, for
// a historical/attack test, may be checked out at an OLD commit that predates
// this script's own existence — the script's location and the git context it
// operates against are independent: `git rev-parse --show-toplevel` inside
// the script resolves from targetCwd, regardless of where the script itself
// was loaded from).
function runReproduction(targetCwd, parent, tagged, verdictRel) {
  return spawnSync(process.execPath, [path.join(REAL_REPO_ROOT, SCRIPT_REL), parent, tagged, verdictRel], {
    cwd: targetCwd,
    encoding: "utf8"
  });
}

// Sanity: the real pair actually exists in THIS checkout before testing
// against it. A shallow checkout (CI's default depth-1) does not carry those
// old objects, and git's own error for that ("exists on disk, but not in
// <commit>") points at the wrong thing entirely — so name the real cause.
assert.equal(
  git(["rev-parse", "--is-shallow-repository"], REAL_REPO_ROOT),
  "false",
  "this test reads the repo's real release history; check out with full history (fetch-depth: 0)"
);
git(["cat-file", "-e", `${REAL_TAGGED}:${REAL_VERDICT_REL}`], REAL_REPO_ROOT);

// ---- 1. Real release reproduces to a byte-exact tree match ----------------
{
  const r = runReproduction(REAL_REPO_ROOT, REAL_PARENT, REAL_TAGGED, REAL_VERDICT_REL);
  assert.equal(r.status, 0, `real v0.2.2 release must reproduce exactly:\n${r.stderr}\n${r.stdout}`);
}

// A `git clone` gets its OWN remote (the local clone-source path), unlike
// `git worktree add` (what verify-bump-reproduction.js itself always uses),
// which shares the real repo's remote config automatically — confirmed
// empirically, and the reason the script itself needs no remote-pinning
// logic. Pin the clone's remote to match the real repo's here, in the TEST
// only, so a failure below is attributable purely to the injected file, not
// an incidental "- Repository: <url>" mismatch from the clone methodology.
const REAL_REMOTE_URL = git(["config", "--get", "remote.origin.url"], REAL_REPO_ROOT);

// ---- 2. Clone-methodology positive control: replaying the SAME verdict with
// NO injected file (via a clone, remote pinned) must still reproduce cleanly
// — isolates that clone-based testing itself introduces no spurious mismatch.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-bump-repro-control-"));
  const clone = path.join(tmp, "control-repo");
  try {
    git(["clone", "-q", REAL_REPO_ROOT, clone]);
    git(["remote", "set-url", "origin", REAL_REMOTE_URL], clone);
    const r = runReproduction(clone, REAL_PARENT, REAL_TAGGED, REAL_VERDICT_REL);
    assert.equal(r.status, 0, `an unmodified clone of the real pair must still reproduce exactly:\n${r.stderr}\n${r.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- 3. THE ACTUAL ATTACK: replay the real verdict onto a backdoored commit
// in a throwaway CLONE (never mutates the real working tree) --------------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-bump-repro-attack-"));
  const clone = path.join(tmp, "attack-repo");
  try {
    git(["clone", "-q", REAL_REPO_ROOT, clone]);
    git(["remote", "set-url", "origin", REAL_REMOTE_URL], clone);
    git(["checkout", "-q", REAL_PARENT], clone);
    git(["checkout", "-q", "-b", "forged"], clone);
    git(["config", "user.email", "t@t"], clone);
    git(["config", "user.name", "t"], clone);
    git(["config", "commit.gpgsign", "false"], clone);
    // Copy the REAL, already-committed verdict — a public git object, no
    // secret needed — exactly as an attacker with tag-push access could.
    const verdictText = git(["show", `${REAL_TAGGED}:${REAL_VERDICT_REL}`], clone);
    fs.mkdirSync(path.join(clone, ".cw-release"), { recursive: true });
    fs.writeFileSync(path.join(clone, REAL_VERDICT_REL), `${verdictText}\n`);
    fs.writeFileSync(path.join(clone, "backdoor.js"), "// malicious payload, never reviewed\n");
    git(["add", "-A"], clone);
    git(["commit", "-q", "-m", "chore: bump version to 9.9.9 (attacker replay)"], clone);
    const forgedSha = git(["rev-parse", "HEAD"], clone);

    const r = runReproduction(clone, REAL_PARENT, forgedSha, REAL_VERDICT_REL);
    assert.notEqual(r.status, 0, `a replayed verdict on a commit with an injected file must be rejected:\n${r.stdout}`);
    assert.match(r.stderr, /does not match the deterministic bump/, "should explain the tree mismatch");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

process.stdout.write("verify-bump-reproduction-smoke: ok (real release reproduces exactly; replayed-verdict attack rejected)\n");
