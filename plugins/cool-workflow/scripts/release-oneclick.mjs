#!/usr/bin/env node

// release-oneclick.mjs — the operator's ONE command for a full release.
//
//   npm run release -- X.Y.Z
//   node scripts/release-oneclick.mjs X.Y.Z [--dry-run] [--local-tests]
//
// This is a pure orchestrator over EXISTING tools (release-flow.mjs,
// bump-version.mjs, sync-project-index.mjs, gh, git) — it adds no new release
// logic of its own, only sequencing, resumability, and fail-fast checks.
//
// The two-step release model this implements:
//   1. Ask the agent to "prepare release X.Y.Z" — it opens/merges the
//      version-bump PR. This step never touches
//      CW_RELEASE_VERDICT_PRIVKEY.
//   2. The OPERATOR runs this script, in a shell where
//      CW_RELEASE_VERDICT_PRIVKEY is set. Nothing in this file reads that
//      env var directly — it is forwarded to `release-flow.mjs`'s existing
//      signVerdictIfConfigured(), unchanged.
//
// Stages (each is idempotent — probes current state before acting, so a
// re-run after a failure resumes rather than repeats):
//   0. preflight   — the release:doctor checks (release-preflight.mjs: HEAD is
//                    the origin/main tip, clean tree, reviewer binary exists,
//                    signing key file, git identity, gh auth, no vX.Y.Z tag;
//                    every problem reported at once), then release-flow.mjs
//                    --cut --preflight-only (fail in seconds, before the
//                    gate/vendor-preflight/reviewer spend anything)
//   1. bump PR     — only if package.json is not already at the target
//                    version; skipped when the agent's prep PR already landed
//   2. cut         — first wait (deadline 45 min) for the required CI checks
//                    on the cut commit (scripts/release-ci-checks.mjs); a red
//                    check stops the release. Then release-flow.mjs --cut
//                    --version X --push (gate, whose test step takes those
//                    green checks in place of a local suite run; live vendor
//                    preflight, reviewer, sign, tag-only push, Release).
//                    --local-tests (or CW_RELEASE_LOCAL_TESTS=1) skips the
//                    wait and runs the full suite locally, as before.
//   3. record+wait — PR landing the verdict+.sig onto main (informational,
//                    no gate implications) + poll release/npm-publish +
//                    confirm `npm view` shows the new version
//
// Resume: when the vX.Y.Z tag already exists (local or on origin), the cut
// already happened — stages 0-2 are skipped and the run goes STRAIGHT to
// stage 3. This is what makes a re-run after a stage-3 death (a red CI run,
// a network drop, a Ctrl-C mid-wait) pick the release back up instead of
// being refused by the preflight's own already-tagged check. Every wait has
// a hard deadline and dies loudly after repeated gh/git failures — a hung
// wait is indistinguishable from a dead release otherwise.
//
// Leftover cut branch: a cut that stops before its tag is made (a rejected
// review, a red check, a failed gate) switches back to the branch the run
// started on and removes the release/vX.Y.Z-cut branch it made; a fresh cut
// first removes one an earlier stopped cut left. Both only when
// classifyCutBranch() (release-preflight.mjs) proves the tool made it and
// no vX.Y.Z tag exists; one stderr line says what was removed (or kept) and
// why. A cut whose tag was made keeps its branch.
//
// Test seam: CW_ONECLICK_GH_CMD / CW_ONECLICK_GIT_CMD override the gh/git
// binaries (single executable token, spawned shell:false) for smoke stubs;
// CW_ONECLICK_REPO_ROOT points the stage-3 verdict copy at a temp folder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runChecks, formatFindings, createContext, classifyCutBranch, removeCutBranch } from "./release-preflight.mjs";
import { queryRequiredChecks, REQUIRED_CHECKS } from "./release-ci-checks.mjs";

