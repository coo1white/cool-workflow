#!/usr/bin/env node
// verify-release-verdict.mjs — the one true "find a signed, committed release
// verdict for this commit" check. Both CI workflows call it:
//   .github/workflows/release.yml   (cwd = repo root)
//   .github/workflows/npm-publish.yml    (cwd = plugins/cool-workflow)
// In CI they never run the tag's own copy: each workflow first copies this
// file and its helpers out of origin/main into $RUNNER_TEMP and runs them
// from there, with the tag checkout as cwd (the repo being judged).
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
// bump release-flow.mjs's cut() would have made on top of the approved
// parent — it could be an attacker's own commit smuggling in changes on top
// of an old, truly-approved parent, replaying that parent's already-public
// verdict + signature (public git objects; no secret is needed to copy
// them). So when the match is at HEAD~1, HEAD must ALSO reproduce exactly
// as the deterministic bump (verify-bump-reproduction.mjs).
//
// The pubkey is read from origin/main, NOT from the checked-out tree. The
// checked-out tree IS the commit under test — an attacker's tag could just
// delete .cw-release/verdict-signing.pub and fall back to a no-signature
// check. origin/main is a ref the tag being judged cannot rewrite. Until a
// pubkey is committed there, this stays a first-line-only text check
// (opt-in, backward compatible — see scripts/verdict-keygen.mjs).
//
// cwd does not matter: everything is anchored on
// `git rev-parse --show-toplevel`, and the two helper scripts are loaded
// from this script's own directory (never from the repo under test).
//
// AUTOMATIC PATCH RULE (owner's decision 2026-11-12: patches ship on green
// main; the signing key is kept for minor and major releases). When no
// signed verdict is found, a tag is still accepted with NO verdict only if
// every check in checkAutoPatch() below holds — it is the commit
// release-auto-patch.mjs makes, and nothing else:
//   (a) the version (HEAD's package.json) is X.Y.Z with Z > 0, a v<version>
//       tag points at HEAD, and the highest OTHER tag below it is X.Y.(Z-1);
//   (b) HEAD has exactly one parent, that parent is an ancestor of
//       origin/main, and the parent of that previous tag is an ancestor of
//       it (no re-release of older main code under a new number);
//   (c) HEAD's tree is byte for byte the deterministic bump of that parent
//       (verify-bump-reproduction.mjs --no-verdict);
//   (d) the `CI` workflow (.github/workflows/ci.yml) concluded success on a
//       push to main at that parent — asked of the GitHub API with
//       GITHUB_TOKEN; any API error, or no token, refuses.
// A minor or major (Z == 0) never takes this path: it always needs the
// signed verdict above. The GitHub query is a parameter of checkAutoPatch(),
// so release-auto-patch-smoke.mjs drives it with a stub; there is no env
// switch that could swap it in CI.
//
// Usage: verify-release-verdict.mjs [--context "<one sentence for the fail message>"]
// Exit 0: a valid verdict was found, or the automatic patch rule holds.
// Exit 1: neither — the two "::error::" lines are printed here and nowhere else.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Where THIS SCRIPT lives — the helper scripts are siblings of the installed
// script, never files of the (possibly throwaway) repo being checked. Same
// rule as in verify-bump-reproduction.mjs.
const VERIFY_SIG = path.join(import.meta.dirname, "verify-verdict-signature.mjs");
const VERIFY_BUMP = path.join(import.meta.dirname, "verify-bump-reproduction.mjs");

// The one workflow whose success on main lets a patch ship.
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function gitOk(args) {
  return spawnSync("git", args, { encoding: "utf8" }).status === 0;
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Asks GitHub whether the `CI` workflow concluded success on a push to main
 *  at `sha`. Fails closed: no token, no repo, a non-200 answer, a body that is
 *  not the expected shape, or a network error all give ok:false. */
async function queryCiSuccess(sha, { env = process.env } = {}) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || "";
  const repo = env.GITHUB_REPOSITORY || "";
  if (!token) return { ok: false, reason: "no GITHUB_TOKEN to ask GitHub for the CI result" };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { ok: false, reason: "GITHUB_REPOSITORY is not set to owner/repo" };
  const url = `https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&event=push&branch=main&per_page=100`;
  let body;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cool-workflow-release-verifier"
      },
      signal: AbortSignal.timeout(30000)
    });
    if (res.status !== 200) return { ok: false, reason: `GitHub answered HTTP ${res.status} for the CI runs of ${sha}` };
    body = await res.json();
  } catch (e) {
    return { ok: false, reason: `could not ask GitHub for the CI runs of ${sha}: ${e && e.message ? e.message : e}` };
  }
  return ciRunsSayGreen(body, sha);
}

/** Pure: does a GET /actions/runs answer hold a completed, successful `CI`
 *  (ci.yml) run for a push to main at `sha`? */
function ciRunsSayGreen(body, sha) {
  const runs = body && Array.isArray(body.workflow_runs) ? body.workflow_runs : null;
  if (!runs) return { ok: false, reason: "GitHub's answer has no workflow_runs list" };
  const green = runs.some(
    (r) =>
      r &&
      r.head_sha === sha &&
      r.event === "push" &&
      r.head_branch === "main" &&
      typeof r.path === "string" &&
      r.path.split("@")[0] === CI_WORKFLOW_PATH &&
      r.status === "completed" &&
      r.conclusion === "success"
  );
  return green
    ? { ok: true, reason: `${CI_WORKFLOW_PATH} concluded success on main at ${sha}` }
    : { ok: false, reason: `no successful ${CI_WORKFLOW_PATH} run for a push to main at ${sha}` };
}

