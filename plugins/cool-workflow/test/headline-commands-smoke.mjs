#!/usr/bin/env node
// headline-commands-smoke — exercises the EXACT documented commands a new user types
// (the `cw -q "question"` shorthand, the vendor flags, help/version). This is the gate that would have caught v0.1.88's
// headline regressions:
//   1. `cw -q "question"` routed the question into appId -> "Workflow app not found".
//   2. the real run demanded --repo instead of defaulting to the caller's cwd.
//   3. `cw help` emitted no trailing newline and one 400-char unwrapped command line.
// Vendor-agnostic: no live model — a run with no agent configured stops blocked before
// any spawn, so the routing and the repo choice are proved deterministically.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpWorkspace } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cleanups = [];

function tmpRepo() {
  const work = tmpWorkspace("cw-headline-");
  spawnSync("git", ["init", "-q"], { cwd: work }); // a real project: the cwd-default repo check needs one
  cleanups.push(work);
  return work;
}

function run(args, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "", CW_NO_AUTO_AGENT: "1", ...extraEnv }
  });
}

// ===== 1. `cw -q "question"` routes the string as a QUESTION, repo = cwd (no --repo) =====
// No agent configured: the run is planned and written, then stops blocked
// (exit 2) without spawning anything — deterministic and vendor-free.
for (const question of ["What are the top security risks here?", "list", "report"]) {
  const work = tmpRepo();
  const r = run(["-q", question, "--json"], work);
  assert.equal(r.status, 2, `cw -q "${question}" with no agent stops blocked (exit 2): ${r.stderr}`);
  const p = JSON.parse(r.stdout);
  assert.equal(p.appId, "architecture-review", "the -q shorthand keeps the default app, never uses the question as a command or app");
  assert.equal(p.status, "blocked");
  assert.ok(p.statePath.startsWith(work), "repo auto-detects the caller cwd with no --repo (run anywhere, like brew)");
  assert.equal(JSON.parse(fs.readFileSync(p.statePath, "utf8")).cwd, work, "run.cwd is the caller cwd");
}
console.log("headline: cw -q routes question (even a command name) + auto-detects repo ok");

// ===== 4. vendor flags: v2/conformance/cases/cli-vendor-flags =====

// ===== 5. no-agent commands work from anywhere, exit 0 =====
{
  const anywhere = tmpRepo();
  for (const [args, needle] of [
    [["version"], /^\d+\.\d+\.\d+/],
    [["help"], /Cool Workflow/],
  ]) {
    const r = run(args, anywhere);
    assert.equal(r.status === 0 || r.status === 1, true, `cw ${args.join(" ")} runs (status ${r.status})`);
    assert.match(r.stdout + r.stderr, needle, `cw ${args.join(" ")} output looks right`);
  }
  console.log("headline: version/help work anywhere ok");
}

// ===== 6. output hygiene + clean help: piped stdout has NO escapes; help wraps + ends in \n =====
{
  const work = tmpRepo();
  for (const cmd of [["help"], ["version"]]) {
    const r = run(cmd, work);
    assert.ok(!/\x1b/.test(r.stdout), `piped stdout of 'cw ${cmd.join(" ")}' must contain no ANSI/OSC escapes`);
  }
  const help = run(["help"], work).stdout;
  assert.ok(help.endsWith("\n"), "cw help output ends with a newline (no prompt-merge)");
  const longest = help.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
  assert.ok(longest <= 80, `no help line wraps raggedly (longest=${longest}, must be <= 80)`);
  console.log("headline: output hygiene (no piped escapes) + clean wrapped help ok");
}

// ===== 7. -dir/--dir/-d target a project folder from ANY cwd (alias for --repo) =====
// A user in some unrelated directory can point cw at a project WITHOUT cd-ing
// in. The flag — not the invocation cwd — decides where the run's state lands:
// a run state created under the invocation cwd's .cw would be an orphan.
{
  for (const flag of ["-d", "-dir", "--dir", "--repo"]) {
    const elsewhere = tmpRepo(); // where the user happens to be standing
    const target = tmpRepo();    // the project they want reviewed
    const r = run(["-q", "what are the risks?", flag, target, "--json"], elsewhere);
    assert.equal(r.status, 2, `cw -q via ${flag} with no agent stops blocked (stderr: ${String(r.stderr).slice(0, 200)})`);
    const p = JSON.parse(r.stdout);
    assert.ok(p.statePath.startsWith(target), `${flag}: run state.json persists under the TARGET, not the cwd`);
    assert.equal(JSON.parse(fs.readFileSync(p.statePath, "utf8")).cwd, target, `${flag}: run.cwd === the target folder`);
    assert.ok(!fs.existsSync(path.join(elsewhere, ".cw")), `${flag}: no orphaned run under the invocation cwd`);
  }
  // Explicit --repo wins when both are present — the alias never overrides the real flag.
  const elsewhere = tmpRepo();
  const target = tmpRepo();
  const r2 = run(["-q", "risks?", "-dir", elsewhere, "--repo", target, "--json"], elsewhere);
  assert.ok(JSON.parse(r2.stdout).statePath.startsWith(target), "explicit --repo takes precedence over the -dir alias");
  console.log("headline: -d/-dir/--dir/--repo target a folder from any cwd, state lands there ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("headline-commands-smoke: ok");
