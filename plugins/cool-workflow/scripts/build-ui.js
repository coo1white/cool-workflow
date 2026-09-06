#!/usr/bin/env node
// build-ui — build the Workbench Next export (ui/workbench/out/). out/ is
// not committed: Turbopack chunk names differ by platform. Runs at
// prepack and in CI. Skips with a note when bun is not on PATH or Node
// is below 20 (Next 16 needs 20.9), so `npm pack` in a smoke test on an
// old Node still works; the host then falls back to the old files. All
// output goes to stderr: `npm pack --json` owns stdout. A dry-run pack
// (npm sets npm_config_dry_run) skips the build too.
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const major = Number(process.versions.node.split(".")[0]);
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore", shell: false }).status === 0;
const dryRun = process.env.npm_config_dry_run === "true";
if (major < 20 || !hasBun || dryRun) {
  console.error(`build-ui: skipped (node ${process.versions.node}, bun ${hasBun ? "found" : "missing"}${dryRun ? ", dry-run pack" : ""}); out/ stays as it is`);
  process.exit(0);
}
const cwd = path.join(__dirname, "..", "ui", "workbench");
for (const args of [["install", "--frozen-lockfile"], ["run", "build"]]) {
  const r = spawnSync("bun", args, { cwd, stdio: ["ignore", 2, 2], shell: false });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
}
