#!/usr/bin/env node
"use strict";

// @cw-smoke: timeout 240
// npm-global-install-smoke — the Homebrew-parity proof: pack the package, install it
// GLOBALLY (npm install -g into a temp prefix, not `node dist/cli.js`), then run the
// headline commands against the INSTALLED `cw` bin from a FRESH, UNRELATED directory
// (no cd into the package, no configured repo). Proves "install once, use anywhere":
// bundled assets resolve from the install location, `cw -q "…"` auto-detects the caller
// cwd as the repo (no --repo), and a non-repo dir degrades gracefully. Vendor-agnostic
// (no live model). Heavy (pack+install), so it runs in release:check, not every `npm test`.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cleanups = [];
function tmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(d);
  return d;
}

function main() {
  // 1. pack the current build into a tarball
  const dest = tmp("cw-pack-");
  const pack = spawnSync("npm", ["pack", "--pack-destination", dest], { cwd: pluginRoot, encoding: "utf8" });
  assert.equal(pack.status, 0, `npm pack succeeds: ${pack.stderr}`);
  const tarball = path.join(dest, fs.readdirSync(dest).find((f) => f.endsWith(".tgz")));
  assert.ok(fs.existsSync(tarball), `tarball exists: ${tarball}`);

  // 2. install GLOBALLY into an isolated prefix (a true global install, not the source tree)
  const prefix = tmp("cw-global-");
  const install = spawnSync("npm", ["install", "-g", "--prefix", prefix, tarball], { encoding: "utf8" });
  assert.equal(install.status, 0, `npm install -g into prefix succeeds: ${install.stderr}`);
  const cwBin = path.join(prefix, "bin", "cw");
  assert.ok(fs.existsSync(cwBin), `installed cw bin exists at ${cwBin}`);

  // Sandbox env (no ambient agent; isolated HOME so the home registry doesn't touch the user's).
  const home = tmp("cw-home-");
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: home, CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "", CW_NO_AUTO_AGENT: "1" };
  const FAKE_AGENT = `${process.execPath} /does/not/exist.js {{result}}`;
  const runFrom = (cwd, args) => spawnSync(cwBin, args, { cwd, encoding: "utf8", env });

  // 3. from a FRESH, UNRELATED project dir (NOT the package, NOT pre-configured) — run anywhere
  const project = tmp("cw-anyproject-");
  fs.writeFileSync(path.join(project, "README.md"), "# someone's project\n", "utf8");

  // `cw -q "…"` auto-detects THIS dir as the repo (no --repo), resolves its own bundled app
  const ask = runFrom(project, ["-q", "What are the risks here?", "--check", "--agent-command", FAKE_AGENT]);
  assert.doesNotMatch(ask.stdout + ask.stderr, /Workflow app not found/, "installed `cw -q` routes the question");
  const askp = JSON.parse(ask.stdout);
  assert.equal(askp.appId, "architecture-review", "installed cw resolves the bundled app from the install location");
  assert.equal(askp.repo, project, "installed cw auto-detects the caller cwd as the repo (no --repo)");
  assert.equal(askp.ok, true, "installed cw preflight ok from an arbitrary dir");

  // `cw version` / `cw demo tamper` / `cw doctor` work from anywhere
  const ver = runFrom(project, ["version"]);
  assert.equal(ver.status, 0, "installed cw version exits 0");
  assert.match(ver.stdout.trim(), /^\d+\.\d+\.\d+$/, "installed cw reports a version");

  const demo = runFrom(project, ["demo", "tamper"]);
  assert.equal(demo.status, 0, `installed cw demo tamper exits 0: ${demo.stderr}`);
  assert.match(demo.stdout, /tamper-evidence holds/, "installed cw demo tamper proves the core (no agent, no package cwd)");

  const doctor = runFrom(project, ["doctor"]);
  assert.match(doctor.stdout + doctor.stderr, /node:/, "installed cw doctor runs from an arbitrary dir");

  // 4. a NON-repo / empty dir degrades gracefully (clear message, not a crash/stack)
  const empty = tmp("cw-empty-");
  const bad = runFrom(empty, ["-q", "risks?", "--check", "--agent-command", FAKE_AGENT]);
  assert.notEqual(bad.status, null, "no crash/timeout in an empty dir");
  assert.doesNotMatch(bad.stderr, /at Object\.<anonymous>|TypeError|undefined is not/, "no raw stack trace in an empty dir");

  // 5. the install location stays clean (no run state written into the package/prefix)
  assert.equal(fs.existsSync(path.join(prefix, ".cw")), false, "no .cw state in the install prefix");
  assert.equal(fs.existsSync(path.join(project, ".cw")), false, "--check writes no .cw in the project either");

  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  console.log("npm-global-install-smoke: ok (pack -> install -g -> run cw from an arbitrary dir)");
}

main();
