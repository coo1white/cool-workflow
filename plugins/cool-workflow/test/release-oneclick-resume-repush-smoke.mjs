#!/usr/bin/env node
// release-oneclick-resume-repush-smoke — pins two resume-path fixes in
// scripts/release-oneclick.mjs (the operator's `npm run release -- X.Y.Z`):
//
//   Finding #1 (P1): a cut can leave the vX.Y.Z tag LOCAL-ONLY — `git tag`
//     succeeds, then the tag push dies (a network drop, an auth expiry).
//     alreadyCut() sees the local tag and resumes at stage 3, but stage 3
//     only waits for a release run that CI never started, because the
//     tag never reached origin. A resume must RE-PUSH a local-only tag before
//     it starts the CI wait.
//
//   Finding #1c: a local-only tag is NOT proof of a cut (a hand `git tag`
//     looks the same). Before the resume pushes one, the tag commit must carry
//     .cw-release/review-<tag~1>.verdict whose first line is "APPROVED
//     <tag~1>", with a .sig that verifies against origin/main's
//     .cw-release/verdict-signing.pub. Anything less is refused, nothing is
//     pushed.
//
//   Finding #14 (P2): the npm-publish wait filtered runs by
//     `Date.now()` captured at resume time. On a resume minutes/days after the
//     gate finished, that cutoff sits in the future relative to the already-
//     completed npm-publish run, so the wait drops a publish that is already
//     done and hangs. The cutoff must come from the gate run's OWN completion
//     time, not resume-time now.
//
// Both are exercised against the REAL release-oneclick.mjs (it always resolves
// its repoRoot from __dirname, so it cannot be pointed at a fixture) with the
// git + gh binaries swapped for tiny node stubs via the script's existing
// CW_ONECLICK_GIT_CMD / CW_ONECLICK_GH_CMD seams. No real git/gh/npm/network is
// touched. Each case reaches a deterministic die() so no poll spins for real.
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";
import { writeProgram } from "./helpers/program.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const ONECLICK = path.join(pluginRoot, "scripts", "release-oneclick.mjs");
assert.ok(fs.existsSync(ONECLICK), "release-oneclick.mjs must exist");

const VERSION = "99.99.99"; // no such tag/CHANGELOG section in the real repo

let caseId = 0;
function tmp() {
  return tmpDir(`cw-oneclick-resume-${caseId++}-`);
}

// A stub `git`: records every argv line to GIT_STUB_REC and answers just the
// handful of commands the resume path issues. The tag exists LOCALLY (tag -l),
// and whether it is on origin is toggled by GIT_STUB_REMOTE_HAS_TAG. `git show`
// answers only for the tag's tree and origin/main (writeTrees below), so the
// local-only tag check has its verdict, .sig and public key; the stage-3
// record's show of the tag sha returns non-zero, so the (informational)
// main-record PR is skipped and the run goes straight to the CI wait.
function writeGitStub(dir) {
  const stub = writeProgram(dir, "git-stub", `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const a = process.argv.slice(2);
if (process.env.GIT_STUB_REC) fs.appendFileSync(process.env.GIT_STUB_REC, a.join(" ") + "\\n");
if (a[0] === "tag" && a[1] === "-l") { process.stdout.write("v${VERSION}\\n"); process.exit(0); }
if (a[0] === "ls-remote") {
  if (process.env.GIT_STUB_REMOTE_HAS_TAG === "1") process.stdout.write("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\\trefs/tags/v${VERSION}\\n");
  process.exit(0);
}
if (a[0] === "push") { process.exit(0); }
if (a[0] === "rev-parse" && a[1] === "--abbrev-ref") { process.stdout.write((process.env.GIT_STUB_BRANCH || "main") + "\\n"); process.exit(0); }
if (a[0] === "rev-parse") { process.stdout.write("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\\n"); process.exit(0); }
if (a[0] === "status" && process.env.GIT_STUB_RECORD === "1") { process.stdout.write(" M .cw-release/x\\n"); process.exit(0); }
if (a[0] === "show") {
  // Answer from on-disk stand-ins for the tag's tree and origin/main's tree;
  // anything else (the stage-3 record's show of <sha>:...) does not exist.
  const m = /^(v${VERSION}|origin\\/main|deadbeef[0-9a-f]{32}):(.+)$/.exec(a[1] || "");
  // The tag sha answers only when GIT_STUB_RECORD=1, so the stage-3 record runs.
  const root = m && (m[1] === "origin/main" ? process.env.GIT_STUB_MAIN_TREE : m[1].startsWith("deadbeef") && process.env.GIT_STUB_RECORD !== "1" ? undefined : process.env.GIT_STUB_TAG_TREE);
  const p = root && require("node:path").join(root, m[2]);
  if (p && fs.existsSync(p)) { process.stdout.write(fs.readFileSync(p)); process.exit(0); }
  process.stderr.write("fatal: path does not exist\\n"); process.exit(1);
}
process.exit(0);
`);
  return stub;
}

