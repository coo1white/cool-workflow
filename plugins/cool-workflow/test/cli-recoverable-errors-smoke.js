#!/usr/bin/env node
"use strict";

// cli-recoverable-errors-smoke — every failure should hand the user a concrete next move
// (brew's `Try: …`), not a dead end. Asserts the Part 3 recovery surface:
//   1. a typo'd command -> "Did you mean: <closest>?" + a `Try: cw help` recovery line.
//   2. a far-off command -> still `Try: cw help` (the discovery entry point), no bad guess.
//   3. a no-agent quickstart -> fails CLOSED (status=blocked) and the JSON `hint` is a
//      COPY-PASTEABLE fix (set CW_AGENT_COMMAND / --agent-command), never a fabricated run.
// Vendor-agnostic: recovery points at CW's own verbs (help/doctor/config), never a model.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cleanups = [];

function run(args, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: cwd || pluginRoot,
    encoding: "utf8",
    env: { ...process.env, CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "", CW_NO_AUTO_AGENT: "1", ...extraEnv }
  });
}

// ===== 1. a typo'd command suggests the closest verb AND offers a recovery =====
{
  const r = run(["quickstrt"]);
  assert.equal(r.status, 1, "an unknown command exits non-zero");
  assert.match(r.stderr, /Unknown command: quickstrt/, "names the unknown command");
  assert.match(r.stderr, /Did you mean: quickstart\?/, "suggests the closest known command");
  assert.match(r.stderr, /Try: cw help/, "offers a brew-style recovery line");
  assert.ok(!/\x1b/.test(r.stdout), "no chrome leaks into stdout on error");
  console.log("recover: typo'd command suggests + offers `Try: cw help` ok");
}

// ===== 2. a far-off command has no good suggestion but STILL offers recovery =====
{
  const r = run(["zzzzzzzzzz"]);
  assert.equal(r.status, 1, "unknown command exits non-zero");
  assert.match(r.stderr, /Unknown command: zzzzzzzzzz/, "names the unknown command");
  assert.doesNotMatch(r.stderr, /Did you mean/, "no misleading suggestion when nothing is close");
  assert.match(r.stderr, /Try: cw help/, "still routes the user to discovery");
  console.log("recover: far-off command still offers `Try: cw help` (no bad guess) ok");
}

// ===== 3. a no-agent quickstart fails CLOSED with a copy-pasteable fix hint =====
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-recover-")));
  cleanups.push(work);
  fs.writeFileSync(path.join(work, "README.md"), "# proj\n", "utf8");
  // No agent configured (env zeroed, auto-detect off): the drive must NOT fabricate a run.
  const r = run(["-q", "what are the risks?", "-dir", work, "--json"], work);
  const p = JSON.parse(r.stdout); // stdout stays valid JSON even on the blocked path
  assert.equal(p.agentConfigured, false, "no agent backend was configured");
  assert.equal(p.status, "blocked", "the drive fails CLOSED with no agent (never a fake completion)");
  assert.match(p.hint, /not configured/, "the hint explains WHY it blocked");
  assert.match(p.hint, /CW_AGENT_COMMAND|--agent-command/, "the hint is a copy-pasteable fix");
  console.log("recover: no-agent quickstart blocks with a copy-pasteable fix hint ok");
}

// ===== 4. `cw run <app> --drive` also fails CLOSED with no agent, and SURFACES it =====
// Parity with §3 for the advanced verb: DriveResult must carry agentConfigured so the CLI
// can offer the right recovery (`Try: cw doctor`) instead of a generic status hint.
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-recover-drv-")));
  cleanups.push(work);
  for (const a of [["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"], ["config", "commit.gpgsign", "false"]]) {
    spawnSync("git", ["-C", work, ...a], { encoding: "utf8" });
  }
  fs.writeFileSync(path.join(work, "README.md"), "# proj\n", "utf8");
  spawnSync("git", ["-C", work, "add", "-A"], { encoding: "utf8" });
  spawnSync("git", ["-C", work, "commit", "-q", "-m", "init"], { encoding: "utf8" });
  // -dir trails the boolean --drive: a regression in arg parsing (a flag swallowing the
  // next flag) would drop it and this would fail "Missing --repo" instead of blocking.
  const r = run(["run", "architecture-review", "--drive", "-dir", work, "-q", "risks?", "--json"], work);
  const p = JSON.parse(r.stdout);
  assert.equal(p.agentConfigured, false, "run --drive surfaces agentConfigured=false (enables the `cw doctor` recovery)");
  assert.equal(p.status, "blocked", "run --drive also fails CLOSED with no agent (never a fabricated run)");
  console.log("recover: run --drive carries agentConfigured + fails closed ok");
}

// ===== 5. a missing-repo error points the user at the -dir flag (recoveryHint coverage) =====
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-recover-norepo-")));
  cleanups.push(work);
  const r = run(["plan", "architecture-review"], work); // plan does not default repo to cwd
  assert.equal(r.status, 1, "a missing required input exits non-zero");
  assert.match(r.stderr, /Missing required input --repo/, "names the missing input");
  assert.match(r.stderr, /Try: cw -q .* -dir <project-folder>/, "points the user at the -dir flag to fix it");
  console.log("recover: missing-repo error points at the -dir flag ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("cli-recoverable-errors-smoke: ok");
