#!/usr/bin/env node
"use strict";

// block-unapproved-tag-smoke — exercises scripts/block-unapproved-tag.js, the
// PreToolUse hook that blocks `git tag`/tag-push unless both the gate marker
// and an APPROVED reviewer verdict exist for HEAD.
//
// Every assertion would FAIL if the hook's gating were reverted:
//  - feed a tag command with no markers      -> must BLOCK (exit 2)
//  - add only the gate marker                 -> must still BLOCK (no verdict)
//  - add gate marker + APPROVED verdict       -> must ALLOW (exit 0)
//  - feed a non-tag command                   -> must ALLOW (exit 0)
// The valid-JSON cases also prove the stdin JSON parser works (the hook is
// pure node now, so a missing jq can never make it silently fail open).
// Portable: node + git only, isolated tmpdir.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const HOOK = path.resolve(__dirname, "..", "scripts", "block-unapproved-tag.js");
assert.ok(fs.existsSync(HOOK), "block-unapproved-tag.js must exist");
const VERIFY_SCRIPT = path.resolve(__dirname, "..", "scripts", "verify-verdict-signature.js");
assert.ok(fs.existsSync(VERIFY_SCRIPT), "verify-verdict-signature.js must exist");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hook-"));
function git(args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
git(["init", "-q", "-b", "work"]);
git(["config", "user.email", "t@t"]);
git(["config", "user.name", "t"]);
git(["config", "commit.gpgsign", "false"]);
fs.writeFileSync(path.join(dir, "README.md"), "x\n");
// The hook resolves the verify script at $REPO_ROOT/plugins/cool-workflow/scripts/
// verify-verdict-signature.js — mirror that layout in this throwaway fixture so
// the pubkey-committed cases below can actually reach it.
const fixtureScriptsDir = path.join(dir, "plugins", "cool-workflow", "scripts");
fs.mkdirSync(fixtureScriptsDir, { recursive: true });
fs.copyFileSync(VERIFY_SCRIPT, path.join(fixtureScriptsDir, "verify-verdict-signature.js"));
git(["add", "-A"]);
git(["commit", "-q", "-m", "init"]);
const sha = git(["rev-parse", "HEAD"]);

function runHook(toolInput) {
  const input = JSON.stringify({ tool_name: "Bash", tool_input: toolInput });
  const r = spawnSync(process.execPath, [HOOK], { cwd: dir, input, encoding: "utf8" });
  return { code: r.status, err: r.stderr || "" };
}
const markerDir = path.join(dir, ".cw-release");
function setGate() {
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, `gate-${sha}.ok`), "ok\n");
}
function setVerdict(body) {
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, `review-${sha}.verdict`), body);
}
function clearMarkers() {
  fs.rmSync(markerDir, { recursive: true, force: true });
}

// ---- Non-tag command -> ALLOW (proves the node parser reads the command) ----
assert.equal(runHook({ command: "git status" }).code, 0, "non-tag command must be allowed");
assert.equal(runHook({ command: "ls -la" }).code, 0, "unrelated command must be allowed");

// ---- Empty / malformed input -> ALLOW (no command parsed) ----
{
  const r = spawnSync(process.execPath, [HOOK], { cwd: dir, input: "not json", encoding: "utf8" });
  assert.equal(r.status, 0, "malformed input must not block");
  assert.doesNotMatch(r.stderr || "", /WARN/, "a plain non-JSON input (an empty parse, not an internal error) must NOT print the fail-open WARN");
}

// ---- an unexpected internal error -> still ALLOW (fail open, unchanged), but
// says so on stderr instead of staying silent (BUG-4, first half). The old
// bash version's equivalent case was "node itself broken on PATH", which
// cannot happen now that the hook IS the node process — the same failure
// shape (hook internals blew up mid-check) is forced via the
// CW_HOOK_SELFTEST_THROW seam, proving the top-level catch really catches. ----
{
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git tag -a v9.9.9 -m x" } });
  const r = spawnSync(process.execPath, [HOOK], { cwd: dir, input, encoding: "utf8", env: { ...process.env, CW_HOOK_SELFTEST_THROW: "1" } });
  assert.equal(r.status, 0, "an internal hook error must still fail OPEN (exit 0), not block every Bash call");
  assert.match(r.stderr || "", /WARN.*unexpected error/, "an internal hook error must say so on stderr, not stay silent");
}

// ---- Tag command, no markers -> BLOCK (missing gate) ----
{
  clearMarkers();
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 2, "tag with no gate marker must be blocked");
  assert.match(r.err, /no release-gate pass/, "should explain the missing gate");
}

// ---- Tag command, gate only, no verdict -> BLOCK ----
{
  clearMarkers();
  setGate();
  const r = runHook({ command: "git tag v9.9.9" });
  assert.equal(r.code, 2, "tag with gate but no verdict must be blocked");
  assert.match(r.err, /no APPROVED verdict/, "should explain the missing verdict");
}