// A stub `gh`. GH_STUB_SCENARIO picks the release reply:
//   gate-fail  -> the gate run is completed+failure (fast die at the gate wait)
//   npm-cutoff -> the gate run is completed+success, and npm-publish lists two
//                 runs: THIS tag's (completed+failure, older) and another tag's
//                 (completed+success, newer). The wait must pick the run whose
//                 headBranch is this tag and die with "npm-publish FAILED"; a
//                 wait that takes the newest run by time alone reports the
//                 other tag's success instead.
function writeGhStub(dir) {
  const stub = writeProgram(dir, "gh-stub", `#!/usr/bin/env node
"use strict";
const a = process.argv.slice(2);
const wi = a.indexOf("--workflow");
const wf = wi >= 0 ? a[wi + 1] : "";
const scenario = process.env.GH_STUB_SCENARIO || "gate-fail";
if (a[0] === "run" && a[1] === "list" && wf === "release") {
  const conclusion = scenario === "npm-cutoff" ? "success" : "failure";
  process.stdout.write(JSON.stringify([{ databaseId: 111, headBranch: "v${VERSION}", status: "completed", conclusion, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" }]) + "\\n");
  process.exit(0);
}
if (a[0] === "run" && a[1] === "list" && wf === "npm-publish") {
  process.stdout.write(JSON.stringify([
    { databaseId: 333, headBranch: "v0.0.0-other", status: "completed", conclusion: "success", createdAt: "2020-01-01T00:05:00Z" },
    { databaseId: 222, headBranch: "v${VERSION}", status: "completed", conclusion: "failure", createdAt: "2020-01-01T00:00:30Z" }
  ]) + "\\n");
  process.exit(0);
}
process.exit(0);
`);
  return stub;
}

const SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; // what the stub's rev-parse answers
const KEYS = crypto.generateKeyPairSync("ed25519");
const OTHER_KEYS = crypto.generateKeyPairSync("ed25519");

// Writes the two stand-in trees. verdict: "signed" (good), "none", "badsig"
// (signed by another key), "wrongline" (signed, but approves another sha).
// pubkey: whether origin/main has .cw-release/verdict-signing.pub.
function writeTrees(dir, { verdict = "signed", pubkey = true } = {}) {
  const tagTree = path.join(dir, "tag-tree");
  const mainTree = path.join(dir, "main-tree");
  fs.mkdirSync(path.join(tagTree, ".cw-release"), { recursive: true });
  fs.mkdirSync(path.join(mainTree, ".cw-release"), { recursive: true });
  if (verdict !== "none") {
    const body = Buffer.from(verdict === "wrongline" ? `APPROVED ${"0".repeat(40)}\ncap.\n` : `APPROVED ${SHA}\ncap.\n`);
    const key = verdict === "badsig" ? OTHER_KEYS.privateKey : KEYS.privateKey;
    const v = path.join(tagTree, ".cw-release", `review-${SHA}.verdict`);
    fs.writeFileSync(v, body);
    fs.writeFileSync(`${v}.sig`, `${crypto.sign(null, body, key).toString("base64")}\n`);
  }
  if (pubkey) {
    fs.writeFileSync(path.join(mainTree, ".cw-release", "verdict-signing.pub"), KEYS.publicKey.export({ type: "spki", format: "pem" }));
  }
  return { GIT_STUB_TAG_TREE: tagTree, GIT_STUB_MAIN_TREE: mainTree };
}

function run(dir, env, timeoutMs, trees) {
  const gitStub = writeGitStub(dir);
  const ghStub = writeGhStub(dir);
  const rec = path.join(dir, "git-rec.txt");
  const r = spawnSync(process.execPath, [ONECLICK, VERSION], {
    cwd: pluginRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      CW_ONECLICK_GIT_CMD: gitStub,
      CW_ONECLICK_GH_CMD: ghStub,
      GIT_STUB_REC: rec,
      ...writeTrees(dir, trees),
      ...env
    }
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", signal: r.signal, rec: fs.existsSync(rec) ? fs.readFileSync(rec, "utf8") : "" };
}

// ---- Finding #1a: a LOCAL-ONLY tag is re-pushed on resume -------------------
{
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "gate-fail" }, 20000);
  // Reached the resume + CI wait (both fixed and unfixed die at the failing gate).
  assert.match(r.out, /already exists — the cut already happened; resuming at stage 3/, "must announce the resume");
  assert.match(r.err, /release FAILED/, "the run must reach the release wait");
  // The load-bearing assertion: a local-only tag must be pushed to origin
  // BEFORE the CI wait. Absent in the unfixed code (fail-first).
  assert.match(r.rec, /(^|\n)push origin refs\/tags\/v99\.99\.99(\n|$)/,
    "a local-only tag must be re-pushed to origin on resume");
}

