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
//   1. Ask the agent to "prepare release X.Y.Z" — it drafts the CHANGELOG
//      entry and opens/merges the version-bump PR. This step never touches
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
function gh(args, opts = {}) {
  const r = spawnSync(GH_BIN, args, { cwd: repoRoot, encoding: "utf8", shell: false, ...opts });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

if (!version) {
  die("usage: node scripts/release-oneclick.js X.Y.Z [--dry-run]");
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

  git(["fetch", "origin", "main", "--quiet"]);
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

  const logPath = path.join(repoRoot, "ITERATION_LOG.md");
  const log = fs.readFileSync(logPath, "utf8");
  const entry = [
    "# CW Iteration Log",
    "",
    `## Batch — v${version} version bump (Unreleased)`,
    "",
    `> Release prep for v${version}: bump every structured surface with`,
    `> \`bump:version -- ${version} --content\` and fill the gated content`,
    "> surfaces (CHANGELOG.md, RELEASE.md, docs version lists). The bump",
    "> lands as its own PR before the cut so the cut's own bump:version step",
    "> is a no-op. No behavior change; the version constant is the only src",
    "> edit. Generated by release-oneclick.js's bump stage.",
    "",
    "| cycle | goal | files | tests | gate | tagged |",
    "|-------|------|-------|-------|------|--------|",
    `| - | Bump to v${version} across all structured + content surfaces via release-oneclick.js. | ` +
      "package.json + lockfile + manifests + src/core/version.ts + matching dist/**, CHANGELOG.md, RELEASE.md, docs/*.7.md version lists. | " +
      "Full local gate before PR. | BUILD OK; content-surface gate OK. | no (bump PR; the tag comes from release-flow --cut) |"
  ].join("\n");
  fs.writeFileSync(logPath, `${entry}\n\n${log.replace(/^# CW Iteration Log\n\n?/, "")}`);

  git(["add", "-A"], { cwd: repoRoot });
  const commit = git(["commit", "-m", `chore(release): bump version to ${version}`], { cwd: repoRoot });
  if (commit.code !== 0) die("bump commit failed", commit.err);

  const push = git(["push", "-u", "origin", branch], { cwd: repoRoot });
  if (push.code !== 0) die("bump branch push failed", push.err);

  const pr = gh(["pr", "create", "--base", "main", "--head", branch, "--title", `chore(release): bump version to ${version}`, "--body", "Automated version bump ahead of the gated cut. Generated by release-oneclick.js."]);
  if (pr.code !== 0) die("gh pr create failed for the bump PR", pr.err);
  say(pr.out);

  const merge = gh(["pr", "merge", branch, "--auto", "--squash"]);
  if (merge.code !== 0) die("gh pr merge --auto failed for the bump PR", merge.err);

  say("waiting for the bump PR to merge...");
  for (;;) {
    const view = gh(["pr", "view", branch, "--json", "state"]);
    if (view.code === 0) {
      const state = JSON.parse(view.out).state;
      if (state === "MERGED") break;
      if (state === "CLOSED") die("the bump PR was closed without merging");
    }
    sleep(15000);
  }
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
  if (fs.existsSync(verdict)) {
    git(["fetch", "origin", "main", "--quiet"], { cwd: repoRoot });
    const branch = `release/v${version}-record`;
    const co = git(["checkout", "-B", branch, "origin/main"], { cwd: repoRoot });
    if (co.code === 0) {
      const relVerdict = path.relative(repoRoot, verdict);
      const relSig = path.relative(repoRoot, sig);
      fs.mkdirSync(path.dirname(verdict), { recursive: true });
      const verdictBytes = git(["show", `${tagCommit}:${relVerdict}`], { cwd: repoRoot });
      if (verdictBytes.code === 0) fs.writeFileSync(verdict, `${verdictBytes.out}\n`);
      const sigBytes = fs.existsSync(sig) ? null : git(["show", `${tagCommit}:${relSig}`], { cwd: repoRoot });
      if (sigBytes && sigBytes.code === 0) fs.writeFileSync(sig, `${sigBytes.out}\n`);
      git(["add", "--", relVerdict], { cwd: repoRoot });
      if (fs.existsSync(sig)) git(["add", "--", relSig], { cwd: repoRoot });
      const status = git(["status", "--porcelain"], { cwd: repoRoot });
      if (status.out) {
        const commit = git(["commit", "-m", `chore(release): record the v${version} reviewer verdict on main`], { cwd: repoRoot });
        if (commit.code === 0) {
          git(["push", "-u", "origin", branch], { cwd: repoRoot });
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
  } else {
    say(`WARN: no local verdict file at ${verdict} — skipping the main-record PR (informational only, not release-blocking).`);
  }

  say(`waiting for release-gate on tag v${version}...`);
  let gateRunId = null;
  for (;;) {
    const list = gh(["run", "list", "--limit", "10", "--json", "databaseId,workflowName,headBranch,status,conclusion"]);
    if (list.code === 0) {
      const runs = JSON.parse(list.out);
      const gateRun = runs.find((r) => r.headBranch === `v${version}` && r.workflowName === "release-gate");
      if (gateRun) {
        gateRunId = gateRun.databaseId;
        if (gateRun.status === "completed") {
          if (gateRun.conclusion === "success") { say("release-gate: SUCCESS"); break; }
          die(`release-gate FAILED — inspect: gh run view ${gateRun.databaseId} --log-failed`);
        }
      }
    }
    sleep(20000);
  }

  say("waiting for npm-publish...");
  for (;;) {
    const list = gh(["run", "list", "--limit", "10", "--json", "workflowName,status,conclusion,createdAt"]);
    if (list.code === 0) {
      const runs = JSON.parse(list.out).filter((r) => r.workflowName === "npm-publish");
      runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const latest = runs[0];
      if (latest && latest.status === "completed") {
        if (latest.conclusion === "success") { say("npm-publish: SUCCESS"); break; }
        die(`npm-publish FAILED (conclusion: ${latest.conclusion}) — check the Actions tab.`);
      }
    }
    sleep(20000);
  }

  say("confirming npm...");
  for (let i = 0; i < 12; i++) {
    const view = spawnSync("npm", ["view", "cool-workflow", "version"], { encoding: "utf8" });
    if (view.status === 0 && view.stdout.trim() === version) {
      say(`npm view cool-workflow version -> ${version} — confirmed live.`);
      const releaseUrl = gh(["release", "view", `v${version}`, "--json", "url", "--jq", ".url"]);
      say(`\nRELEASE COMPLETE: v${version}`);
      if (releaseUrl.code === 0) say(`GitHub Release: ${releaseUrl.out}`);
      say(`npm:            https://www.npmjs.com/package/cool-workflow/v/${version}`);
      return;
    }
    sleep(10000);
  }
  die(`npm still does not report ${version} after waiting — check the npm-publish run manually.`);
}

runPreflight();
runBumpStage();
runCutStage();
runRecordAndWaitStage();