// ---- Tag command, gate + non-APPROVED verdict -> BLOCK ----
{
  clearMarkers();
  setGate();
  setVerdict("REJECTED\n- gate 2 failed\n");
  const r = runHook({ command: "git tag v9.9.9" });
  assert.equal(r.code, 2, "REJECTED verdict must still block");
}

// ---- Tag command, gate + APPROVED verdict -> ALLOW ----
{
  clearMarkers();
  setGate();
  setVerdict(`APPROVED ${sha}\nUsers can now do X.\n`);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 0, "gate + APPROVED verdict must allow the tag");
}

// ---- BUG-4 regression: a verdict FILE NAMED for the real HEAD sha (so it IS
// the file the hook picks up) whose FIRST LINE approves a DIFFERENT sha ->
// BLOCK. The old `grep -q '^APPROVED'` only checks the line starts with
// "APPROVED" and never looks at which sha follows it, so a real, validly
// signed verdict for one sha, byte-copied onto a filename for another sha,
// would have been accepted. The fix requires the first line to read EXACTLY
// "APPROVED <the matched sha>". ----
{
  clearMarkers();
  setGate();
  const wrongSha = "0123456789abcdef0123456789abcdef01234567";
  setVerdict(`APPROVED ${wrongSha}\nUsers can now do X.\n`);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 2, "a verdict naming a DIFFERENT sha than the one the filename/HEAD matched must block");
  assert.match(r.err, /no APPROVED verdict/, "should explain the missing/mismatched verdict");
}

// ---- Tag push variant is also gated ----
{
  clearMarkers();
  const r = runHook({ command: "git push origin --tags" });
  assert.equal(r.code, 2, "tag push with no markers must be blocked");
}

// ---- Bare tag-name push is also gated (previously a regex gap: the old
// pattern required --tags or refs/tags/ literally in the command, so the
// single most natural form `git push origin v0.2.3` slipped through) ----
{
  clearMarkers();
  const r = runHook({ command: "git push origin v0.2.3" });
  assert.equal(r.code, 2, "a bare tag-shaped ref push with no markers must be blocked");
}
{
  // A normal branch push must stay allowed (no false-positive widening).
  const r = runHook({ command: "git push origin release/v0.2.2-verdict" });
  assert.equal(r.code, 0, "pushing a branch whose name merely contains v<digits> must stay allowed");
}

// ---- --annotate long form and a global flag before the subcommand are also
// gated (previously missed: only `-a` short form and bare `git tag` matched) ----
{
  clearMarkers();
  const r = runHook({ command: "git tag --annotate v9.9.9 -m x" });
  assert.equal(r.code, 2, "--annotate long form with no markers must be blocked");
}
{
  clearMarkers();
  const r = runHook({ command: `git -C ${dir} tag v9.9.9` });
  assert.equal(r.code, 2, "a global flag before the tag subcommand must still be blocked");
}

// ---- Broadened flag/quote coverage (previous regex gap: only -a/--annotate
// were tolerated before the tag name, and a quoted tag name / --mirror push
// slipped through entirely). All of these create/push a v<digit> tag and must
// be blocked without markers. ----
{
  clearMarkers();
  for (const command of [
    "git tag -s v9.9.9",
    "git tag -f v9.9.9",
    'git tag -m "release notes" v9.9.9',
    "git tag -s -m x v9.9.9",
    "git tag 'v9.9.9'",
    'git tag "v9.9.9"',
    "git push origin 'v9.9.9'",
    'git push origin "v9.9.9"',
    "git push --mirror",
  ]) {
    const r = runHook({ command });
    assert.equal(r.code, 2, `must block an unreviewed tag command: ${command}`);
  }
}
// A read-only `git tag -l` / `--list` creates no tag and must stay allowed.
{
  assert.equal(runHook({ command: "git tag -l" }).code, 0, "git tag -l (list) must stay allowed");
  assert.equal(runHook({ command: "git tag --list 'v*'" }).code, 0, "git tag --list must stay allowed");
}

// ---- ReDoS regression: TAG_RE's flag/argument group must not exhibit
// exponential backtracking on a long run of dash-prefixed tokens. A many-`-!`
// command with no real "tag" (CodeQL's exact repro shape) must be judged
// (allowed, since it never actually matches) well within a hard deadline —
// the vulnerable pattern took hundreds of ms at 34 tokens and grows
// exponentially past that; a real command line can be far longer. ----
{
  const evil = { command: "git " + "-! ".repeat(200) + "not-tag" };
  const start = Date.now();
  const r = runHook(evil);
  const elapsedMs = Date.now() - start;
  assert.equal(r.code, 0, "a long dash-token run with no real tag command must be allowed, not misjudged");
  assert.ok(elapsedMs < 2000, `TAG_RE must stay near-linear time, took ${elapsedMs}ms for 200 tokens`);
}

