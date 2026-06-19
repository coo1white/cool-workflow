#!/usr/bin/env node
"use strict";

// doctor-smoke — `cw doctor` (a `brew doctor`-style readiness diagnostic).
// Pins: the report shape; that it is READ-ONLY (creates no .cw/$CW_HOME); that a
// missing agent is a WARN (exit 0, not a hard fail); that an unwritable home
// registry is a FAIL with non-zero exit; that --json is parseable while the
// default human rendering is not JSON; and that --onramp returns the short safe
// first-run / change-loop / release-gate path without changing default JSON.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const { runDoctor } = require(path.join(pluginRoot, "dist", "doctor.js"));

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
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-home-")));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-cwd-")));
  const report = runDoctor({}, { ...process.env, CW_HOME: home, CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "" }, cwd);
  assert.equal(report.schemaVersion, 1);
  assert.ok(Array.isArray(report.checks) && report.checks.length >= 4, "has checks");
  const names = report.checks.map((c) => c.name);
  for (const n of ["node", "agent", "home-registry", "repo-state"]) assert.ok(names.includes(n), `check ${n} present`);
  for (const c of report.checks) assert.ok(["ok", "warn", "fail"].includes(c.status), `valid status for ${c.name}`);
  assert.equal(report.onramp, undefined, "onramp is opt-in");
  // node check must pass (the test runs on Node 18+).
  assert.equal(report.checks.find((c) => c.name === "node").status, "ok", "node check ok");
})();

// ---- 2. READ-ONLY: doctor creates neither $CW_HOME nor <cwd>/.cw --------------
(function readOnly() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-ro-")));
  const home = path.join(base, "home-not-yet");
  const cwd = path.join(base, "work");
  fs.mkdirSync(cwd, { recursive: true });
  runDoctor({}, { ...process.env, CW_HOME: home }, cwd);
  assert.ok(!fs.existsSync(home), "doctor must not create $CW_HOME");
  assert.ok(!fs.existsSync(path.join(cwd, ".cw")), "doctor must not create <cwd>/.cw");
})();

// ---- 3. no agent => WARN, exit 0 (demo/preview still work) --------------------
(function noAgentWarns() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-noagent-")));
  const env = { ...process.env, CW_HOME: home };
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  const r = run(["--json"], env, home);
  assert.equal(r.code, 0, "no agent is not a blocking failure");
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true, "ok:true with only a warning");
  assert.equal(report.checks.find((c) => c.name === "agent").status, "warn", "agent is a warn");
})();

// ---- 4. unwritable home registry => FAIL, exit 1 ------------------------------
(function unwritableHomeFails() {
  // Point $CW_HOME under a regular FILE so no ancestor dir can be created/written.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-bad-")));
  const file = path.join(base, "afile");
  fs.writeFileSync(file, "x");
  const badHome = path.join(file, "registry"); // a path UNDER a file → unwritable
  const r = run(["--json"], { ...process.env, CW_HOME: badHome }, base);
  assert.equal(r.code, 1, "unwritable home registry is a blocking failure (exit 1)");
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((c) => c.name === "home-registry").status, "fail");
})();

// ---- 5. jsonMode "flag": --json is JSON, default human output is NOT JSON ------
(function jsonModeFlag() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-mode-")));
  const human = run([], { ...process.env, CW_HOME: home }, home).stdout;
  assert.ok(human.startsWith("cw doctor"), "default rendering is human text");
  assert.throws(() => JSON.parse(human), "default rendering is not canonical JSON");
  const json = run(["--json"], { ...process.env, CW_HOME: home }, home).stdout;
  assert.doesNotThrow(() => JSON.parse(json), "--json is parseable");
})();

// ---- 6. --onramp is opt-in and gives the short, safe path --------------------
(function onramp() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-onramp-")));
  const env = { ...process.env, CW_HOME: home };
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  const json = run(["--onramp", "--json"], env, pluginRoot);
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.onramp.schemaVersion, 1);
  const sectionIds = report.onramp.sections.map((section) => section.id);
  for (const id of ["first-run", "change-loop", "surface-guard", "release-gate"]) {
    assert.ok(sectionIds.includes(id), `onramp section ${id} present`);
  }
  const commands = report.onramp.sections.flatMap((section) => section.actions.map((action) => action.command));
  assert.ok(commands.includes("cw demo tamper"), "first-run demo is named");
  assert.ok(commands.some((command) => /quickstart architecture-review .*--bundle/.test(command)), "first-run bundle handoff is named");
  assert.ok(commands.includes("cw report verify-bundle report.cwrun.json"), "first-run offline bundle verification is named");
  assert.ok(commands.includes("npm run test:fast"), "fast suite is named");
  assert.ok(commands.includes("npm run release:check"), "release gate is named");
  assert.ok(commands.includes("npm run parity:check"), "surface drift guard is named");

  const plain = run(["--onramp"], env, pluginRoot).stdout;
  assert.ok(plain.includes("Onramp"), "human onramp section is rendered");
  assert.ok(plain.includes("cw quickstart architecture-review --check"), "human onramp names the zero-write check");
  assert.ok(plain.includes("--bundle"), "human onramp names the bundle handoff");
  assert.ok(plain.includes("cw report verify-bundle report.cwrun.json"), "human onramp names offline bundle verification");

  const changedPlain = run(["--onramp", "--changed-from", "HEAD"], env, pluginRoot).stdout;
  assert.ok(changedPlain.includes("Recommended Checks"), "changed-file onramp renders recommended checks");
  assert.ok(changedPlain.includes("npm run test:fast"), "changed-file onramp names the fast suite");

  const fromRepoRoot = JSON.parse(run(["--onramp", "--json"], env, repoRoot).stdout);
  const rootedCommands = fromRepoRoot.onramp.sections.flatMap((section) => section.actions.map((action) => action.command));
  assert.ok(
    rootedCommands.includes("cd plugins/cool-workflow && npm run test:fast"),
    "source checkout commands are rooted when doctor runs from the repo root"
  );

  const changedFromRepoRoot = JSON.parse(run(["--onramp", "--changed-from", "HEAD", "--json"], env, repoRoot).stdout);
  assert.ok(
    changedFromRepoRoot.onramp.recommendedChecks.commands.includes("cd plugins/cool-workflow && npm run test:fast"),
    "changed-file recommended commands are rooted when doctor runs from the repo root"
  );
})();

// --fix consolidated fix commands
(() => {
  const { stdout } = run(["--fix"], process.env, pluginRoot);
  assert.match(stdout, /Fix Commands/, "doctor --fix shows Fix Commands header");
  assert.match(stdout, /cw_agent_command/i, "doctor --fix includes agent fix suggestion");
})();

process.stdout.write("doctor-smoke: ok (shape; read-only; no-agent warns; unwritable home fails closed; --json flag mode; onramp opt-in; --fix mode)\n");