// ---- Finding #1b: a tag already on origin is NOT re-pushed -------------------
// Guards against a naive "always push" fix — the re-push must be conditional on
// the tag being absent from origin.
{
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "gate-fail", GIT_STUB_REMOTE_HAS_TAG: "1" }, 20000);
  assert.match(r.err, /release FAILED/, "the run must reach the release wait");
  assert.doesNotMatch(r.rec, /push origin refs\/tags\//,
    "a tag already on origin must not be re-pushed");
}

// ---- Finding #1c: an unverified local-only tag is refused, never pushed ------
// Each of these pushed the tag on the old code (no check before the push).
for (const [label, trees, why] of [
  ["no verdict in the tag", { verdict: "none" }, /carries no \.cw-release\/review-deadbeef[0-9a-f]*\.verdict/],
  ["verdict signed by another key", { verdict: "badsig" }, /with no valid signature/],
  ["verdict approving another sha", { verdict: "wrongline" }, /first line is not "APPROVED deadbeef/],
  ["no public key on origin/main", { pubkey: false }, /origin\/main has no \.cw-release\/verdict-signing\.pub/]
]) {
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "gate-fail" }, 20000, trees);
  assert.notEqual(r.code, 0, `(${label}) the resume must fail closed`);
  assert.match(r.err, /refusing to push it/, `(${label}) must say it refuses to push`);
  assert.match(r.err, why, `(${label}) must say why`);
  assert.doesNotMatch(r.rec, /(^|\n)push /, `(${label}) an unverified local-only tag must never be pushed`);
  assert.doesNotMatch(r.err, /release FAILED/, `(${label}) must stop before the CI wait`);
}
// ...and the good case says it checked (Finding #1a above already proves the push).
{
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "gate-fail" }, 20000);
  assert.match(r.out, /APPROVED verdict for deadbeef[0-9a-f]* found, signature verified/, "a verified local-only tag must say it was checked");
  assert.match(r.rec, /(^|\n)show origin\/main:\.cw-release\/verdict-signing\.pub(\n|$)/, "the public key must come from origin/main");
}

// ---- The npm-publish wait takes THIS tag's run, by headBranch ---------------
// npm-publish runs on the tag push (its provenance names the tag commit), so
// its run for this release is the one whose headBranch is the tag. Here the
// newest npm-publish run is another tag's success; this tag's run (older, also
// in the past, so a resume sees it) failed. The wait must die loudly on it.
// (Finding #14's resume case holds too: no time cutoff can drop a past run.)
{
  const dir = tmp();
  const r = run(dir, { GH_STUB_SCENARIO: "npm-cutoff", GIT_STUB_REMOTE_HAS_TAG: "1" }, 8000);
  assert.match(r.out, /release: SUCCESS/, "the gate wait must resolve to success first");
  assert.match(r.err, /npm-publish FAILED/,
    "the npm-publish wait must take THIS tag's run (by headBranch), not the newest run of another tag");
}

process.stdout.write("release-oneclick-resume-repush-smoke: ok (local-only tag re-pushed on resume only with a signed APPROVED verdict; on-origin tag left alone; npm-publish wait keyed on this tag's run)\n");

// ---- The record step goes back to the branch it was run from ---------------
// After the stage-3 record PR the checkout was left on release/v<ver>-record,
// a branch deleted once that PR merges, so the operator's next `git pull`
// said "no such ref" and main stayed old. Now it switches back.
{
  const dir = tmp();
  const root = path.join(dir, "repo-root");
  fs.mkdirSync(root);
  const r = run(dir, { GH_STUB_SCENARIO: "gate-fail", GIT_STUB_RECORD: "1", GIT_STUB_BRANCH: "main", CW_ONECLICK_REPO_ROOT: root }, 20000);
  const lines = r.rec.split("\n");
  const toRecord = lines.findIndex((l) => l === "checkout -B release/v99.99.99-record origin/main");
  assert.ok(toRecord >= 0, `the record step ran: ${r.rec}`);
  assert.ok(lines.slice(toRecord + 1).includes("checkout main"), `and then went back to main: ${r.rec}`);
  assert.match(r.out, /back on main\./);
  assert.ok(fs.existsSync(path.join(root, ".cw-release", `review-${SHA}.verdict`)), "the verdict went to the seam root, not the real repo");
}

