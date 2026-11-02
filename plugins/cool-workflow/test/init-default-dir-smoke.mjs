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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-init-default-")));

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