const scriptsDir = import.meta.dirname;
const pluginRoot = path.resolve(scriptsDir, "..");
const repoRoot = process.env.CW_ONECLICK_REPO_ROOT ? path.resolve(process.env.CW_ONECLICK_REPO_ROOT) : path.resolve(pluginRoot, "..", "..");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const LOCAL_TESTS = argv.includes("--local-tests") || process.env.CW_RELEASE_LOCAL_TESTS === "1";
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));

const GIT_BIN = (process.env.CW_ONECLICK_GIT_CMD || "git").trim();
const GH_BIN = (process.env.CW_ONECLICK_GH_CMD || "gh").trim();

// Set by the cut stage once it has made release/vX.Y.Z-cut, cleared once the
// cut is done: every die() in between (a red CI check, a wait deadline, a
// failed or rejected release-flow run) then removes the branch it made, when
// that is safe (cleanupCutBranchAfterStop).
let onCutStop = null;

function die(msg, extra) {
  process.stderr.write(`release-oneclick: ${msg}\n`);
  if (extra) process.stderr.write(`${extra}\n`);
  if (onCutStop) {
    const cleanup = onCutStop;
    onCutStop = null;
    cleanup();
  }
  process.exit(1);
}
function say(msg) {
  process.stdout.write(`${msg}\n`);
}
function stage(n, label) {
  say(`\n[${n}/4] ${label}`);
}
function git(args, opts = {}) {
  const r = spawnSync(GIT_BIN, args, { cwd: repoRoot, encoding: "utf8", shell: false, ...opts });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
// Like git(), but stdout is returned VERBATIM — no trim. The record stage
// copies verdict/.sig bytes out of the tag commit, and those bytes must stay
// exactly what was signed (a trimmed copy next to the same .sig could never
// verify again).
function gitRaw(args, opts = {}) {
  const r = spawnSync(GIT_BIN, args, { cwd: repoRoot, encoding: "buffer", shell: false, ...opts });
  return { code: r.status, out: r.stdout || Buffer.alloc(0), err: (r.stderr || "").toString().trim() };
}
function gh(args, opts = {}) {
  const r = spawnSync(GH_BIN, args, { cwd: repoRoot, encoding: "utf8", shell: false, ...opts });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
// Shared poll helper: every wait in this script has a hard deadline (a wait
// that can spin forever hides a dead release) and dies after too many gh/git
// failures in a row (an expired auth or dead network must surface, not hang).
function poll({ label, timeoutMs, intervalMs, probe }) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  for (;;) {
    const r = probe();
    if (r && r.done) return r.value;
    consecutiveErrors = r && r.error ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= 10) die(`${label}: 10 gh/git probes in a row failed — check network/auth and re-run to resume.`);
    if (Date.now() > deadline) die(`${label}: still not done after ${Math.round(timeoutMs / 60000)} minutes — inspect manually, then re-run to resume.`);
    sleep(intervalMs);
  }
}

if (!version) {
  die("usage: node scripts/release-oneclick.mjs X.Y.Z [--dry-run] [--local-tests]");
}

// ---- resume detection (before anything else) --------------------------------
// After a successful cut, the vX.Y.Z tag exists — release-flow's preflight
// would then (correctly, for a FRESH cut) refuse to run. But a re-run of THIS
// script after a stage-3 failure (a red CI run, a network drop, a Ctrl-C
// during the wait) must not be told "pick the next version": the release is
// mid-flight, not done. So: tag already cut -> skip straight to stage 3.
function alreadyCut() {
  if (git(["tag", "-l", `v${version}`]).out) return true;
  if (DRY_RUN) return false; // offline decision only in dry-run
  const remote = git(["ls-remote", "origin", `refs/tags/v${version}`]);
  return remote.code === 0 && Boolean(remote.out);
}

