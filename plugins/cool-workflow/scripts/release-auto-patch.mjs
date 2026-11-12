#!/usr/bin/env node
// release-auto-patch.mjs — the automatic patch release (owner's decision
// 2026-11-12: a merged fix ships as a patch on green main, with no human
// command but the `npm` environment approval; minor and major releases keep
// the operator's signed-verdict cut, release-oneclick.mjs).
//
// Consumer: the `auto-patch` job in .github/workflows/release.yml, run on
// `workflow_run` of the `CI` workflow (a push to main, concluded success).
// It runs on that run's head_sha, never on main's current head.
//
//   node scripts/release-auto-patch.mjs plan --sha <sha>
//     Decides. Writes release=true|false, version=X.Y.Z, tag=vX.Y.Z to
//     $GITHUB_OUTPUT (when set) and says why in one line. Exit 0 for a plan
//     or a skip; exit 1 for a refusal (an operator release is pending, no
//     tags, a bad sha).
//   node scripts/release-auto-patch.mjs bump --sha <sha> --version X.Y.Z
//     Makes the bump commit the way release-flow.mjs's cut() makes its bump
//     (`npm run bump:version -- X.Y.Z`, then `git add -u`, never -A) on top
//     of <sha>, as github-actions[bot], detached (main is protected; the
//     commit lives only on the tag), and an annotated tag vX.Y.Z on it. No
//     verdict file: verify-release-verdict.mjs accepts this commit by its
//     automatic patch rule, which reproduces exactly this bump
//     (verify-bump-reproduction.mjs --no-verdict). Nothing is pushed here.
//
// Skips (exit 0): CW_AUTO_RELEASE=off (the repo variable, the kill switch);
// the head commit's subject starts with "chore(release)"; <sha> is already
// in the newest release tag's history; nothing shipped changed since that
// tag's parent on main (SHIPPED below).
// Refuses (exit 1): package.json at <sha> is ahead of the next patch (an
// operator minor or major is pending: cut it with `npm run release -- X.Y.0`).
//
// The next version is the highest vX.Y.Z tag plus one patch, never main's
// package.json: main lags behind the tags, since bump commits live only on
// tags (release-tooling(7), "Automatic patch releases").

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listReleaseTagsDesc, compareSemver, parseSemverTag } from "./release-tags.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const PKG_REL = "plugins/cool-workflow/package.json";

// What a release ships, as repo-relative path prefixes: the code a user runs
// (npm package or plugin install) and the manifests that describe it. A
// change only to tests, project docs, man pages, CI files or release tooling
// does not release. Test folders inside a shipped path do not count either.
const SHIPPED = [
  "plugins/cool-workflow/src/",
  "plugins/cool-workflow/dist/",
  "plugins/cool-workflow/apps/",
  "plugins/cool-workflow/workflows/",
  "plugins/cool-workflow/skills/",
  "plugins/cool-workflow/agents/",
  "plugins/cool-workflow/commands/",
  "plugins/cool-workflow/hooks/",
  "plugins/cool-workflow/manifest/",
  "plugins/cool-workflow/ui/",
  "plugins/cool-workflow/scripts/agents/",
  "plugins/cool-workflow/scripts/children/",
  "plugins/cool-workflow/scripts/cw.js",
  "plugins/cool-workflow/scripts/mcp-server.js",
  "plugins/cool-workflow/scripts/source-context.js",
  "plugins/cool-workflow/scripts/architecture-review-fast.js",
  "plugins/cool-workflow/package.json",
  "plugins/cool-workflow/server.json",
  "plugins/cool-workflow/tsconfig.json",
  "plugins/cool-workflow/.mcp.json",
  "plugins/cool-workflow/.claude-plugin/",
  "plugins/cool-workflow/.codex-plugin/",
  "plugins/cool-workflow/.gemini-plugin/",
  "plugins/cool-workflow/.opencode-plugin/"
];
const NOT_SHIPPED = /(^|\/)tests?\/|\.test\.[cm]?[jt]sx?$/;

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

function isShipped(file) {
  return SHIPPED.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p)) && !NOT_SHIPPED.test(file);
}

function git(args, opts = {}) {
  const r = spawnSync("git", args, { encoding: "utf8", ...opts });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const gitOut = (args) => {
  const r = git(args);
  return r.code === 0 ? r.out : "";
};

function say(msg) {
  process.stdout.write(`${msg}\n`);
}
function refuse(msg) {
  process.stderr.write(`release-auto-patch: ${msg}\n`);
  process.exit(1);
}
function output(fields) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  fs.appendFileSync(file, Object.entries(fields).map(([k, v]) => `${k}=${v}\n`).join(""));
}
function skip(msg) {
  output({ release: "false" });
  say(`release-auto-patch: no release: ${msg}`);
  process.exit(0);
}

