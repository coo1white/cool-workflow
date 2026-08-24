#!/usr/bin/env node
"use strict";

// release-oneclick.js — the operator's ONE command for a full release.
//
//   npm run release -- X.Y.Z
//   node scripts/release-oneclick.js X.Y.Z [--dry-run]
//
// This is a pure orchestrator over EXISTING tools (release-flow.js,
// bump-version.js, sync-project-index.js, gh, git) — it adds no new release
// logic of its own, only sequencing, resumability, and fail-fast checks.
//
// The two-step release model this implements:
//   1. Ask the agent to "prepare release X.Y.Z" — it opens/merges the
//      version-bump PR. This step never touches
//      CW_RELEASE_VERDICT_PRIVKEY.
//   2. The OPERATOR runs this script, in a shell where
//      CW_RELEASE_VERDICT_PRIVKEY is set. Nothing in this file reads that
//      env var directly — it is forwarded to `release-flow.js`'s existing
//      signVerdictIfConfigured(), unchanged.
//
// Stages (each is idempotent — probes current state before acting, so a
// re-run after a failure resumes rather than repeats):
//   0. preflight   — release-flow.js --cut --preflight-only (fail in seconds,
//                    before the gate/vendor-preflight/reviewer spend anything)
//   1. bump PR     — only if package.json is not already at the target
//                    version; skipped when the agent's prep PR already landed
//   2. cut         — release-flow.js --cut --version X --push (gate, live
//                    vendor preflight, reviewer, sign, tag-only push, Release)
//   3. record+wait — PR landing the verdict+.sig onto main (informational,
//                    no gate implications) + poll release-gate/npm-publish +
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
// Test seam: CW_ONECLICK_GH_CMD / CW_ONECLICK_GIT_CMD override the gh/git
// binaries (single executable token, spawned shell:false) for smoke stubs.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptsDir = __dirname;
const pluginRoot = path.resolve(scriptsDir, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));

const GIT_BIN = (process.env.CW_ONECLICK_GIT_CMD || "git").trim();
const GH_BIN = (process.env.CW_ONECLICK_GH_CMD || "gh").trim();

function die(msg, extra) {
  process.stderr.write(`release-oneclick: ${msg}\n`);
  if (extra) process.stderr.write(`${extra}\n`);
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
  die("usage: node scripts/release-oneclick.js X.Y.Z [--dry-run]");
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
// wait 45 minutes for a release-gate run CI never started, because the tag
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
  say(`tag v${version} is local-only (the cut's tag push must have failed) — re-pushing refs/tags/v${version}.`);
  const push = git(["push", "origin", `refs/tags/v${version}`]);
  if (push.code !== 0) {
    die("re-push of the local-only tag failed (nothing else was done) — fix the issue and re-run to resume.", push.err);
  }
  say(`re-pushed refs/tags/v${version} to origin.`);
}