// A cut tags the verdict commit LOCALLY and only then pushes the tag. If that
// push dies (a network drop, an auth expiry) the tag is left local-only:
// alreadyCut() still sees it and resumes at stage 3, but stage 3 would then
// wait 45 minutes for a release run CI never started, because the tag
// never reached origin. So on resume, before the CI wait, make sure the tag is
// actually on origin — re-push it (the same tag-only refspec cut() uses) when
// it is only local. This keeps the tag-only-push contract: no branch is pushed,
// and the tag commit's first parent is untouched (it is exactly what was cut).
function ensureTagPushedOnResume() {
  const remote = git(["ls-remote", "origin", `refs/tags/v${version}`]);
  if (remote.code !== 0) {
    die("could not reach origin to check the tag — fix network/auth and re-run to resume.", remote.err);
  }
  if (remote.out) return; // already on origin — nothing to do
  verifyLocalTagVerdict();
  say(`tag v${version} is local-only (the cut's tag push must have failed) — re-pushing refs/tags/v${version}.`);
  const push = git(["push", "origin", `refs/tags/v${version}`]);
  if (push.code !== 0) {
    die("re-push of the local-only tag failed (nothing else was done) — fix the issue and re-run to resume.", push.err);
  }
  say(`re-pushed refs/tags/v${version} to origin.`);
}

// A local-only vX.Y.Z tag is not proof of a cut: any local `git tag` (a hand
// tag, a stale tag from a failed run) looks the same to alreadyCut(). So
// before the resume pushes one, it must carry what cut() puts there: at the
// tag commit, .cw-release/review-<tag~1>.verdict whose first line is EXACTLY
// "APPROVED <tag~1>", plus a .sig that verify-verdict-signature.mjs (the same
// check CI and the tag hook use) accepts against the public key as committed
// on origin/main (never the tag's own copy). Anything less: refuse, push
// nothing (fail closed). CI still runs the full check (bump reproduction
// too) on the pushed tag; this only keeps the resume from pushing a tag CI
// is sure to refuse — or one that never went through the gate at all.
function verifyLocalTagVerdict() {
  const tag = `v${version}`;
  const refuse = (why, extra) =>
    die(`local-only tag ${tag} ${why} — refusing to push it (it does not look like a gated cut). Inspect it, delete it if it is not yours, and re-run.`, extra);
  const parent = git(["rev-parse", "--verify", `${tag}~1^{commit}`]);
  if (parent.code !== 0 || !/^[0-9a-f]{40,64}$/.test(parent.out)) refuse("has no parent commit", parent.err);
  const verdictRel = `.cw-release/review-${parent.out}.verdict`;
  const verdict = gitRaw(["show", `${tag}:${verdictRel}`]);
  if (verdict.code !== 0 || verdict.out.length === 0) refuse(`carries no ${verdictRel}`);
  if (verdict.out.toString("utf8").split("\n", 1)[0] !== `APPROVED ${parent.out}`) {
    refuse(`has a ${verdictRel} whose first line is not "APPROVED ${parent.out}"`);
  }
  const sig = gitRaw(["show", `${tag}:${verdictRel}.sig`]);
  if (sig.code !== 0 || sig.out.length === 0) refuse(`carries no ${verdictRel}.sig`);
  const fetch = git(["fetch", "origin", "main", "--quiet"]);
  if (fetch.code !== 0) die("git fetch origin main failed — the verdict's public key must come from the REAL main tip; fix network/auth and re-run to resume.", fetch.err);
  const pub = gitRaw(["show", "origin/main:.cw-release/verdict-signing.pub"]);
  if (pub.code !== 0 || pub.out.length === 0) refuse("cannot be checked: origin/main has no .cw-release/verdict-signing.pub");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-oneclick-verdict-"));
  let check;
  try {
    const files = { verdict: path.join(tmp, "review.verdict"), sig: path.join(tmp, "review.verdict.sig"), pub: path.join(tmp, "verdict-signing.pub") };
    fs.writeFileSync(files.verdict, verdict.out);
    fs.writeFileSync(files.sig, sig.out);
    fs.writeFileSync(files.pub, pub.out);
    check = spawnSync(process.execPath, [path.join(scriptsDir, "verify-verdict-signature.mjs"), files.verdict, files.sig, files.pub], { encoding: "utf8" });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (check.status !== 0) refuse(`has a ${verdictRel} with no valid signature`, (check.stderr || "").trim());
  say(`local-only tag ${tag}: APPROVED verdict for ${parent.out} found, signature verified.`);
}

// ---- stage 0: preflight -----------------------------------------------------
function runPreflight() {
  stage(0, "preflight");
  // The release:doctor checks (scripts/release-preflight.mjs, the one shared
  // implementation) run FIRST and report every problem at once, on stderr:
  // a stale HEAD, a dirty tree, a missing reviewer binary, an unset signing
  // key, a missing git identity. --dry-run stays offline (no fetch/ls-remote/
  // gh probe), the same rule alreadyCut() follows.
  const doctor = runChecks({ repoRoot, version, offline: DRY_RUN, mode: "cut", gitBin: GIT_BIN, ghBin: GH_BIN });
  process.stderr.write(formatFindings(doctor, { prefix: "release-oneclick", onlyProblems: true }));
  if (!doctor.ok) {
    die(`preflight failed — ${doctor.failures} problem(s) above; fix them before re-running (nothing was done yet). Re-check in seconds with: npm run release:doctor -- ${version}`);
  }
  const args = ["scripts/release-flow.mjs", "--cut", "--version", version, "--push", "--preflight-only"];
  const r = spawnSync("node", args, { cwd: pluginRoot, encoding: "utf8", stdio: "inherit" });
  if (r.status !== 0) {
    die("preflight failed — fix the issue above before re-running (nothing was done yet).");
  }
  if (gh(["--version"]).code !== 0) die("gh CLI not found — required for the bump/verdict PRs and the GitHub Release.");
  if (gh(["auth", "status"]).code !== 0) die("gh is not authenticated — run `gh auth login` first.");
  say("preflight OK");
}

// ---- stage 1: bump PR (skipped if already at target version) ---------------
function currentPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
  return pkg.version;
}

