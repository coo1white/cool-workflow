#!/usr/bin/env node
"use strict";

// block-unapproved-tag-smoke — exercises scripts/block-unapproved-tag.sh, the
// PreToolUse hook that blocks `git tag`/tag-push unless both the gate marker
// and an APPROVED reviewer verdict exist for HEAD.
//
// Every assertion would FAIL if the hook's gating were reverted:
//  - feed a tag command with no markers      -> must BLOCK (exit 2)
//  - add only the gate marker                 -> must still BLOCK (no verdict)
//  - add gate marker + APPROVED verdict       -> must ALLOW (exit 0)
//  - feed a non-tag command                   -> must ALLOW (exit 0)
// The valid-JSON cases also prove the node-based stdin parser works (the fix
// that removed the jq dependency so the hook can't silently fail open).
// Portable: node + git only, isolated tmpdir.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HOOK = path.resolve(__dirname, "..", "scripts", "block-unapproved-tag.sh");
assert.ok(fs.existsSync(HOOK), "block-unapproved-tag.sh must exist");

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
git(["add", "-A"]);
git(["commit", "-q", "-m", "init"]);
const sha = git(["rev-parse", "HEAD"]);

function runHook(toolInput) {
  const input = JSON.stringify({ tool_name: "Bash", tool_input: toolInput });
  const r = spawnSync("bash", [HOOK], { cwd: dir, input, encoding: "utf8" });
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
  const r = spawnSync("bash", [HOOK], { cwd: dir, input: "not json", encoding: "utf8" });
  assert.equal(r.status, 0, "malformed input must not block");
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

// ---- Tag push variant is also gated ----
{
  clearMarkers();
  const r = runHook({ command: "git push origin --tags" });
  assert.equal(r.code, 2, "tag push with no markers must be blocked");
}

process.stdout.write("block-unapproved-tag-smoke: ok\n");
