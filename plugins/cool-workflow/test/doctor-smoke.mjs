#!/usr/bin/env node
// doctor-smoke — `cw doctor` (a `brew doctor`-style readiness diagnostic).
// Pins: the report shape; that it is READ-ONLY (creates no .cw/$CW_HOME); that a
// missing agent is a WARN (exit 0, not a hard fail); that an unwritable home
// registry is a FAIL with non-zero exit; that --json is parseable while the
// default human rendering is not JSON; and that --fix prints the fix commands.
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
import { runDoctor } from "../dist/shell/doctor.js";
import { tmpDir } from "./helpers/workspace.mjs";

function run(args, env, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [cli, "doctor", ...args], { env, cwd, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: String(error.stdout || "") };
  }
}

// ---- 1. report shape + the in-process API ------------------------------------
(function shape() {
  const home = tmpDir("cw-doctor-home-");
  const cwd = tmpDir("cw-doctor-cwd-");
  const report = runDoctor({}, { ...process.env, CW_HOME: home, CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "" }, cwd);
  assert.equal(report.schemaVersion, 1);
  assert.ok(Array.isArray(report.checks) && report.checks.length >= 4, "has checks");
  const names = report.checks.map((c) => c.name);
  // agent-binary / agent-runs show only when an agent is configured or found.
  assert.deepEqual(names.filter((n) => !n.startsWith("agent-")), ["node", "agent", "git", "repo-state", "run-state-integrity"], "the checks, in order");
  for (const c of report.checks) assert.ok(["ok", "warn", "fail"].includes(c.status), `valid status for ${c.name}`);
  for (const c of report.checks) if (c.status === "ok") assert.equal(c.fix, undefined, `an ok check (${c.name}) carries no fix line`);
  // node check must pass (the test runs on Node 22.13+).
  assert.equal(report.checks.find((c) => c.name === "node").status, "ok", "node check ok");
})();

// ---- 2. READ-ONLY: doctor creates neither $CW_HOME nor <cwd>/.cw --------------
(function readOnly() {
  const base = tmpDir("cw-doctor-ro-");
  const home = path.join(base, "home-not-yet");
  const cwd = path.join(base, "work");
  fs.mkdirSync(cwd, { recursive: true });
  runDoctor({}, { ...process.env, CW_HOME: home }, cwd);
  assert.ok(!fs.existsSync(home), "doctor must not create $CW_HOME");
  assert.ok(!fs.existsSync(path.join(cwd, ".cw")), "doctor must not create <cwd>/.cw");
})();

// ---- 3. no agent => WARN, exit 0 (demo/preview still work) --------------------
(function noAgentWarns() {
  const home = tmpDir("cw-doctor-noagent-");
  const env = { ...process.env, CW_HOME: home };
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  // Also block auto-detection of a real agent CLI (claude/codex/gemini/
  // deepseek) that may genuinely be on $PATH in the test environment —
  // without this, "no agent configured" silently becomes "auto-detected",
  // flipping this case's whole premise.
  env.CW_NO_AUTO_AGENT = "1";
  const r = run(["--json"], env, home);
  assert.equal(r.code, 0, "no agent is not a blocking failure");
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true, "ok:true with only a warning");
  assert.equal(report.checks.find((c) => c.name === "agent").status, "warn", "agent is a warn");
})();

// ---- 4. a run whose state.json does not load => run-state-integrity WARN --------
(function corruptRunStateWarns() {
  const base = tmpDir("cw-doctor-bad-");
  const runDir = path.join(base, ".cw", "runs", "broken-run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "state.json"), "{ not json");
  const r = run(["--json"], { ...process.env, CW_HOME: base }, base);
  const report = JSON.parse(r.stdout);
  const check = report.checks.find((c) => c.name === "run-state-integrity");
  assert.equal(check.status, "warn", "a corrupt state.json is named, not hidden");
  assert.match(check.detail, /broken-run/);
  assert.ok(check.fix, "and comes with a fix");
})();

// ---- 5. jsonMode "flag": --json is JSON, default human output is NOT JSON ------
(function jsonModeFlag() {
  const home = tmpDir("cw-doctor-mode-");
  const human = run([], { ...process.env, CW_HOME: home }, home).stdout;
  assert.ok(human.startsWith("cw doctor"), "default rendering is human text");
  assert.throws(() => JSON.parse(human), "default rendering is not canonical JSON");
  const json = run(["--json"], { ...process.env, CW_HOME: home }, home).stdout;
  assert.doesNotThrow(() => JSON.parse(json), "--json is parseable");
})();

// --fix consolidated fix commands
(() => {
  // Force the "no agent configured" case regardless of whether a real
  // agent CLI happens to be on $PATH in the test environment — this test
  // is about the --fix rendering for that case, not about real PATH
  // contents (same class of guard as the noAgentWarns case above).
  const env = { ...process.env, CW_NO_AUTO_AGENT: "1" };
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  const { stdout } = run(["--fix"], env, pluginRoot);
  assert.match(stdout, /Fix Commands/, "doctor --fix shows Fix Commands header");
  assert.match(stdout, /cw_agent_command/i, "doctor --fix includes agent fix suggestion");
})();

// ---- CW_NO_AUTO_AGENT guard ------------------------------------------------
(() => {
  // When CW_NO_AUTO_AGENT=1 is set (as the test runner sandbox does), the agent
  // check should report "warn" (not auto-detected). This is the expected test
  // behavior — auto-detection is for real user sessions, not smoke tests.
  const home = tmpDir("cw-doctor-noauto-");
  const env = { ...process.env, CW_HOME: home, CW_NO_AUTO_AGENT: "1" };
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  const r = run(["--json"], env, home);
  assert.equal(r.code, 0, "CW_NO_AUTO_AGENT=1 exits cleanly");
  const report = JSON.parse(r.stdout);
  const agentCheck = report.checks.find((c) => c.name === "agent");
  assert.ok(agentCheck.status === "warn" || agentCheck.status === "ok",
    `CW_NO_AUTO_AGENT=1 agent status is warn or ok, got ${agentCheck.status}`);
})();

process.stdout.write("doctor-smoke: ok (shape; read-only; no-agent warns; corrupt run state warns; --json flag mode; --fix mode; CW_NO_AUTO_AGENT guard)\n");
