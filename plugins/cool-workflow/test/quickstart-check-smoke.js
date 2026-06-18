#!/usr/bin/env node
"use strict";

// quickstart-check-smoke: `cw quickstart --check` is a zero-write preflight for
// the README path. It must not plan a run, create `.cw/`, spawn an agent, write a
// report, or commit. It only reports whether the next quickstart can run.

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
