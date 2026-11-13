#!/usr/bin/env node
// release-auto-patch-smoke — the automatic patch release, offline, in
// throwaway git repos:
//
//   1. scripts/release-auto-patch.mjs `plan`: releases on a shipped change;
//      skips tests-only changes, release bookkeeping, an already-released
//      commit, a breaking change since the last tag and CW_AUTO_RELEASE=off;
//      refuses a pending operator minor.
//   2. scripts/release-auto-patch.mjs `bump` makes a commit and tag that
//      scripts/verify-release-verdict.mjs's automatic patch rule
//      (checkAutoPatch) ACCEPTS with no verdict file — the case that fails on
//      the old verifier, which refused every tag without a signed verdict.
//   3. Each refusal of that rule, one check at a time, with its reason named
//      (so removing the check flips the case to an accept or another reason):
//      a minor (Z == 0), a version jump, no tag at HEAD, a parent not on
//      origin/main, older main code under a new number, a tree that is not
//      the reproduced bump (one extra file), CI not green, and a CI API error.
//   4. The CLI with no GITHUB_TOKEN refuses (fail closed, no network).
//
// The GitHub CI query is a parameter of checkAutoPatch, so this file passes
// a stub; the verifier has no env switch for it (a tag's own workflow file
// could set one). The bump reproduction runs for real: a stub
// `bump:version` script in a minimal package, as verdict-signing-workflow-
// smoke.mjs does.
//
// Importing verify-release-verdict.mjs sets process.exitCode = 1 (its fail
// closed default); this file sets it back to 0 when every assert passed.
//
// Portable: node + git + npm + bun only, isolated tmpdirs.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
// npm is a .cmd shim on Windows; spawn-argv starts it with no shell.
import { spawnSync as startProgram } from "../scripts/spawn-argv.mjs";
import { pathToFileURL } from "node:url";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const VERIFIER = path.join(pluginRoot, "scripts", "verify-release-verdict.mjs");
const AUTO = path.join(pluginRoot, "scripts", "release-auto-patch.mjs");
const TAGS = path.join(pluginRoot, "scripts", "release-tags.mjs");
const { checkAutoPatch, ciRunsSayGreen, queryCiSuccess } = await import(pathToFileURL(VERIFIER).href);

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(dir, msg) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", msg]);
  return git(dir, ["rev-parse", "HEAD"]);
}
function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

// A stub bump: sets package.json's version and a tracked VERSION file, the
// way bump-version.mjs moves its surfaces (tracked files only).
const BUMP_STUB = `import fs from "node:fs";
const v = process.argv[2];
const p = new URL("./package.json", import.meta.url);
fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/"version": "[^"]*"/, \`"version": "\${v}"\`));
fs.writeFileSync(new URL("./VERSION", import.meta.url), \`\${v}\\n\`);
`;

/** main: A (1.2.2) -> P (a src change). v1.2.2 is a leaf tag on A (the
 *  shape of a real cut: a one-hop child of a main commit). origin/main = P.
 *  HEAD is left at P. Options move the pieces for the refusal cases. */