/** The automatic patch rule (see the header). `ciCheck(parentSha)` resolves
 *  to { ok, reason }; production passes queryCiSuccess. Cheap local checks
 *  run first, so a refusal never reaches the network. Never throws. */
async function checkAutoPatch({ repoRoot, ciCheck, verifyBump = VERIFY_BUMP }) {
  const g = (args) => git(["-C", repoRoot, ...args]);
  const refuse = (reason) => ({ ok: false, reason });

  const SHA = g(["rev-parse", "HEAD^{commit}"]);
  if (!SHA) return refuse("could not resolve HEAD");
  let version = "";
  try {
    version = JSON.parse(g(["show", "HEAD:plugins/cool-workflow/package.json"])).version || "";
  } catch {
    return refuse("could not read plugins/cool-workflow/package.json at HEAD");
  }
  const v = parseVersion(version);
  if (!v) return refuse(`package version "${version}" is not X.Y.Z`);
  // (a) a patch only; a minor or major always needs the signed verdict.
  if (v[2] === 0) return refuse(`v${version} is a minor or major release: it needs the signed verdict`);
  const headTags = g(["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean);
  if (!headTags.includes(`v${version}`)) return refuse(`no v${version} tag points at HEAD`);
  const lower = g(["tag", "-l", "v*"])
    .split("\n")
    .map((t) => ({ t, s: parseVersion(t.slice(1)) }))
    .filter((x) => x.t.startsWith("v") && x.s && compareVersion(x.s, v) < 0)
    .sort((a, b) => compareVersion(b.s, a.s));
  const prev = lower[0];
  if (!prev) return refuse(`no release tag below v${version}`);
  if (prev.s[0] !== v[0] || prev.s[1] !== v[1] || prev.s[2] !== v[2] - 1) {
    return refuse(`v${version} is not the next patch after ${prev.t}`);
  }
  // (b) one parent, on main, and newer than the previous release's parent.
  const parents = g(["rev-list", "--parents", "-n", "1", SHA]).split(" ").slice(1).filter(Boolean);
  if (parents.length !== 1) return refuse(`the tag commit has ${parents.length} parents, not exactly one`);
  const PARENT = parents[0];
  if (!gitOk(["-C", repoRoot, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"])) {
    return refuse("origin/main is not fetched");
  }
  if (!gitOk(["-C", repoRoot, "merge-base", "--is-ancestor", PARENT, "refs/remotes/origin/main"])) {
    return refuse(`the parent ${PARENT} is not on origin/main`);
  }
  const prevParent = g(["rev-parse", `${prev.t}^{commit}^`]);
  if (!prevParent || !gitOk(["-C", repoRoot, "merge-base", "--is-ancestor", prevParent, PARENT])) {
    return refuse(`the parent ${PARENT} is not newer than ${prev.t}'s parent: older main code cannot ship as v${version}`);
  }
  // (c) the tree is exactly the deterministic bump of the parent.
  const bump = spawnSync(process.execPath, [verifyBump, "--no-verdict", PARENT, SHA], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"]
  });
  if (bump.status !== 0) return refuse(`the tag commit is not the deterministic bump of ${PARENT}`);
  // (d) CI was green on main at the parent.
  let ci;
  try {
    ci = await ciCheck(PARENT);
  } catch (e) {
    ci = { ok: false, reason: `the CI check failed: ${e && e.message ? e.message : e}` };
  }
  if (!ci || ci.ok !== true) return refuse((ci && ci.reason) || "the CI check gave no answer");
  return { ok: true, reason: `automatic patch v${version}: the bump of ${PARENT} (on main, after ${prev.t}); ${ci.reason}` };
}

async function main() {
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

  // No signed verdict: the one other way in is the automatic patch rule.
  const auto = await checkAutoPatch({ repoRoot: REPO_ROOT, ciCheck: (sha) => queryCiSuccess(sha) });
  if (auto.ok) {
    console.log(`no signed verdict needed — ${auto.reason}`);
    return 0;
  }
  console.log(`not an automatic patch release: ${auto.reason}`);

  console.log(
    `::error::No committed APPROVED verdict for this tag (with a valid signature, if .cw-release/verdict-signing.pub is committed). ${context}`
  );
  console.log(
    "::error::Expected: .cw-release/review-<sha>.verdict with first line 'APPROVED <sha>' — auto-created by release-flow.mjs --cut"
  );
  return 1;
}

export { checkAutoPatch, ciRunsSayGreen, queryCiSuccess };

// Run only as a script; release-auto-patch-smoke.mjs imports checkAutoPatch.
// Fail closed: the exit code is 1 until main() itself sets it, so if this
// "am I the script?" test ever misfired in CI, the step would go red, never
// green with no check done. (An importer sets process.exitCode itself.)
process.exitCode = 1;
let isScript = false;
try {
  isScript = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch {
  isScript = false;
}
if (isScript) {
  main().then((code) => process.exit(code), (e) => {
    process.stderr.write(`verify-release-verdict: ${e && e.stack ? e.stack : e}\n`);
    process.exit(1);
  });
}
