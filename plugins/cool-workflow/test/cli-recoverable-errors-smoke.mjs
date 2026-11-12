#!/usr/bin/env node
// cli-recoverable-errors-smoke — every failure should hand the user a concrete next move
// (brew's `Try: …`), not a dead end. Asserts the Part 3 recovery surface:
//   1. a typo'd command -> "Did you mean: <closest>?" + a `Try: cw help` recovery line.
//   2. a far-off command -> still `Try: cw help` (the discovery entry point), no bad guess.
//   3. a no-agent cw -q -> fails CLOSED (status=blocked) and the JSON `hint` is a
//      COPY-PASTEABLE fix (set CW_AGENT_COMMAND / --agent-command), never a fabricated run.
// Vendor-agnostic: recovery points at CW's own verbs (help/doctor/config), never a model.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
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
  const r = run(["repotr"]);
  assert.equal(r.status, 1, "an unknown command exits non-zero");
  assert.match(r.stderr, /Unknown command: repotr/, "names the unknown command");
  assert.match(r.stderr, /Did you mean: report\?/, "suggests the closest known command");
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

// ===== 3. a no-agent cw -q fails CLOSED with a copy-pasteable fix hint =====
{
  const work = tmpDir("cw-recover-");
  cleanups.push(work);
  fs.writeFileSync(path.join(work, "README.md"), "# proj\n", "utf8");
  // No agent configured (env zeroed, auto-detect off): the drive must NOT fabricate a run.
  const r = run(["-q", "what are the risks?", "-dir", work, "--json"], work);
  const p = JSON.parse(r.stdout); // stdout stays valid JSON even on the blocked path
  assert.equal(p.agentConfigured, false, "no agent backend was configured");
  assert.equal(p.status, "blocked", "the drive fails CLOSED with no agent (never a fake completion)");
  // v2 relocated the recovery text: the old top-level `p.hint` string is now the
  // blocked step's `reason` (src/core/pipeline/drive-decide.ts). Same two
  // facts asserted, read from the v2 equivalent — intent preserved, not weakened.
  const hint = p.steps && p.steps.length ? p.steps[p.steps.length - 1].reason : undefined;
  assert.match(hint, /not configured/, "the hint explains WHY it blocked");
  assert.match(hint, /CW_AGENT_COMMAND|--agent-command/, "the hint is a copy-pasteable fix");
  console.log("recover: no-agent quickstart blocks with a copy-pasteable fix hint ok");
}

// ===== 4. a missing or non-git folder points the user at the -dir flag =====
{
  const work = tmpDir("cw-recover-norepo-");
  cleanups.push(work);
  const missing = run(["-q", "risks?", "-dir", path.join(work, "nope")], work);
  assert.equal(missing.status, 1, "a missing folder exits non-zero");
  assert.match(missing.stderr, /is missing: there is no such folder/, "names the missing folder");
  assert.match(missing.stderr, /Try: cw -q .* -dir <project-folder>/, "points the user at the -dir flag to fix it");
  const notGit = run(["-q", "risks?"], work);
  assert.equal(notGit.status, 1, "a folder that is not a git project exits non-zero");
  assert.match(notGit.stderr, /is not a git project/, "says why");
  assert.match(notGit.stderr, /Try: cw -q .* -dir <project-folder>/, "points the user at the -dir flag to fix it");
  console.log("recover: missing or non-git folder points at the -dir flag ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("cli-recoverable-errors-smoke: ok");
