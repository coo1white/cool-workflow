// package-manager-gate-smoke — the bun gate from spec.md R8 (source text
// only). Red when: packageManager is not the exact bun pin; bun.lock is
// missing; a package-lock.json, pnpm-lock.yaml, or yarn.lock is present;
// node_modules/.package-lock.json is present (npm writes it on an install,
// bun never does, so it is a mark of a plain `npm install` in the
// checkout); package.json has an install-time script (preinstall, install,
// postinstall — one there ships to every user install); bunfig.toml lacks
// [install] exact = true; or a line under .github/workflows/ installs with
// npm ci, npm install, pnpm install, or yarn install (a plain `npm install
// -g <tool>`, pinning a global CLI, is not a project-dependency install and
// stays green — see npm-publish.yml). The last part copies a bad tree into
// a temp dir and checks the gate goes red on every one of these, then runs a
// real `npm install` in a copy of package.json and checks the gate catches it.
//
// Why no "preinstall" guard any more: package.json ships in the tarball, so a
// guard there ran on every USER install too and broke `npm i cool-workflow`
// and `npx cool-workflow` (0.2.8 to 0.3.2). The bun pin is held here and in
// CI (setup-bun with the exact version, `bun install --frozen-lockfile`), not
// by a script every user runs. See test/npm-local-install-smoke.mjs.
// @cw-smoke: tags gate,bun
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PIN = "bun@1.4.1";
const SECOND_LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];
// npm's own hidden lockfile, written into node_modules by an npm install.
const NPM_HIDDEN_LOCK = path.join("node_modules", ".package-lock.json");
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
  if (fs.existsSync(path.join(pluginRoot, NPM_HIDDEN_LOCK))) faults.push(`${NPM_HIDDEN_LOCK} present: node_modules was installed by npm, not bun`);
  for (const name of INSTALL_SCRIPTS) {
    if (pkg.scripts && pkg.scripts[name] !== undefined) faults.push(`package.json has a "${name}" script; it would run on every user install`);
  }
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

const pluginRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
assert.deepStrictEqual(gate(repoRoot, pluginRoot), [], "the real tree must pass the bun gate");

// The gate must still bite: a bad copy in a temp dir goes red on all seven
// checks (one second-lock filename and one install script are enough — each
// loop body is the same for every name in its list).
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
fs.mkdirSync(path.join(badPlugin, "node_modules"));
fs.writeFileSync(path.join(badPlugin, NPM_HIDDEN_LOCK), "{}");
fs.writeFileSync(path.join(tmp, ".github", "workflows", "bad.yml"), "steps:\n  - run: npm ci --ignore-scripts\n");
const red = gate(tmp, badPlugin);
assert.strictEqual(red.length, 7, red.join("\n"));

// A contributor who runs a plain `npm install` in the checkout is caught.
// A copy of the real package.json with no dependencies (so npm needs no
// network) plus the real bun.lock and bunfig.toml: green before, red after.
const contribRoot = path.join(tmp, "contrib");
const contrib = path.join(contribRoot, "plugins", "cool-workflow");
fs.mkdirSync(contrib, { recursive: true });
const realPkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
delete realPkg.dependencies;
delete realPkg.devDependencies;
fs.writeFileSync(path.join(contrib, "package.json"), JSON.stringify(realPkg, null, 2));
for (const name of ["bun.lock", "bunfig.toml"]) fs.copyFileSync(path.join(pluginRoot, name), path.join(contrib, name));
assert.deepStrictEqual(gate(contribRoot, contrib), [], "the clean copy starts green");
const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)));
npmEnv.npm_config_cache = path.join(tmp, "npm-cache");
npmEnv.npm_config_update_notifier = "false";
const npmInstall = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--offline"], { cwd: contrib, env: npmEnv, encoding: "utf8" });
assert.strictEqual(npmInstall.status, 0, `npm install in the copy: ${npmInstall.stderr}`);
const caught = gate(contribRoot, contrib);
fs.rmSync(tmp, { recursive: true, force: true });
assert.ok(caught.some((fault) => fault.startsWith("second lockfile present: package-lock.json")), `a plain npm install must turn the gate red: ${caught.join("; ") || "no faults"}`);
console.log("package-manager-gate-smoke: PASS");
