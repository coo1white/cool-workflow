// package-manager-gate-smoke — the bun gate from spec.md R8 (source text
// only). Red when: packageManager is not the exact bun pin; bun.lock is
// missing; a package-lock.json, pnpm-lock.yaml, or yarn.lock is present;
// preinstall does not name check-package-manager.js; bunfig.toml lacks
// [install] exact = true; or a line under .github/workflows/ installs with
// npm ci, npm install, pnpm install, or yarn install (a plain `npm install
// -g <tool>`, pinning a global CLI, is not a project-dependency install and
// stays green — see npm-publish.yml). The last part copies a bad tree into
// a temp dir and checks the gate goes red on every one of these.
// @cw-smoke: tags gate,bun
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PIN = "bun@1.4.1";
const SECOND_LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
// A bare install, not "install -g <tool>" (a global CLI pin, not a
// project-dependency install — see npm-publish.yml's `npm install -g npm@…`).
const INSTALL_LINE = /\b(npm ci|npm install(?!\s+-g\b)|pnpm install|yarn install)\b/;

/** Every fault the gate finds in one repo tree: pluginRoot = plugins/cool-workflow,
 *  repoRoot = the repo root above it (holds .github/workflows). */
function gate(repoRoot, pluginRoot) {
  const faults = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
  if (pkg.packageManager !== PIN) faults.push(`packageManager is ${pkg.packageManager || "unset"}, pin is ${PIN}`);
  if (!fs.existsSync(path.join(pluginRoot, "bun.lock"))) faults.push("bun.lock is missing");
  for (const name of SECOND_LOCKS) {
    if (fs.existsSync(path.join(pluginRoot, name))) faults.push(`second lockfile present: ${name}`);
  }
  const preinstall = (pkg.scripts && pkg.scripts.preinstall) || "";
  if (!preinstall.includes("check-package-manager.js")) faults.push(`preinstall does not name check-package-manager.js: ${preinstall || "unset"}`);
  const bunfigPath = path.join(pluginRoot, "bunfig.toml");
  const bunfig = fs.existsSync(bunfigPath) ? fs.readFileSync(bunfigPath, "utf8") : "";
  if (!/\bexact\s*=\s*true\b/.test(bunfig)) faults.push("bunfig.toml missing [install] exact = true");
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  if (fs.existsSync(workflowsDir)) {
    for (const name of fs.readdirSync(workflowsDir)) {
      if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
      const lines = fs.readFileSync(path.join(workflowsDir, name), "utf8").split("\n");
      for (const line of lines) {
        if (INSTALL_LINE.test(line) && !/^\s*#/.test(line)) faults.push(`${name} installs with npm/pnpm/yarn: ${line.trim()}`);
      }
    }
  }
  return faults;
}

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
assert.deepStrictEqual(gate(repoRoot, pluginRoot), [], "the real tree must pass the bun gate");

// The gate must still bite: a bad copy in a temp dir goes red on all six
// checks (one second-lock filename is enough — SECOND_LOCKS' loop body is
// identical for each of the three).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-package-manager-gate-"));
const badPlugin = path.join(tmp, "plugins", "cool-workflow");
fs.mkdirSync(path.join(tmp, ".github", "workflows"), { recursive: true });
fs.mkdirSync(badPlugin, { recursive: true });
fs.writeFileSync(
  path.join(badPlugin, "package.json"),
  JSON.stringify({ name: "bad", packageManager: "npm@11.5.1", scripts: { preinstall: "echo nope" } })
);
// No bun.lock, no bunfig.toml — both faults fire from absence alone.
fs.writeFileSync(path.join(badPlugin, "package-lock.json"), "{}");
fs.writeFileSync(path.join(tmp, ".github", "workflows", "bad.yml"), "steps:\n  - run: npm ci --ignore-scripts\n");
const red = gate(tmp, badPlugin);
fs.rmSync(tmp, { recursive: true, force: true });
assert.strictEqual(red.length, 6, red.join("\n"));
console.log("package-manager-gate-smoke: PASS");
