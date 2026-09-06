#!/usr/bin/env node
// mirror-to-gitea — push every ref of this repo to the Gitea backup copy.
// The main copy stays on GitHub (Pages and npm publish run there); Gitea
// is a mirror only. Credentials come from git's own credential helper
// (the macOS keychain), never from this file. Run by hand or from a
// launchd job:  node scripts/mirror-to-gitea.js
"use strict";
const { spawnSync } = require("node:child_process");
const r = spawnSync("git", ["push", "--mirror", "https://git.coolwhite.space/coo1white/cool-workflow.git"], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
