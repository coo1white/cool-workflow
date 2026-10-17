#!/usr/bin/env node
// mirror-to-gitea — push every ref of this repo to the Gitea backup copy.
// The main copy stays on GitHub (Pages and npm publish run there); Gitea
// is a mirror only. The mirror's address lives in this clone's `gitea`
// remote, not in this public file; credentials come from git's own
// credential helper (the macOS keychain). Run by hand or from a launchd
// job:  node scripts/mirror-to-gitea.js
"use strict";
const { spawnSync } = require("node:child_process");
const has = spawnSync("git", ["remote", "get-url", "gitea"], { stdio: "ignore" });
if (has.status !== 0) {
  console.error("mirror-to-gitea: no `gitea` remote in this clone. Add it once:\n  git remote add gitea https://<your-gitea-host>/coo1white/cool-workflow.git");
  process.exit(1);
}
const r = spawnSync("git", ["push", "--mirror", "gitea"], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