function fixture({ pkgAtP = "1.2.2", subject = "fix(core): a shipped fix", file = "plugins/cool-workflow/src/x.ts" } = {}) {
  const dir = tmpDir("cw-auto-patch-");
  git(dir, ["init", "-q", "-b", "main"]);
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"], ["tag.gpgSign", "false"]]) git(dir, ["config", k, v]);
  const pkg = { name: "fixture", version: "1.2.2", private: true, scripts: { "bump:version": "node bump.mjs" } };
  write(dir, "plugins/cool-workflow/package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  write(dir, "plugins/cool-workflow/VERSION", "1.2.2\n");
  write(dir, "plugins/cool-workflow/bump.mjs", BUMP_STUB);
  write(dir, "plugins/cool-workflow/src/x.ts", "export const x = 1;\n");
  // release-auto-patch.mjs runs `npm run bump:version` in the plugin folder
  // next to its own scripts/ folder, so the fixture carries its own copy.
  write(dir, "plugins/cool-workflow/scripts/release-auto-patch.mjs", fs.readFileSync(AUTO, "utf8"));
  write(dir, "plugins/cool-workflow/scripts/release-tags.mjs", fs.readFileSync(TAGS, "utf8"));
  write(dir, "plugins/cool-workflow/scripts/spawn-argv.mjs", fs.readFileSync(path.join(path.dirname(AUTO), "spawn-argv.mjs"), "utf8"));
  const A = commit(dir, "feat: first");
  write(dir, "plugins/cool-workflow/.cw-release-note", "verdict stand-in\n");
  commit(dir, "chore(release): record the v1.2.2 verdict");
  git(dir, ["tag", "-a", "v1.2.2", "-m", "v1.2.2"]);
  git(dir, ["reset", "-q", "--hard", A]);
  write(dir, file, "changed\n");
  if (pkgAtP !== "1.2.2") write(dir, "plugins/cool-workflow/package.json", `${JSON.stringify({ ...pkg, version: pkgAtP }, null, 2)}\n`);
  const P = commit(dir, subject);
  git(dir, ["update-ref", "refs/remotes/origin/main", P]);
  return { dir, A, P };
}

function plan(dir, sha, env = {}) {
  const out = path.join(dir, ".git", "gh-output");
  fs.rmSync(out, { force: true });
  const r = spawnSync(process.execPath, [AUTO, "plan", "--sha", sha], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CW_AUTO_RELEASE: "", GITHUB_OUTPUT: out, ...env }
  });
  const fields = Object.fromEntries(
    (fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "").split("\n").filter(Boolean).map((l) => l.split("="))
  );
  return { code: r.status, text: `${r.stdout}${r.stderr}`, fields };
}

/** Runs the fixture's own release-auto-patch.mjs `bump` at HEAD. */
function bump(dir, version) {
  const sha = git(dir, ["rev-parse", "HEAD"]);
  const r = spawnSync(process.execPath, [path.join(dir, "plugins/cool-workflow/scripts/release-auto-patch.mjs"), "bump", "--sha", sha, "--version", version], {
    cwd: dir,
    encoding: "utf8"
  });
  assert.equal(r.status, 0, `bump ${version} must succeed:\n${r.stdout}${r.stderr}`);
  return git(dir, ["rev-parse", "HEAD"]);
}

const GREEN = async (sha) => ({ ok: true, reason: `stub: CI green at ${sha}` });
const check = (dir, ciCheck = GREEN) => checkAutoPatch({ repoRoot: dir, ciCheck });

