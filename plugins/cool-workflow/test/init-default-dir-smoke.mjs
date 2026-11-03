#!/usr/bin/env node
// init-default-dir-smoke — `cw init <id>` writes the new app to ./apps/<id>
// in the folder it runs in (a changed default in 0.3.3, the operator's yes
// of 2026-11-02 in project/docs/intent/2026-10-16-release-gate-ci.md;
// docs/init.7.md).
//
// Up to 0.3.2 the default was the `apps/` folder of the CW package that was
// running, which for an installed CW is inside node_modules: maybe not
// writable, and wiped on the next upgrade.
//   1. No flag: ./apps/<id>/{app.json,workflow.js}; nothing in the package.
//   2. The new app is found by id (`cw plan <id>` loads it) and validates.
//   3. CW_APPS_DIR, when set, is the default root instead.
//   4. --output DIR still wins over both.
//   5. `cw app list` run in that folder lists ./apps too (also new in 0.3.3),
//      next to the bundled apps; an id that is also a bundled one fails
//      closed (exit 1, "Duplicate workflow app id"), never shown twice.
//   6. Listing reads ./apps/*/app.json alone: it never runs their workflow.js
//      (phases and taskCount are null there); `cw app show <id>` loads it.
//      An app.json that is not a CW manifest (as an Expo app has)
//      is skipped: list, `cw list` and quickstart --check stay ok.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const work = tmpDir("cw-init-default-");

function cw(args, cwd, extraEnv = {}) {
  const env = { ...process.env, HOME: work, CW_HOME: path.join(work, "home"), ...extraEnv };
  if (!("CW_APPS_DIR" in extraEnv)) delete env.CW_APPS_DIR;
  return spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8", timeout: 60000 });
}

const packageApp = path.join(pluginRoot, "apps", "init-default-probe");
try {
  // 1 + 2
  {
    const dir = path.join(work, "project");
    fs.mkdirSync(dir);
    const r = cw(["init", "init-default-probe", "--json"], dir);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.manifestPath, path.join(dir, "apps", "init-default-probe", "app.json"));
    assert.ok(fs.existsSync(path.join(dir, "apps", "init-default-probe", "workflow.js")));
    assert.equal(fs.existsSync(packageApp), false, "nothing is written into the CW package's own apps/");

    const plan = cw(["plan", "init-default-probe", "--json"], dir);
    assert.doesNotMatch(plan.stderr + plan.stdout, /not found/i, `the new app is found by id from its folder: ${plan.stderr}`);
    const valid = cw(["app", "validate", "apps/init-default-probe", "--json"], dir);
    assert.equal(JSON.parse(valid.stdout).valid, true, "and it validates");

    // 5
    const list = cw(["app", "list", "--json"], dir);
    assert.equal(list.status, 0, list.stderr);
    const ids = JSON.parse(list.stdout).map((app) => app.id);
    assert.ok(ids.includes("init-default-probe"), `cw app list shows ./apps: ${ids}`);
    assert.ok(ids.includes("architecture-review"), "and still the bundled apps");
    const outside = cw(["app", "list", "--json"], work);
    assert.ok(!JSON.parse(outside.stdout).some((app) => app.id === "init-default-probe"), "only from that folder");

    // 6
    const marker = path.join(work, "workflow-ran");
    fs.appendFileSync(path.join(dir, "apps", "init-default-probe", "workflow.js"), `\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
    fs.mkdirSync(path.join(dir, "apps", "mobile"));
    fs.writeFileSync(path.join(dir, "apps", "mobile", "app.json"), JSON.stringify({ expo: { name: "mobile", slug: "mobile" } }));
    const listed = cw(["app", "list", "--json"], dir);
    assert.equal(listed.status, 0, `a non-CW app.json is skipped: ${listed.stderr}`);
    const probe = JSON.parse(listed.stdout).find((app) => app.id === "init-default-probe");
    assert.equal(probe.phases, null, "not loaded, so phases are not known");
    assert.equal(probe.taskCount, null);
    assert.equal(cw(["list", "--json"], dir).status, 0, "cw list too");
    assert.equal(fs.existsSync(marker), false, "listing never runs a ./apps workflow.js");
    const quick = JSON.parse(cw(["quickstart", "--check", "--json"], dir).stdout);
    assert.equal(quick.checks.find((c) => c.name === "app").status, "ok", "quickstart --check still finds its app");
    const show = cw(["app", "show", "init-default-probe", "--json"], dir);
    assert.equal(show.status, 0, show.stderr);
    assert.ok(JSON.parse(show.stdout).taskCount > 0, "cw app show <id> loads the app");
    assert.equal(fs.existsSync(marker), true, "asked for by id, its workflow.js runs");
    fs.rmSync(path.join(dir, "apps", "mobile"), { recursive: true });

    fs.cpSync(path.join(pluginRoot, "apps", "release-cut"), path.join(dir, "apps", "release-cut"), { recursive: true });
    const dup = cw(["app", "list", "--json"], dir);
    assert.notEqual(dup.status, 0, "a ./apps id that is also bundled fails closed");
    assert.match(dup.stderr + dup.stdout, /Duplicate workflow app id release-cut/);
  }
  // 3
  {
    const dir = path.join(work, "env-root");
    const root = path.join(work, "my-apps");
    fs.mkdirSync(dir);
    const r = cw(["init", "env-probe", "--json"], dir, { CW_APPS_DIR: root });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).manifestPath, path.join(root, "env-probe", "app.json"), "CW_APPS_DIR is the root when set");
  }
  // 4
  {
    const dir = path.join(work, "flag");
    fs.mkdirSync(dir);
    const out = path.join(work, "elsewhere");
    const r = cw(["init", "flag-probe", "--output", out, "--json"], dir, { CW_APPS_DIR: path.join(work, "ignored") });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).manifestPath, path.join(out, "app.json"), "--output wins");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(packageApp, { recursive: true, force: true });
}

console.log("init-default-dir-smoke: ok");
