#!/usr/bin/env node
"use strict";

// quickstart-check-smoke: `cw quickstart --check` is a zero-write preflight for
// the README path. It must not plan a run, create `.cw/`, spawn an agent, write a
// report, or commit. It only reports whether the next quickstart can run.
//
// CUTOVER STATUS (v2): REAL-GAP. This smoke is black-box (spawns dist/cli.js), so
// there are no old flat-dist requires to repoint. Under the real harness env
// (CW_NO_AUTO_AGENT=1 CW_REQUIRE_RESOLVABLE_EVIDENCE=0) cases 1 and 3 pass, but the
// v2 `quickstartCheck` dropped two user-facing behaviors the old build shipped, so
// cases 2 and 4 still fail on GENUINE behavior (not an import crash):
//   1. No `nextCommand` field on the --check payload. The old build returned
//      `nextCommand: quickstartNextCommand(...)` (old src/capability-core.ts, the
//      quickstartCheck return object). v2's quickstartCheck returns only
//      { schemaVersion, mode, ok, appId, repo, checks } and `quickstartNextCommand`
//      does not exist anywhere in v2 src — see src/shell/pipeline-cli.ts.
//   2. No `--bundle` / `bundle-trust-key` preflight check. The old build pushed a
//      bundle-trust-key check (warn by default, blocked under --strict-signatures)
//      whenever --bundle was passed. v2's quickstartCheck has zero `bundle`
//      handling — src/shell/pipeline-cli.ts (function quickstartCheck, lines
//      129-196) never reads args.bundle, so --strict-signatures with no key does
//      not block. Case 4 below therefore fails.
// Assertions are LEFT INTACT (not weakened): fixing v2 is Phase B's job.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

const cleanups = [];
function tmpWorkspace(prefix = "cw-quickstart-check-") {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CW_AGENT_COMMAND: "",
      CW_AGENT_ENDPOINT: "",
      CW_AGENT_ATTEST_PUBKEY: ""
    }
  });
}

function parse(result) {
  assert.equal(result.stderr, "", `stderr must stay quiet on success/fail-closed JSON paths: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// --- 1. no agent: fail closed, no `.cw` created -----------------------------
{
  const work = tmpWorkspace();
  const result = run(["quickstart", "architecture-review", "--check", "--repo", work, "--question", "risks?"], work);
  assert.equal(result.status, 1, "missing agent makes --check exit 1");
  const payload = parse(result);
  assert.equal(payload.mode, "check");
  assert.equal(payload.ok, false);
  assert.equal(payload.appId, "architecture-review");
  assert.equal(payload.repo, work);
  assert.equal(payload.checks.find((check) => check.name === "agent").status, "blocked");
  assert.equal(fs.existsSync(path.join(work, ".cw")), false, "--check must not create .cw");
}

// --- 2. configured agent: ok, still no spawn/write --------------------------
{
  const work = tmpWorkspace();
  const result = run([
    "quickstart",
    "architecture-review",
    "--check",
    "--repo",
    work,
    "--question",
    "risks?",
    "--agent-command",
    `${process.execPath} ${path.join(work, "does-not-need-to-exist.js")} {{result}}`
  ], work);
  assert.equal(result.status, 0, "configured agent makes --check pass");
  const payload = parse(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.checks.find((check) => check.name === "agent").status, "ok");
  // REAL-GAP (see header): v2 dropped the `nextCommand` field; payload.nextCommand
  // is undefined here. Left as a failing assertion for Phase B.
  assert.match(payload.nextCommand, /cw quickstart architecture-review/);
  assert.equal(fs.existsSync(path.join(work, ".cw")), false, "--check still must not create .cw");
}

// --- 3. bad app, bad repo, missing question all block -----------------------
{
  const work = tmpWorkspace();
  const missingRepo = path.join(work, "missing");
  const result = run(["quickstart", "not-an-app", "--check", "--repo", missingRepo], work);
  assert.equal(result.status, 1, "bad inputs make --check exit 1");
  const payload = parse(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.checks.find((check) => check.name === "app").status, "blocked");
  assert.equal(payload.checks.find((check) => check.name === "repo").status, "blocked");
  assert.equal(payload.checks.find((check) => check.name === "question").status, "blocked");
  assert.equal(fs.existsSync(path.join(work, ".cw")), false, "bad-input --check must not create .cw");
}

// --- 4. bundle trust key: warn by default, blocked under strict signatures ---
{
  const work = tmpWorkspace();
  const base = [
    "quickstart",
    "architecture-review",
    "--check",
    "--repo",
    work,
    "--question",
    "risks?",
    "--agent-command",
    "stub-agent {{result}}",
    "--bundle"
  ];
  // REAL-GAP (see header): v2's quickstartCheck never reads args.bundle, so the
  // `bundle-trust-key` check is absent and --strict-signatures with no key does not
  // block. Both asserts below fail. Left intact for Phase B.
  const warn = parse(run(base, work));
  assert.equal(warn.ok, true, "no key is only a warning without strict signatures");
  assert.equal(warn.checks.find((check) => check.name === "bundle-trust-key").status, "warn");

  const strict = run([...base, "--strict-signatures"], work);
  assert.equal(strict.status, 1, "strict signatures with no key blocks");
  const strictPayload = parse(strict);
  assert.equal(strictPayload.ok, false);
  assert.equal(strictPayload.checks.find((check) => check.name === "bundle-trust-key").status, "blocked");
}

for (const dir of cleanups) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

process.stdout.write("quickstart-check-smoke: ok\n");