// ---- 1. plan -------------------------------------------------------------
{
  const { dir, A, P } = fixture();
  const r = plan(dir, P);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.fields, { release: "true", version: "1.2.3", tag: "v1.2.3" }, `a shipped change plans v1.2.3:\n${r.text}`);

  const off = plan(dir, P, { CW_AUTO_RELEASE: "off" });
  assert.equal(off.code, 0, off.text);
  assert.equal(off.fields.release, "false", "CW_AUTO_RELEASE=off is the kill switch");
  assert.match(off.text, /CW_AUTO_RELEASE=off/);

  const old = plan(dir, A);
  assert.equal(old.code, 0, old.text);
  assert.equal(old.fields.release, "false", "a commit already in the last tag does not release again");
  assert.match(old.text, /already in v1\.2\.2/);
}
{
  const { dir, P } = fixture({ file: "plugins/cool-workflow/test/only-a-smoke.mjs" });
  const r = plan(dir, P);
  assert.equal(r.code, 0, r.text);
  assert.equal(r.fields.release, "false", "a tests-only change does not release");
  assert.match(r.text, /nothing shipped changed/);
}
{
  const { dir, P } = fixture({ subject: "chore(release): bump version to 1.3.0" });
  const r = plan(dir, P);
  assert.equal(r.fields.release, "false", "release bookkeeping does not release");
  assert.match(r.text, /release bookkeeping/);
}
// Conventional Commits pick the level. A breaking change ("type!:" or a
// "BREAKING CHANGE:" footer) or a "feat" anywhere since the last tag is not a
// patch: the automatic patches stop until the operator cuts the next minor
// (on 0.x and 1.x alike for a feat; here the fixture is 1.x, so a breaking
// change names 2.0.0).
{
  const { dir, P } = fixture({ subject: "feat(check): a new flag" });
  const r = plan(dir, P);
  assert.equal(r.fields.release, "false", `a feat is a minor, not a patch:\n${r.text}`);
  assert.match(r.text, /new feature/);
  assert.match(r.text, /npm run release -- 1\.3\.0/);
}
for (const subject of ["feat(cli)!: drop the old verbs", "fix!: refuse old runs", "chore(cleanup): cut src\n\nBREAKING CHANGE: runs made by an older cw are refused"]) {
  const { dir, P } = fixture({ subject });
  const r = plan(dir, P);
  assert.equal(r.code, 0, r.text);
  assert.equal(r.fields.release, "false", `a breaking change is not a patch: ${JSON.stringify(subject)}\n${r.text}`);
  assert.match(r.text, /breaking change/);
  assert.match(r.text, /npm run release -- 2\.0\.0/, "names the operator's next cut (a major on 1.x)");
}
{
  // ...and it keeps blocking: a later plain fix on top still does not release.
  const { dir } = fixture({ subject: "refactor!: a breaking change" });
  write(dir, "plugins/cool-workflow/src/x.ts", "later\n");
  const Q = commit(dir, "fix(core): a later fix");
  git(dir, ["update-ref", "refs/remotes/origin/main", Q]);
  const r = plan(dir, Q);
  assert.equal(r.fields.release, "false", `a breaking change earlier in the range still blocks:\n${r.text}`);
  assert.match(r.text, /breaking change/);
}
{
  // Words like "breaking" in prose are not the marker.
  const { dir, P } = fixture({ subject: "fix(core): stop breaking the parser\n\nNot a BREAKING change." });
  const r = plan(dir, P);
  assert.equal(r.fields.release, "true", `prose is not a marker:\n${r.text}`);
}
{
  const { dir, P } = fixture({ pkgAtP: "1.3.0" });
  const r = plan(dir, P);
  assert.equal(r.code, 1, `a pending operator minor must fail the job:\n${r.text}`);
  assert.match(r.text, /operator release is pending/);
  assert.equal(r.fields.release, undefined, "a refusal plans nothing");
}

// ---- 2. the bump the job makes is accepted with no verdict ---------------
{
  const { dir, P } = fixture();
  const T = bump(dir, "1.2.3");
  assert.equal(git(dir, ["rev-parse", "HEAD~1"]), P, "the bump commit is a one-hop child of the released commit");
  assert.equal(git(dir, ["rev-parse", "v1.2.3^{commit}"]), T, "an annotated v1.2.3 tag points at the bump commit");
  assert.equal(git(dir, ["rev-parse", "main"]), P, "main is never moved");
  let asked = "";
  const r = await check(dir, async (sha) => ((asked = sha), { ok: true, reason: "stub green" }));
  assert.equal(r.ok, true, `the automatic patch must be accepted: ${r.reason}`);
  assert.equal(asked, P, "the CI question is asked about the parent, the commit CI judged");

  // 4. The CLI fails closed with no token: it never reaches the network.
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  const cli = spawnSync(process.execPath, [VERIFIER], { cwd: dir, encoding: "utf8", env });
  assert.equal(cli.status, 1, `with no GITHUB_TOKEN the CLI must refuse:\n${cli.stdout}${cli.stderr}`);
  assert.match(cli.stdout, /not an automatic patch release: no GITHUB_TOKEN/);
  assert.match(cli.stdout, /::error::No committed APPROVED verdict/);
}