function runBumpStage() {
  stage(1, "version bump");
  if (currentPackageVersion() === version) {
    say(`package.json already at ${version} — assuming the prep PR already landed, skipping.`);
    return;
  }
  if (DRY_RUN) {
    say(`[dry-run] would: branch off origin/main, bump:version -- ${version} --content, sync:project-index, open + auto-merge a bump PR.`);
    return;
  }

  const fetch = git(["fetch", "origin", "main", "--quiet"]);
  if (fetch.code !== 0) die("git fetch origin main failed — the bump branch must start from the REAL main tip", fetch.err);
  const branch = `release/v${version}-bump`;
  const co = git(["checkout", "-B", branch, "origin/main"]);
  if (co.code !== 0) die("could not branch from origin/main for the bump PR", co.err);

  const bump = spawnSync("npm", ["run", "bump:version", "--", version, "--content"], { cwd: pluginRoot, stdio: "inherit" });
  if (bump.status !== 0) die("bump:version --content failed");

  const sync = spawnSync("npm", ["run", "sync:project-index", "--", "--repo-only"], { cwd: pluginRoot, stdio: "inherit" });
  if (sync.status !== 0) die("sync:project-index failed");

  // tsc's incremental cache can ship a stale dist/version.js after a version
  // edit (documented gotcha) — force a clean rebuild before committing.
  fs.rmSync(path.join(pluginRoot, ".cache"), { recursive: true, force: true });
  const build = spawnSync("npm", ["run", "build"], { cwd: pluginRoot, stdio: "inherit" });
  if (build.status !== 0) die("npm run build failed after bump");

  // Tracked files only — NEVER `git add -A` here. Everything the bump stage
  // touches is already tracked (bump surfaces, docs appends, dist), and an
  // untracked stray (a scratch file, a reviewer transcript with the
  // operator's home path) must not ride into a PR onto main — the exact
  // incident cut()'s staging comment documents from v0.1.96.
  git(["add", "-u"], { cwd: repoRoot });
  const commit = git(["commit", "-m", `chore(release): bump version to ${version}`], { cwd: repoRoot });
  if (commit.code !== 0) die("bump commit failed", commit.err);

  // --force-with-lease: a prior run may have pushed this branch and then died
  // before the PR merged; the re-run rebuilds the branch from origin/main with
  // a new sha, and a plain push would be rejected non-fast-forward. The lease
  // keeps this safe: it only replaces the remote branch we saw at fetch time.
  const push = git(["push", "-u", "--force-with-lease", "origin", branch], { cwd: repoRoot });
  if (push.code !== 0) die("bump branch push failed", push.err);

  const pr = gh(["pr", "create", "--base", "main", "--head", branch, "--title", `chore(release): bump version to ${version}`, "--body", "Automated version bump ahead of the gated cut. Generated by release-oneclick.mjs."]);
  if (pr.code !== 0) die("gh pr create failed for the bump PR", pr.err);
  say(pr.out);

  const merge = gh(["pr", "merge", branch, "--auto", "--squash"]);
  if (merge.code !== 0) die("gh pr merge --auto failed for the bump PR", merge.err);

  say("waiting for the bump PR to merge...");
  poll({
    label: "bump PR merge wait",
    timeoutMs: 30 * 60 * 1000,
    intervalMs: 15000,
    probe: () => {
      const view = gh(["pr", "view", branch, "--json", "state"]);
      if (view.code !== 0) return { error: true };
      let state;
      try {
        state = JSON.parse(view.out).state;
      } catch {
        return { error: true };
      }
      if (state === "MERGED") return { done: true };
      if (state === "CLOSED") die("the bump PR was closed without merging");
      return {};
    }
  });
  say("bump PR merged.");
}