// ---- stage 0: preflight -----------------------------------------------------
function runPreflight() {
  stage(0, "preflight");
  const args = ["scripts/release-flow.js", "--cut", "--version", version, "--push", "--preflight-only"];
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

  const pr = gh(["pr", "create", "--base", "main", "--head", branch, "--title", `chore(release): bump version to ${version}`, "--body", "Automated version bump ahead of the gated cut. Generated by release-oneclick.js."]);
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
function runCutStage() {
  stage(2, "cut (gate + vendor preflight + reviewer + sign + tag + push)");
  if (DRY_RUN) {
    say(`[dry-run] would: node scripts/release-flow.js --cut --version ${version} --push`);
    return;
  }
  git(["fetch", "origin", "main", "--quiet"], { cwd: repoRoot });
  const co = git(["checkout", "-B", `release/v${version}-cut`, "origin/main"], { cwd: repoRoot });
  if (co.code !== 0) die("could not branch from origin/main for the cut", co.err);

  const r = spawnSync("node", ["scripts/release-flow.js", "--cut", "--version", version, "--push"], {
    cwd: pluginRoot,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (r.status !== 0) die("cut failed — see the release-flow.js output above.");
  say("cut complete: tag pushed, GitHub Release created.");
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
    say("[dry-run] would: open a PR landing the verdict+.sig onto main, then poll release-gate/npm-publish/npm view.");
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
      const co = git(["checkout", "-B", branch, "origin/main"], { cwd: repoRoot });
      if (co.code === 0) {
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
            const pr = gh(["pr", "create", "--base", "main", "--head", branch, "--title", `chore(release): record the v${version} reviewer verdict on main`, "--body", `Informational — lands the tagged v${version} verdict + signature onto main for the repo's own audit trail. No gate implications (main's required checks don't include release-gate). Reviewed commit: ${reviewedParent}.`]);
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
      }
    }
  } else {
    say(`WARN: no verdict at ${relVerdict} in the tag commit — skipping the main-record PR (informational only, not release-blocking).`);
  }

  say(`waiting for release-gate on tag v${version}...`);
  const gate = poll({
    label: "release-gate wait",
    timeoutMs: 45 * 60 * 1000,
    intervalMs: 20000,
    probe: () => {
      const list = gh(["run", "list", "--workflow", "release-gate", "--limit", "10", "--json", "databaseId,headBranch,status,conclusion,updatedAt"]);
      if (list.code !== 0) return { error: true };
      let runs;
      try {
        runs = JSON.parse(list.out);
      } catch {
        return { error: true };
      }
      const gateRun = runs.find((r) => r.headBranch === `v${version}`);
      if (gateRun && gateRun.status === "completed") {
        // Carry the gate's OWN completion time out of the poll — the npm-publish
        // cutoff below must key off when the gate actually finished, not off the
        // wall clock now (a resume can start long after the gate completed).
        if (gateRun.conclusion === "success") return { done: true, value: { id: gateRun.databaseId, completedMs: Date.parse(gateRun.updatedAt) } };
        die(`release-gate FAILED — inspect: gh run view ${gateRun.databaseId} --log-failed`);
      }
      return {};
    }
  });
  say(`release-gate: SUCCESS (run ${gate.id})`);

  // npm-publish is created only AFTER release-gate completes (workflow_run
  // trigger), so the run to wait for may not exist yet — and the newest
  // completed npm-publish run at this moment is usually the PREVIOUS
  // release's. Only accept a run created at-or-after the moment the gate
  // FINISHED (small clock-skew allowance), and keep waiting until that run
  // exists and completes. The cutoff is the gate run's own completion time,
  // NOT Date.now(): on a resume minutes/days later, a now-based cutoff sits in
  // the future relative to an already-completed npm-publish run and would drop
  // it, hanging the wait for a publish that is already done. Fall back to now
  // only if the gate run reported no parseable completion time.
  say("waiting for npm-publish...");
  const gateDoneMs = Number.isFinite(gate.completedMs) ? gate.completedMs : Date.now();
  poll({
    label: "npm-publish wait",
    timeoutMs: 30 * 60 * 1000,
    intervalMs: 20000,
    probe: () => {
      const list = gh(["run", "list", "--workflow", "npm-publish", "--limit", "5", "--json", "databaseId,status,conclusion,createdAt"]);
      if (list.code !== 0) return { error: true };
      let runs;
      try {
        runs = JSON.parse(list.out);
      } catch {
        return { error: true };
      }
      const fresh = runs
        .filter((r) => Date.parse(r.createdAt) >= gateDoneMs - 120000)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
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
      const view = spawnSync("npm", ["view", "cool-workflow", "version"], { encoding: "utf8" });
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
    say("[dry-run] would resume at stage 3: record PR + wait for release-gate/npm-publish + npm view confirmation.");
    say("[dry-run] would first re-push refs/tags/v" + version + " if it is only local (the cut's tag push had failed).");
  } else {
    ensureTagPushedOnResume();
    runRecordAndWaitStage();
  }
} else {
  runPreflight();
  runBumpStage();
  runCutStage();
  runRecordAndWaitStage();
}