// ---- 3. each refusal -----------------------------------------------------
async function refused(dir, re, label, ciCheck) {
  const r = await check(dir, ciCheck);
  assert.equal(r.ok, false, `${label} must be refused`);
  assert.match(r.reason, re, `${label}: wrong reason: ${r.reason}`);
}
{
  // A minor needs the signed verdict, even when it is otherwise the exact bump.
  const { dir } = fixture();
  const r = startProgram("npm", ["run", "bump:version", "--", "1.3.0"], { cwd: path.join(dir, "plugins/cool-workflow"), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  commit(dir, "chore(release): v1.3.0");
  git(dir, ["tag", "-a", "v1.3.0", "-m", "v1.3.0"]);
  await refused(dir, /minor or major release: it needs the signed verdict/, "a minor (Z == 0) with no verdict");
}
{
  const { dir } = fixture();
  bump(dir, "1.2.4");
  await refused(dir, /not the next patch after v1\.2\.2/, "a version jump (1.2.2 -> 1.2.4)");
}
{
  const { dir } = fixture();
  bump(dir, "1.2.3");
  git(dir, ["tag", "-d", "v1.2.3"]);
  await refused(dir, /no v1\.2\.3 tag points at HEAD/, "a bump commit with no tag");
}
{
  const { dir, A } = fixture();
  bump(dir, "1.2.3");
  git(dir, ["update-ref", "refs/remotes/origin/main", A]);
  await refused(dir, /is not on origin\/main/, "a parent that is not on origin/main");
}
{
  // Older main code under a new number: v1.2.2 was cut from P, and a new
  // v1.2.3 is a bump of A, which is older than P.
  const { dir, A, P } = fixture();
  git(dir, ["tag", "-d", "v1.2.2"]);
  git(dir, ["checkout", "-q", "--detach", P]);
  write(dir, "plugins/cool-workflow/.cw-release-note", "verdict stand-in\n");
  commit(dir, "chore(release): record the v1.2.2 verdict");
  git(dir, ["tag", "-a", "v1.2.2", "-m", "v1.2.2"]);
  git(dir, ["checkout", "-q", "--detach", A]);
  bump(dir, "1.2.3");
  await refused(dir, /not newer than v1\.2\.2's parent/, "older main code shipped under a new number");
}
{
  // The tag commit carries one file the bump does not make.
  const { dir } = fixture();
  bump(dir, "1.2.3");
  write(dir, "plugins/cool-workflow/src/backdoor.ts", "export const evil = 1;\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--amend", "--no-edit"]);
  git(dir, ["tag", "-f", "-a", "v1.2.3", "-m", "v1.2.3"]);
  await refused(dir, /not the deterministic bump/, "a tree with one extra file");
}
{
  const { dir, P } = fixture();
  bump(dir, "1.2.3");
  const run = { head_sha: P, event: "push", head_branch: "main", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success" };
  // The pure reader: only a completed, successful ci.yml run for a push to
  // main at that exact sha counts.
  assert.equal(ciRunsSayGreen({ workflow_runs: [run] }, P).ok, true);
  for (const [k, v] of [["conclusion", "failure"], ["status", "in_progress"], ["head_branch", "feature"], ["event", "pull_request"], ["path", ".github/workflows/other.yml"], ["head_sha", "0".repeat(40)]]) {
    assert.equal(ciRunsSayGreen({ workflow_runs: [{ ...run, [k]: v }] }, P).ok, false, `a run with ${k}=${v} is not green`);
  }
  assert.equal(ciRunsSayGreen({ message: "Not Found" }, P).ok, false, "an answer with no workflow_runs is not green");
  await refused(dir, /no successful \.github\/workflows\/ci\.yml run/, "CI not green on the parent", async (sha) =>
    ciRunsSayGreen({ workflow_runs: [{ ...run, head_sha: sha, conclusion: "failure" }] }, sha)
  );
  await refused(dir, /the CI check failed: HTTP 502/, "a CI API error", async () => {
    throw new Error("HTTP 502");
  });
  // The real query fails closed before any request when it has no token or
  // no repository name.
  assert.match((await queryCiSuccess(P, { env: { GITHUB_REPOSITORY: "o/r" } })).reason, /no GITHUB_TOKEN/);
  assert.match((await queryCiSuccess(P, { env: { GITHUB_TOKEN: "x" } })).reason, /GITHUB_REPOSITORY is not set/);
}

process.exitCode = 0;
console.log("release-auto-patch-smoke: ok (plan: release/skip/refuse; bump accepted with no verdict; 8 refusals; CLI fails closed with no token)");