// ---- stage 2: cut ------------------------------------------------------------
// The gate's test step reads the required CI checks on the cut commit. A
// bump PR merged a minute ago has its main CI still running, so wait for the
// checks here (with a deadline) rather than let the gate refuse a commit
// that is only not done yet. A red check stops the release at once.
function waitForRequiredChecks(sha) {
  say(`waiting for the required CI checks (${REQUIRED_CHECKS.join(", ")}) on ${sha}...`);
  let last = "";
  poll({
    label: "required CI checks wait",
    timeoutMs: 45 * 60 * 1000,
    intervalMs: 20000,
    probe: () => {
      const ci = queryRequiredChecks({ repoRoot, sha, ghBin: GH_BIN, gitBin: GIT_BIN });
      if (ci.ok) return { done: true };
      if (ci.state === "failure") {
        die(`a required CI check is red on ${sha} — the release stops here (nothing was tagged).`, `${ci.problems.join("\n")}\nfix:  ${ci.fix}`);
      }
      if (ci.state === "error") return { error: true };
      const now = ci.problems.join("; ");
      if (now !== last) say(`  ${ci.state}: ${now}`);
      last = now;
      return {};
    }
  });
  say("required CI checks: all green.");
}

function runCutStage() {
  stage(2, "cut (gate + vendor preflight + reviewer + sign + tag + push)");
  const flowArgs = ["scripts/release-flow.mjs", "--cut", "--version", version, "--push"];
  if (argv.includes("--local-tests")) flowArgs.push("--local-tests");
  if (DRY_RUN) {
    if (!LOCAL_TESTS) say(`[dry-run] would: wait for the required CI checks (${REQUIRED_CHECKS.join(", ")}) on the origin/main tip.`);
    say(`[dry-run] would: node ${flowArgs.join(" ")}`);
    return;
  }
  git(["fetch", "origin", "main", "--quiet"], { cwd: repoRoot });
  // Where the operator ran from (a branch name, or a sha when detached): a
  // cut that stops goes back there before it removes the branch it made.
  const startBranch = git(["branch", "--show-current"], { cwd: repoRoot }).out;
  const startRef = startBranch || git(["rev-parse", "HEAD"], { cwd: repoRoot }).out;
  const co = git(["checkout", "-B", `release/v${version}-cut`, "origin/main"], { cwd: repoRoot });
  if (co.code !== 0) die("could not branch from origin/main for the cut", co.err);
  const base = git(["rev-parse", "HEAD"]).out;
  onCutStop = () => cleanupCutBranchAfterStop({ startBranch, startRef, base });
  if (!LOCAL_TESTS) waitForRequiredChecks(base);

  const r = spawnSync("node", flowArgs, {
    cwd: pluginRoot,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (r.status !== 0) die("cut failed — see the release-flow.mjs output above.");
  onCutStop = null;
  say("cut complete: tag pushed, GitHub Release created.");
}

// ---- leftover cut branch: remove it when the tool made it --------------------
// The rule is classifyCutBranch() in release-preflight.mjs (shared with
// release:doctor): no vX.Y.Z tag (local or on origin), not checked out, and
// no commit on it beyond origin/main but the cut's own verdict commit.
// Anything it cannot prove keeps the branch (fail closed). Only the local
// branch ref is ever deleted — never a tag, a remote branch, or main.
function cutBranchContext() {
  return createContext({ repoRoot, gitBin: GIT_BIN, ghBin: GH_BIN, offline: DRY_RUN });
}

// At the start of a fresh cut (before stage 0): an earlier cut that stopped
// (a Ctrl-C, or a run from before this cleanup existed) may have left the
// branch. Remove it when it passes the test; else leave it to stage 0's
// cut-branch check. --dry-run never deletes.
function sweepLeftoverCutBranch() {
  if (DRY_RUN) return;
  const ctx = cutBranchContext();
  const cls = classifyCutBranch(ctx, version);
  if (!cls.exists || !cls.removable) return;
  const rm = removeCutBranch(ctx, cls);
  if (rm.ok) process.stderr.write(`release-oneclick: removed leftover branch ${cls.branch} (${cls.sha.slice(0, 12)}) from an earlier cut that stopped: ${cls.reason}.\n`);
}

// A cut that stopped before its tag was made: go back to where the operator
// started, then remove the branch this run made, if it passes the test with
// its tip pinned to this run's base (or this run's verdict commit on it).
// One stderr line either way.
function cleanupCutBranchAfterStop({ startBranch, startRef, base }) {
  const ctx = cutBranchContext();
  const branch = `release/v${version}-cut`;
  // One line: git's own stderr, embedded in the reason, may span several.
  const kept = (why) => process.stderr.write(`release-oneclick: kept ${branch}: ${String(why).replace(/\s*\n\s*/g, "; ").trim()} (\`npm run release:doctor -- ${version}\` says what to do with it).\n`);
  if (startBranch === branch) return kept("the cut was started on that branch");
  if (!startRef) return kept("could not tell where the cut was started from");
  const cls = classifyCutBranch(ctx, version, { expectBase: base, allowCurrent: true });
  if (!cls.exists) return;
  if (!cls.removable) return kept(cls.reason);
  if (git(["status", "--porcelain", "-uno"]).out) return kept("tracked files are changed in the working tree");
  if (git(["branch", "--show-current"]).out === branch) {
    const back = git(startBranch ? ["checkout", "-q", startBranch] : ["checkout", "-q", "--detach", startRef]);
    if (back.code !== 0) return kept(`could not switch back to ${startBranch || startRef} (${back.err})`);
  }
  if (git(["branch", "--show-current"]).out === branch) return kept("it is still checked out");
  const rm = removeCutBranch(ctx, cls);
  if (!rm.ok) return kept(`git could not delete it (${rm.err})`);
  process.stderr.write(`release-oneclick: removed ${branch} (${cls.sha.slice(0, 12)}), made by this run: the cut stopped before tag v${version} was made, ${cls.reason}; back on ${startBranch || startRef}.\n`);
}

// ---- stage 3: record on main + wait for CI + confirm npm -------------------
function verdictPaths() {
  const dir = path.join(repoRoot, ".cw-release");
  const tagCommit = git(["rev-parse", `v${version}^{commit}`]).out;
  const reviewedParent = git(["rev-parse", `v${version}~1`]).out;
  // cut() commits the verdict directly on the reviewed parent, so the
  // filename is keyed on THAT sha, not the tag commit's own sha.
  const verdict = path.join(dir, `review-${reviewedParent}.verdict`);
  const sig = `${verdict}.sig`;
  return { tagCommit, reviewedParent, verdict, sig, dir };
}

function runRecordAndWaitStage() {
  stage(3, "record on main + wait for CI + confirm npm");
  if (DRY_RUN) {
    say("[dry-run] would: open a PR landing the verdict+.sig onto main, then poll release/npm-publish/npm view.");
    return;
  }

  const { tagCommit, reviewedParent, verdict, sig } = verdictPaths();
  const relVerdict = path.relative(repoRoot, verdict);
  const relSig = path.relative(repoRoot, sig);
  // Byte-exact copies from the TAG commit — the .sig was made over the
  // verdict file's exact bytes, so a trimmed/normalized copy on main could
  // never verify against the same signature again.
  const verdictBytes = gitRaw(["show", `${tagCommit}:${relVerdict}`], { cwd: repoRoot });
  if (verdictBytes.code === 0) {
    const fetch = git(["fetch", "origin", "main", "--quiet"], { cwd: repoRoot });
    if (fetch.code !== 0) {
      say(`WARN: git fetch failed (${fetch.err}) — skipping the main-record PR (informational only).`);
    } else {
      const branch = `release/v${version}-record`;
      // The branch the operator ran from (main, normally): go back to it when
      // the record PR is out, so the checkout is not left on a branch that is
      // deleted once the PR merges ("no such ref" on the next git pull).
      const startBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot }).out;
      const co = git(["checkout", "-B", branch, "origin/main"], { cwd: repoRoot });
      if (co.code === 0) {
        try {
          fs.mkdirSync(path.dirname(verdict), { recursive: true });
          fs.writeFileSync(verdict, verdictBytes.out);
          const sigBytes = gitRaw(["show", `${tagCommit}:${relSig}`], { cwd: repoRoot });
          if (sigBytes.code === 0) fs.writeFileSync(sig, sigBytes.out);
          git(["add", "--", relVerdict], { cwd: repoRoot });
          if (fs.existsSync(sig)) git(["add", "--", relSig], { cwd: repoRoot });
          const status = git(["status", "--porcelain"], { cwd: repoRoot });
          if (status.out) {
            const commit = git(["commit", "-m", `chore(release): record the v${version} reviewer verdict on main`], { cwd: repoRoot });
            if (commit.code === 0) {
              git(["push", "-u", "--force-with-lease", "origin", branch], { cwd: repoRoot });
              const pr = gh(["pr", "create", "--base", "main", "--head", branch, "--title", `chore(release): record the v${version} reviewer verdict on main`, "--body", `Informational — lands the tagged v${version} verdict + signature onto main for the repo's own audit trail. No gate implications (main's required checks don't include release). Reviewed commit: ${reviewedParent}.`]);
              if (pr.code === 0) {
                say(pr.out);
                gh(["pr", "merge", branch, "--auto", "--squash"]);
              } else {
                say(`WARN: could not open the record PR (${pr.err}) — continuing, this is informational only.`);
              }
            }
          } else {
            say("main already has this verdict recorded — nothing to do.");
          }
        } finally {
          if (startBranch && startBranch !== "HEAD" && startBranch !== branch) {
            const back = git(["checkout", startBranch], { cwd: repoRoot });
            if (back.code === 0) say(`back on ${startBranch}.`);
            else say(`WARN: could not switch back to ${startBranch} (${back.err}) — run \`git checkout ${startBranch}\` yourself.`);
          }
        }
      }
    }
  } else {
    say(`WARN: no verdict at ${relVerdict} in the tag commit — skipping the main-record PR (informational only, not release-blocking).`);
  }

  say(`waiting for release on tag v${version}...`);
  const gate = poll({
    label: "release wait",
    timeoutMs: 45 * 60 * 1000,
    intervalMs: 20000,
    probe: () => {
      const list = gh(["run", "list", "--workflow", "release", "--limit", "10", "--json", "databaseId,headBranch,status,conclusion,updatedAt"]);
      if (list.code !== 0) return { error: true };
      let runs;
      try {
        runs = JSON.parse(list.out);
      } catch {
        return { error: true };
      }
      const gateRun = runs.find((r) => r.headBranch === `v${version}`);
      if (gateRun && gateRun.status === "completed") {
        if (gateRun.conclusion === "success") return { done: true, value: { id: gateRun.databaseId } };
        die(`release FAILED — inspect: gh run view ${gateRun.databaseId} --log-failed`);
      }
      return {};
    }
  });
  say(`release: SUCCESS (run ${gate.id})`);

  // npm-publish runs on the tag push itself (its provenance must name the
  // tag commit), beside release, so its run for THIS tag is the one whose
  // headBranch is the tag name — no time cutoff, which is right on a resume
  // too. It waits in the protected `npm` environment until the operator
  // approves it on GitHub; say so once, with the run's address.
  say("waiting for npm-publish...");
  let askedApproval = false;
  poll({
    label: "npm-publish wait",
    timeoutMs: 60 * 60 * 1000,
    intervalMs: 20000,
    probe: () => {
      const list = gh(["run", "list", "--workflow", "npm-publish", "--limit", "10", "--json", "databaseId,headBranch,status,conclusion,createdAt,url"]);
      if (list.code !== 0) return { error: true };
      let runs;
      try {
        runs = JSON.parse(list.out);
      } catch {
        return { error: true };
      }
      const fresh = runs
        .filter((r) => r.headBranch === `v${version}`)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      if (fresh && fresh.status === "waiting" && !askedApproval) {
        askedApproval = true;
        say(`npm-publish is waiting for your approval (environment "npm"): ${fresh.url || `gh run view ${fresh.databaseId} --web`}`);
      }
      if (fresh && fresh.status === "completed") {
        if (fresh.conclusion === "success") return { done: true };
        die(`npm-publish FAILED (conclusion: ${fresh.conclusion}) — inspect: gh run view ${fresh.databaseId} --log-failed`);
      }
      return {};
    }
  });
  say("npm-publish: SUCCESS");

  say("confirming npm...");
  poll({
    label: "npm registry confirmation",
    timeoutMs: 10 * 60 * 1000,
    intervalMs: 15000,
    probe: () => {
      // --prefer-online: ask the registry each poll, never npm's cached
      // packument, which can still name the old version for many minutes.
      const view = spawnSync("npm", ["view", "cool-workflow", "version", "--prefer-online"], { encoding: "utf8" });
      if (view.status !== 0) return { error: true };
      return view.stdout.trim() === version ? { done: true } : {};
    }
  });
  say(`npm view cool-workflow version -> ${version} — confirmed live.`);
  const releaseUrl = gh(["release", "view", `v${version}`, "--json", "url", "--jq", ".url"]);
  say(`\nRELEASE COMPLETE: v${version}`);
  if (releaseUrl.code === 0) say(`GitHub Release: ${releaseUrl.out}`);
  say(`npm:            https://www.npmjs.com/package/cool-workflow/v/${version}`);
}

if (alreadyCut()) {
  say(`tag v${version} already exists — the cut already happened; resuming at stage 3 (CI wait + record + confirm).`);
  if (DRY_RUN) {
    say("[dry-run] would resume at stage 3: record PR + wait for release/npm-publish + npm view confirmation.");
    say("[dry-run] would first re-push refs/tags/v" + version + " if it is only local (the cut's tag push had failed).");
  } else {
    ensureTagPushedOnResume();
    runRecordAndWaitStage();
  }
} else {
  sweepLeftoverCutBranch();
  runPreflight();
  runBumpStage();
  runCutStage();
  runRecordAndWaitStage();
}