// ---- Verdict signing (opt-in): once .cw-release/verdict-signing.pub is
// committed, an APPROVED verdict with no valid signature must also block ----
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
function setPubkey() {
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, "verdict-signing.pub"), publicPem);
}
function signVerdict(verdictPath, pem) {
  const key = crypto.createPrivateKey(pem);
  const message = fs.readFileSync(verdictPath);
  const signature = crypto.sign(null, message, key).toString("base64");
  fs.writeFileSync(`${verdictPath}.sig`, `${signature}\n`);
}

// Baseline: pubkey NOT committed -> the earlier APPROVED-only case (above)
// already proves this stays exactly grep-only. Now commit the pubkey.

// ---- Pubkey committed + APPROVED verdict + valid signature -> ALLOW ----
{
  clearMarkers();
  setGate();
  setPubkey();
  const verdictPath = path.join(markerDir, `review-${sha}.verdict`);
  fs.writeFileSync(verdictPath, `APPROVED ${sha}\nUsers can now do X.\n`);
  signVerdict(verdictPath, privatePem);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 0, `gate + APPROVED + valid signature must allow the tag: ${r.err}`);
}

// ---- Pubkey committed + APPROVED verdict + NO signature -> BLOCK ----
{
  clearMarkers();
  setGate();
  setPubkey();
  setVerdict(`APPROVED ${sha}\nUsers can now do X.\n`);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 2, "an unsigned verdict must block once verdict-signing.pub is committed");
  assert.match(r.err, /no valid signature/, "should explain the missing/invalid signature");
}

// ---- Pubkey committed + APPROVED verdict + TAMPERED text (stale sig) -> BLOCK ----
{
  clearMarkers();
  setGate();
  setPubkey();
  const verdictPath = path.join(markerDir, `review-${sha}.verdict`);
  fs.writeFileSync(verdictPath, `APPROVED ${sha}\nUsers can now do X.\n`);
  signVerdict(verdictPath, privatePem);
  // Tamper AFTER signing — the .sig no longer matches the bytes on disk.
  fs.writeFileSync(verdictPath, `APPROVED ${sha}\nTAMPERED capability line.\n`);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 2, "a verdict edited after signing must block (stale signature)");
}

// ---- Pubkey committed + APPROVED verdict signed with the WRONG key -> BLOCK ----
{
  clearMarkers();
  setGate();
  setPubkey();
  const wrongKey = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const verdictPath = path.join(markerDir, `review-${sha}.verdict`);
  fs.writeFileSync(verdictPath, `APPROVED ${sha}\nUsers can now do X.\n`);
  signVerdict(verdictPath, wrongKey);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 2, "a signature from a different keypair must block");
}

// ---- HEAD~1 tolerance: markers keyed on the PARENT sha -> ALLOW ------------
// cut() commits the verdict ON TOP of the reviewed commit, so at tag time the
// marker files carry HEAD~1's sha, not HEAD's — the same tolerance
// release-gate.yml has. The pre-fix hook only ever looked at HEAD, so a
// manual retag of a cut-produced commit was always blocked (v0.2.3 recovery).
{
  clearMarkers();
  // A child commit on top of the reviewed one — like cut()'s verdict commit.
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, `gate-${sha}.ok`), "ok\n");
  fs.writeFileSync(path.join(markerDir, `review-${sha}.verdict`), `APPROVED ${sha}\nUsers can now do X.\n`);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "record verdict (parent = reviewed commit)"]);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 0, "markers keyed on HEAD~1 (the reviewed parent) must allow the tag");
  // Reset the fixture back to the reviewed commit so any case added later
  // still sees the original sha at HEAD.
  git(["reset", "-q", "--hard", sha]);
}

// ---- HEAD~1 tolerance is NOT a hole: parent verdict WITHOUT the parent's
// gate marker -> BLOCK. The tolerance keys BOTH markers on the sha whose
// verdict was found; a verdict alone (no gate-<parent>.ok) must still block. --
{
  clearMarkers();
  fs.mkdirSync(markerDir, { recursive: true });
  // verdict at the parent sha, but NO gate-<sha>.ok anywhere
  fs.writeFileSync(path.join(markerDir, `review-${sha}.verdict`), `APPROVED ${sha}\nUsers can now do X.\n`);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "verdict only, no gate marker"]);
  const r = runHook({ command: "git tag -a v9.9.9 -m x" });
  assert.equal(r.code, 2, "a parent verdict with NO parent gate marker must still BLOCK (the tolerance must not fail open)");
  assert.match(r.err, /no release-gate pass/, "should name the missing gate");
  git(["reset", "-q", "--hard", sha]);
}

process.stdout.write("block-unapproved-tag-smoke: ok\n");
