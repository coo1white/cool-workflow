#!/usr/bin/env node
"use strict";

// release-oneclick-smoke — exercises scripts/release-oneclick.js, the
// operator's one-command release orchestrator (npm run release -- X.Y.Z).
//
// Scope: the FAIL-FAST layer and the red lines. The orchestrator's stages 1-3
// are thin sequencing over gh/git/release-flow.js that only a real release
// exercises end to end (the same reason every release-flow --cut smoke case
// is --dry-run: a non-dry-run run would mutate the real checkout). What this
// smoke pins:
//   - no version arg -> usage error, exit 1, nothing touched
//   - a version whose preflight must fail (no CHANGELOG section for it)
//     dies in stage 0, BEFORE any branch/commit/PR side effect
//   - red lines: shell:false spawns only, no model SDK, no API key handling
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const ONECLICK = path.join(pluginRoot, "scripts", "release-oneclick.js");
assert.ok(fs.existsSync(ONECLICK), "release-oneclick.js must exist");

// ---- red lines (static) -----------------------------------------------------
{
  const src = fs.readFileSync(ONECLICK, "utf8");
  assert.match(src, /shell:\s*false/, "oneclick must spawn shell:false");
  for (const sdk of ["@anthropic-ai", "openai", "@google/generative-ai", "ollama", "cohere", "mistralai"]) {
    assert.ok(!new RegExp(`require\\(["'][^"']*${sdk}`).test(src), `oneclick must not import a model SDK: ${sdk}`);
  }
  assert.ok(!/api[._-]?key/i.test(src), "oneclick must not handle an API key");
  // The operator boundary: the signing key env var is never read here — it is
  // forwarded implicitly to release-flow.js's own signVerdictIfConfigured().
  assert.ok(
    !/CW_RELEASE_VERDICT_PRIVKEY/.test(src.replace(/\/\/[^\n]*/g, "")),
    "oneclick code must never read CW_RELEASE_VERDICT_PRIVKEY (comments may mention it)"
  );
}

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [ONECLICK, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function treeState() {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  return (r.stdout || "").trim();
}

// ---- Case: no version arg -> usage, exit 1 ----------------------------------
{
  const before = treeState();
  const r = run([]);
  assert.notEqual(r.code, 0, "missing version must fail");
  assert.match(r.err, /usage: node scripts\/release-oneclick\.js X\.Y\.Z/, "should print usage");
  assert.equal(treeState(), before, "a usage error must not touch the tree");
}

// ---- Case: preflight failure stops stage 0 with NO side effects -------------
// 99.99.99 has no CHANGELOG section in this repo, so release-flow's cut
// preflight must reject it; oneclick must stop right there — no branch, no
// commit, no PR attempt (the gh stub would loudly fail if reached).
{
  const before = treeState();
  const branchBefore = spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  const r = run(["99.99.99", "--dry-run"], { CW_ONECLICK_GH_CMD: "false" });
  assert.notEqual(r.code, 0, "a failing preflight must fail the whole run");
  assert.match(r.out + r.err, /\[0\/4\] preflight/, "stage 0 must have started");
  assert.match(r.out + r.err, /CHANGELOG\.md has no "## 99\.99\.99" section|preflight failed/, "the preflight reason must surface");
  assert.doesNotMatch(r.out, /\[1\/4\]|\[2\/4\]|\[3\/4\]/, "no later stage may start after a failed preflight");
  assert.equal(treeState(), before, "a failed preflight must leave the tree untouched");
  const branchAfter = spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  assert.equal(branchAfter, branchBefore, "a failed preflight must not switch branches");
}

process.stdout.write("release-oneclick-smoke: ok (usage + stage-0 fail-fast leave the tree untouched; red lines hold)\n");
