#!/usr/bin/env node
"use strict";

// headline-commands-smoke — exercises the EXACT documented commands a new user types
// (the `cw -q "question"` shorthand, the vendor flags, demo/doctor/help/version/fix),
// not the internal quickstart() API. This is the gate that would have caught v0.1.88's
// headline regressions:
//   1. `cw -q "question"` routed the question into appId -> "Workflow app not found".
//   2. the real run demanded --repo instead of defaulting to the caller's cwd.
//   3. `cw help` emitted no trailing newline and one 400-char unwrapped command line.
// Vendor-agnostic: no live model — `--check`/`--preview` and the no-agent commands prove
// CW's own surface + the delegation contract deterministically.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cleanups = [];

function tmpRepo() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-headline-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
// A configured (but never-spawned on --check/--preview) agent, so config checks pass.
const FAKE_AGENT = `${process.execPath} /does/not/need/to/exist.js {{result}}`;

function run(args, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "", CW_NO_AUTO_AGENT: "1", ...extraEnv }
  });
}
const NOT_FOUND = /Workflow app not found/;

// ===== 1. `cw -q "question"` routes the string as a QUESTION, repo = cwd (no --repo) =====
{
  const work = tmpRepo();
  const r = run(["-q", "What are the top security risks here?", "--check", "--agent-command", FAKE_AGENT], work);
  assert.doesNotMatch(r.stdout + r.stderr, NOT_FOUND, "`cw -q` must NOT treat the question as an app id");
  const p = JSON.parse(r.stdout);
  assert.equal(p.appId, "architecture-review", "the -q shorthand defaults the app, never uses the question as appId");
  assert.equal(p.repo, work, "repo auto-detects the caller cwd with no --repo (run anywhere, like brew)");
  assert.equal(p.ok, true, "configured agent + readable repo => preflight ok");
  console.log("headline: cw -q routes question + auto-detects repo ok");
}

// ===== 2. long form `--question`, and a question that LOOKS like a flag/app, all route =====
for (const variant of [
  ["--question", "review the auth module", "--check", "--agent-command", FAKE_AGENT],
  ["-q", "list", "--check", "--agent-command", FAKE_AGENT] // "list" is also a real command — must stay a QUESTION here
]) {
  const work = tmpRepo();
  const r = run(variant, work);
  assert.doesNotMatch(r.stdout + r.stderr, NOT_FOUND, `'${variant.join(" ")}' must route as a question`);
  const p = JSON.parse(r.stdout);
  assert.equal(p.appId, "architecture-review", `'${variant.join(" ")}' keeps the default app`);
}
console.log("headline: --question long form + flag-like questions route ok");

// ===== 3. the REAL plan path (not --check) also defaults repo to cwd — the "Missing --repo" fix =====
{
  const work = tmpRepo();
  const r = run(["-q", "find the risks", "--preview", "--agent-command", FAKE_AGENT], work); // --preview: real plan, no spawn
  assert.equal(r.status, 0, `cw -q --preview from cwd must NOT fail "Missing required input --repo": ${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /Missing required input --repo/, "real plan path defaults repo to cwd");
  console.log("headline: cw -q real plan path auto-detects repo (no --repo) ok");
}

// ===== 4. vendor flags select an external interface and still route (vendor-agnostic) =====
for (const vendor of ["-claude", "-codex", "-deepseek"]) {
  const work = tmpRepo();
  const r = run(["-q", "any risks?", vendor, "--check"], work);
  assert.doesNotMatch(r.stdout + r.stderr, NOT_FOUND, `${vendor} path must still route the question`);
  const p = JSON.parse(r.stdout);
  assert.equal(p.appId, "architecture-review", `${vendor} keeps the default app`);
  assert.equal(p.checks.find((c) => c.name === "agent").status, "ok", `${vendor} configures an agent interface`);
}
console.log("headline: vendor flags -claude/-codex/-deepseek route ok");

// ===== 5. no-agent commands work from anywhere, exit 0 =====
{
  const anywhere = tmpRepo();
  for (const [args, needle] of [
    [["version"], /^\d+\.\d+\.\d+/],
    [["help"], /Cool Workflow/],
    [["doctor"], /(ready|node:)/i],
    [["fix"], /(No fixes needed|Fix Commands|--agent-command)/],
    [["demo", "tamper"], /tamper-evidence holds/],
    [["demo", "bundle"], /bundle verification holds/]
  ]) {
    const r = run(args, anywhere);
    assert.equal(r.status === 0 || r.status === 1, true, `cw ${args.join(" ")} runs (status ${r.status})`);
    assert.match(r.stdout + r.stderr, needle, `cw ${args.join(" ")} output looks right`);
  }
  console.log("headline: version/help/doctor/fix/demo work anywhere ok");
}

// ===== 6. output hygiene + clean help: piped stdout has NO escapes; help wraps + ends in \n =====
{
  const work = tmpRepo();
  for (const cmd of [["help"], ["doctor"], ["version"]]) {
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
// The complement to section 1's cwd auto-detect: a user in some unrelated directory can
// point cw at a project WITHOUT cd-ing in. The flag — not the invocation cwd — decides
// the analyzed repo. This is the "install once, run anywhere" parity with brew.
{
  const elsewhere = tmpRepo(); // where the user happens to be standing
  const target = tmpRepo();    // the project they want reviewed
  for (const flag of ["-dir", "--dir", "-d"]) {
    const r = run(["-q", "what are the risks?", flag, target, "--check", "--agent-command", FAKE_AGENT], elsewhere);
    assert.doesNotMatch(r.stdout + r.stderr, NOT_FOUND, `${flag} must still route the question`);
    const p = JSON.parse(r.stdout);
    assert.equal(p.repo, target, `${flag} <path> targets that folder from any cwd (not the invocation cwd)`);
  }
  // Explicit --repo wins when both are present — the alias never overrides the real flag.
  const r2 = run(["-q", "risks?", "-dir", elsewhere, "--repo", target, "--check", "--agent-command", FAKE_AGENT], elsewhere);
  assert.equal(JSON.parse(r2.stdout).repo, target, "explicit --repo takes precedence over the -dir alias");
  console.log("headline: -dir/--dir/-d target a folder from any cwd (alias for --repo) ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("headline-commands-smoke: ok");
