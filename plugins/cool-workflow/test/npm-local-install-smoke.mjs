#!/usr/bin/env node
// @cw-smoke: timeout 240
// npm-local-install-smoke — a user who installs the published package as a
// plain (not -g) dependency, or runs it with npx, must get a working `cw`.
// From 0.2.8 to 0.3.2 the package shipped a "preinstall" guard meant only
// for people working on CW itself; it ran on every user install too, so
// `npm i cool-workflow` failed ("must be set up with bun") and
// `npx -y cool-workflow help` exited 1 with no word. This smoke packs the
// package, installs the tarball the way a user does (a local install into a
// temp prefix, then the npx path), and runs the installed bin. It is offline:
// the package has zero runtime dependencies, so npm needs no network.
//
// The pack uses --ignore-scripts: "prepack" builds the workbench UI, which a
// local-install proof does not need. Install scripts are NOT ignored on the
// install itself — running them is the point.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-local-install-")));

// The parent may be `npm run` or `bun run`: drop every npm_* var it set
// (npm_config_global, npm_execpath, npm_config_user_agent, ...) so the child
// npm sees a clean user shell, not the test runner's own run state.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)));
Object.assign(env, {
  HOME: path.join(tmp, "home"),
  npm_config_cache: path.join(tmp, "npm-cache"),
  npm_config_update_notifier: "false",
  CW_AGENT_COMMAND: "",
  CW_AGENT_ENDPOINT: "",
  CW_NO_AUTO_AGENT: "1",
});
fs.mkdirSync(env.HOME);

const npm = (args, cwd) => spawnSync("npm", args, { cwd, env, encoding: "utf8" });

try {
  // 1. The source package.json carries no install-time script: one there
  //    ships in the tarball and runs (or is "blocked" with a warning) on
  //    every user install.
  for (const name of INSTALL_SCRIPTS) {
    assert.equal((pkg.scripts || {})[name], undefined, `package.json must not have a "${name}" script (it ships to every user install)`);
  }

  // 2. Pack the current tree.
  const packDir = path.join(tmp, "pack");
  fs.mkdirSync(packDir);
  const pack = npm(["pack", "--ignore-scripts", "--pack-destination", packDir], pluginRoot);
  assert.equal(pack.status, 0, `npm pack: ${pack.stderr}`);
  const tarball = path.join(packDir, fs.readdirSync(packDir).find((f) => f.endsWith(".tgz")));

  // 3. A plain local install, from an unrelated directory, as a user does.
  const project = path.join(tmp, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "someone-elses-project", version: "1.0.0", private: true }));
  const install = npm(["install", "--no-audit", "--no-fund", "--offline", tarball], project);
  assert.equal(install.status, 0, `local npm install of the tarball must exit 0:\n${install.stdout}\n${install.stderr}`);
  assert.doesNotMatch(install.stderr, /must be set up with bun/, "no contributor-only guard on a user install");

  const installedPkg = JSON.parse(fs.readFileSync(path.join(project, "node_modules", "cool-workflow", "package.json"), "utf8"));
  for (const name of INSTALL_SCRIPTS) {
    assert.equal((installedPkg.scripts || {})[name], undefined, `installed package.json must not have a "${name}" script`);
  }

  const cwBin = path.join(project, "node_modules", ".bin", "cw");
  assert.ok(fs.existsSync(cwBin), `installed bin exists: ${cwBin}`);
  const help = spawnSync(cwBin, ["help"], { cwd: project, env, encoding: "utf8" });
  assert.equal(help.status, 0, `installed \`cw help\` exits 0: ${help.stderr}`);
  assert.match(help.stdout, /\bcw\b/, "installed `cw help` prints help");
  const version = spawnSync(cwBin, ["version"], { cwd: project, env, encoding: "utf8" });
  assert.equal(version.status, 0, `installed \`cw version\` exits 0: ${version.stderr}`);
  assert.equal(version.stdout.trim(), pkg.version, "installed `cw version` matches package.json");

  // 4. The npx path (`npx -y cool-workflow help`): npm exec installs the
  //    package into its own cache and runs the bin. Same tarball, offline.
  const scratch = path.join(tmp, "scratch");
  fs.mkdirSync(scratch);
  const npx = npm(["exec", "--yes", "--offline", `--package=${tarball}`, "--", "cw", "help"], scratch);
  assert.equal(npx.status, 0, `npx-style run must exit 0:\n${npx.stdout}\n${npx.stderr}`);
  assert.match(npx.stdout, /\bcw\b/, "npx-style `cw help` prints help");

  console.log("npm-local-install-smoke: PASS (pack -> local install -> cw help; npx -> cw help)");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