function arg(name) {
  const argv = process.argv.slice(3);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function resolveSha() {
  const given = arg("--sha");
  if (!given || !/^[0-9a-f]{40}$/.test(given)) refuse("--sha <40-hex commit> is required");
  if (gitOut(["rev-parse", "--verify", "--quiet", `${given}^{commit}`]) !== given) refuse(`${given} is not a commit in this clone`);
  return given;
}

function packageVersionAt(sha) {
  try {
    return JSON.parse(gitOut(["show", `${sha}:${PKG_REL}`])).version || "";
  } catch {
    return "";
  }
}

function plan() {
  const sha = resolveSha();
  if (String(process.env.CW_AUTO_RELEASE || "").trim().toLowerCase() === "off") {
    skip("automatic patch releases are off (repo variable CW_AUTO_RELEASE=off)");
  }
  const subject = gitOut(["log", "-1", "--format=%s", sha]);
  if (subject.startsWith("chore(release)")) skip(`the head commit is release bookkeeping ("${subject}")`);

  const tags = listReleaseTagsDesc(gitOut);
  if (tags.length === 0) refuse("no vX.Y.Z release tag in this clone (fetch tags and full history)");
  const last = tags[0];
  const lastCommit = gitOut(["rev-parse", `${last.tag}^{commit}`]);
  if (git(["merge-base", "--is-ancestor", sha, lastCommit]).code === 0) {
    skip(`${sha.slice(0, 12)} is already in ${last.tag}`);
  }
  const base = gitOut(["rev-parse", `${last.tag}^{commit}^`]);
  if (!base) refuse(`cannot resolve the parent of ${last.tag}`);
  const diff = git(["diff", "--name-only", base, sha]);
  if (diff.code !== 0) refuse(`git diff ${base}..${sha} failed: ${diff.err}`);
  const shipped = diff.out.split("\n").filter(Boolean).filter(isShipped);
  if (shipped.length === 0) skip(`nothing shipped changed since ${last.tag} (tests, docs or tooling only)`);

  const next = [last.semver[0], last.semver[1], last.semver[2] + 1];
  const version = next.join(".");
  const pkgVersion = packageVersionAt(sha);
  const pkg = parseSemverTag(`v${pkgVersion}`);
  if (!pkg) refuse(`cannot read the package version at ${sha}`);
  if (compareSemver(pkg, next) > 0) {
    refuse(
      `package.json at ${sha.slice(0, 12)} is ${pkgVersion}, ahead of the next patch ${version} after ${last.tag}: ` +
        `an operator release is pending. Cut it with \`npm run release -- ${pkgVersion}\`; patches start again after it.`
    );
  }
  output({ release: "true", version, tag: `v${version}` });
  say(`release-auto-patch: v${version} from ${sha.slice(0, 12)} (after ${last.tag}; ${shipped.length} shipped file(s) changed, first: ${shipped[0]})`);
}

function bump() {
  const sha = resolveSha();
  const version = arg("--version");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || Number(version.split(".")[2]) === 0) {
    refuse("--version X.Y.Z with Z > 0 is required (a minor or major is the operator's cut)");
  }
  if (gitOut(["rev-parse", "HEAD"]) !== sha) refuse(`HEAD is not ${sha}; check out that commit first`);
  const dirty = git(["status", "--porcelain", "-uno"]);
  if (dirty.code !== 0 || dirty.out) refuse(`tracked files are changed before the bump:\n${dirty.out}`);
  if (gitOut(["tag", "-l", `v${version}`])) refuse(`tag v${version} already exists`);
  // Detach, so the bump commit moves no branch, not even a local one.
  const detach = git(["checkout", "-q", "--detach", sha]);
  if (detach.code !== 0) refuse(`git checkout --detach ${sha} failed: ${detach.err}`);

  // A stale tsc incremental cache keeps dist/core/version.js at the old
  // version (release-tooling(7), "Version surfaces"). The reproduction always
  // builds in a fresh worktree, so build from a clean cache here too.
  fs.rmSync(path.join(pluginRoot, ".cache"), { recursive: true, force: true });
  const b = spawnSync("npm", ["run", "bump:version", "--", version], { cwd: pluginRoot, stdio: "inherit" });
  if (b.status !== 0) refuse("bump:version failed");
  const id = ["-c", `user.name=${BOT_NAME}`, "-c", `user.email=${BOT_EMAIL}`];
  const add = git(["add", "-u"]);
  if (add.code !== 0) refuse(`git add -u failed: ${add.err}`);
  const commit = git([...id, "commit", "--no-verify", "-m", `chore(release): v${version} (automatic patch release of ${sha.slice(0, 12)})`]);
  if (commit.code !== 0) refuse(`the bump commit failed: ${commit.err || commit.out}`);
  const parents = gitOut(["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ").slice(1);
  if (parents.length !== 1 || parents[0] !== sha) refuse("the bump commit is not a one-parent child of the released commit");
  const tag = git([...id, "tag", "-a", `v${version}`, "-m", `v${version}: automatic patch release of ${sha}`]);
  if (tag.code !== 0) refuse(`git tag failed: ${tag.err}`);
  say(`release-auto-patch: tagged v${version} on ${gitOut(["rev-parse", "HEAD"])} (not pushed)`);
}

const cmd = process.argv[2];
if (cmd === "plan") plan();
else if (cmd === "bump") bump();
else refuse("usage: release-auto-patch.mjs plan --sha <sha> | bump --sha <sha> --version X.Y.Z");
