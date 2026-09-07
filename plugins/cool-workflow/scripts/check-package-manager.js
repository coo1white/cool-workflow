#!/usr/bin/env node
"use strict";

// This file runs as the "preinstall" script in package.json, before npm,
// yarn, pnpm, or bun puts any files in place.
//
// This project is set up with bun, not npm, yarn, or pnpm — one tool, one
// lockfile (bun.lock), so every install is the same install. `npm run <x>`,
// `npm pack`, and `npm publish` do NOT run "preinstall" (npm only runs it on
// `npm install`/`npm ci`), so this guard never stops the operator's release
// command — it only stops a plain `npm install`/`npm ci` on a contributor's
// machine.
//
// A GLOBAL install (`npm install -g cool-workflow`, how a real user installs
// the published, zero-runtime-dependency CLI) DOES run this same script —
// checked by hand: npm runs a package's own lifecycle scripts on `-g`
// installs too — so it must be let through, not just assumed safe. npm sets
// npm_config_global to the string "true" only then (unset on a plain local
// install), so that case exits before the tool check below ever runs.
//
// How we know the tool: npm, pnpm, and bun each set an env var named
// npm_execpath to the path of its own script file, for example
// ".../npm-cli.js" for npm or ".bun/bin/bun" for bun. Only bun's own path
// has "bun" in it, so we look for that.
//
// npm and bun also set a second env var, npm_config_user_agent, to a string
// that starts with the tool's name — bun's starts with "bun/". This var can
// be empty on a first-run script, so we treat it as an extra check, only
// when it is there, and do not require it to be there.

const fs = require("node:fs");
const path = require("node:path");

if (process.env.npm_config_global === "true") process.exit(0);

const execPath = process.env.npm_execpath || "";
const userAgent = process.env.npm_config_user_agent || "";

const ranByBun = execPath.toLowerCase().includes("bun");
const userAgentOk = userAgent === "" || userAgent.startsWith("bun/");

if (!ranByBun || !userAgentOk) {
  console.error(`
This project must be set up with bun, not npm, yarn, or pnpm.

Please run:

  bun install

(tool path seen: ${execPath || "none"})
(tool tag seen: ${userAgent || "none"})
`);
  process.exit(1);
}

// THE RIGHT TOOL IS NOT ENOUGH — IT HAS TO BE THE RIGHT VERSION.
//
// This check only asked "is it bun". CI pins the exact version in
// `packageManager` below, so a laptop on a different bun could pass every
// local gate and still turn the CI gate red on a resolution CI does not see
// the same way. The version is read from `packageManager` — one number, not
// two to keep in step.
//
// A WARNING, NOT AN ERROR, and deliberately so: a hard failure here would
// stop `bun install` on the very machine that needs to run it, and the fix
// for a wrong bun is itself an install. The line below is what the reader
// needs; making it fatal would only make the way out harder.
let declared = "";
try {
  const pkgPath = path.join(__dirname, "..", "package.json");
  declared = (JSON.parse(fs.readFileSync(pkgPath, "utf8")).packageManager || "").replace(/^bun@/, "");
} catch (error) {
  console.error(
    `note: could not read packageManager from package.json (${error.message}); ` +
      "the bun version check below is not running.",
  );
}

// bun's user agent is `bun/<version> npm/? node/… <platform> <arch>`.
const running = userAgent.match(/^bun\/(\d+\.\d+\.\d+)/)?.[1] ?? "";

if (declared && running && running !== declared) {
  console.error(`
bun ${running} is running, but this project pins bun ${declared}.

CI uses the pinned one, so a difference here is a difference the gate will
find and you will not. To match it:

  bun upgrade --version ${declared}

(continuing anyway — a hard stop here would block the install that fixes it)
`);
}

process.exit(0);
