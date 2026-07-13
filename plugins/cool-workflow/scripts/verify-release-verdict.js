#!/usr/bin/env node
"use strict";
// verify-release-verdict.js — the one true "find a signed, committed release
// verdict for this commit" check. Both CI workflows call it:
//   .github/workflows/release-gate.yml   (cwd = repo root)
//   .github/workflows/npm-publish.yml    (cwd = plugins/cool-workflow)
// Before this file, each workflow kept its own ~35-line bash copy of this
// same loop, and the two copies could drift apart. Now the logic lives here
// only, and each workflow step is one line.
//
// One more win: a GitHub Actions `run:` step prints its FULL script text to
// the log before it runs. With the old inline bash, the "::error::" lines of
// the fail branch were printed on EVERY run — even a fully green one — and
// GitHub's log UI marked them red, which made a good release look bad. With
// a one-line `run:`, the "::error::" text only ever gets printed when this
// script truly fails.
//
// WHY the check is shaped this way (was: near-same comments in both YAMLs):
// The tag commit itself bumps version/changelog; the reviewed sha is its
// parent. So a verdict for HEAD or HEAD~1 is accepted. But a validly-signed
// verdict for the PARENT alone does not prove HEAD is the same mechanical
// bump release-flow.js's cut() would have made on top of the approved
// parent — it could be an attacker's own commit smuggling in changes on top
// of an old, truly-approved parent, replaying that parent's already-public
// verdict + signature (public git objects; no secret is needed to copy
// them). So when the match is at HEAD~1, HEAD must ALSO reproduce exactly
// as the deterministic bump (verify-bump-reproduction.js).
//
// The pubkey is read from origin/main, NOT from the checked-out tree. The
// checked-out tree IS the commit under test — an attacker's tag could just
// delete .cw-release/verdict-signing.pub and fall back to a no-signature
// check. origin/main is a ref the tag being judged cannot rewrite. Until a
// pubkey is committed there, this stays a first-line-only text check
// (opt-in, backward compatible — see scripts/verdict-keygen.js).
//
// cwd does not matter: everything is anchored on
// `git rev-parse --show-toplevel`, and the two helper scripts are loaded
// from this script's own directory (never from the repo under test).
//
// Usage: verify-release-verdict.js [--context "<one sentence for the fail message>"]
// Exit 0: a valid verdict was found. Exit 1: none found — the two
// "::error::" lines are printed here and nowhere else.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Where THIS SCRIPT lives — the helper scripts are siblings of the installed
// script, never files of the (possibly throwaway) repo being checked. Same
// rule as in verify-bump-reproduction.js.
const VERIFY_SIG = path.join(__dirname, "verify-verdict-signature.js");
const VERIFY_BUMP = path.join(__dirname, "verify-bump-reproduction.js");

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function main() {
  let context = "The release flow was bypassed.";
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--context" && argv[i + 1]) context = argv[++i];
  }

  const REPO_ROOT = git(["rev-parse", "--show-toplevel"]);
  if (!REPO_ROOT) {
    process.stderr.write("verify-release-verdict: not inside a git repo\n");
    return 1;
  }

  const SHA = git(["-C", REPO_ROOT, "rev-parse", "HEAD^{commit}"]);
  if (!SHA) {
    process.stderr.write("verify-release-verdict: could not resolve HEAD\n");
    return 1;
  }
  const PARENT = git(["-C", REPO_ROOT, "rev-parse", "HEAD~1"]) || "none";

  let PUBKEY = "";
  const pk = spawnSync("git", ["-C", REPO_ROOT, "show", "origin/main:.cw-release/verdict-signing.pub"], {
    encoding: "utf8",
  });
  if (pk.status === 0 && pk.stdout.trim() !== "") {
    PUBKEY = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cw-verdict-pub-")), "verdict-signing.pub");
    fs.writeFileSync(PUBKEY, pk.stdout);
  }

  for (const C of [SHA, PARENT]) {
    if (C === "none") continue;
    const VERDICT_REL = `.cw-release/review-${C}.verdict`;
    const VERDICT = path.join(REPO_ROOT, VERDICT_REL);
    if (!fs.existsSync(VERDICT)) continue;
    // The first line must say EXACTLY "APPROVED <this candidate's sha>". A
    // starts-with check is not enough: the signature binds the BYTES, never
    // the file NAME, so a real signed verdict for some other sha could be
    // parked under this candidate's filename and still verify.
    const FIRST_LINE = fs.readFileSync(VERDICT, "utf8").split("\n", 1)[0];
    if (FIRST_LINE !== `APPROVED ${C}`) continue;

    if (PUBKEY) {
      const SIG_REL = `${VERDICT_REL}.sig`;
      const SIG = path.join(REPO_ROOT, SIG_REL);
      const sigOk =
        fs.existsSync(SIG) &&
        spawnSync(process.execPath, [VERIFY_SIG, VERDICT, SIG, PUBKEY], { stdio: "inherit" }).status === 0;
      if (sigOk) {
        if (C !== SHA) {
          const bump = spawnSync(process.execPath, [VERIFY_BUMP, C, SHA, VERDICT_REL, SIG_REL], {
            cwd: REPO_ROOT,
            stdio: "inherit",
          });
          if (bump.status !== 0) {
            console.log(
              `verdict for ${C} has a valid signature but HEAD does not reproduce as its deterministic bump — trying the other candidate`
            );
            continue;
          }
        }
        console.log(`verdict found + signature verified for ${C}`);
        return 0;
      }
      console.log(`verdict for ${C} has no valid signature — trying the other candidate`);
      continue;
    }
    console.log(`verdict found for ${C} (no verdict-signing.pub committed yet — signature not required)`);
    return 0;
  }

  console.log(
    `::error::No committed APPROVED verdict for this tag (with a valid signature, if .cw-release/verdict-signing.pub is committed). ${context}`
  );
  console.log(
    "::error::Expected: .cw-release/review-<sha>.verdict with first line 'APPROVED <sha>' — auto-created by release-flow.js --cut"
  );
  return 1;
}

process.exit(main());
