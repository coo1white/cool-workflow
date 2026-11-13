#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";
import { writeProgram } from "./helpers/program.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const releaseCheck = path.join(pluginRoot, "scripts", "release-check.mjs");
const tmp = tmpDir("cw-release-check-skip-");
const bin = path.join(tmp, "bin");
const log = path.join(tmp, "commands.log");
fs.mkdirSync(bin);

// A node stub for npm (the only program release-check starts), so it starts
// on Windows too: there an sh script on PATH is not a program.
writeProgram(bin, "npm", `const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, "npm " + process.argv.slice(2).join(" ") + "\\n");
`);

const result = spawnSync(process.execPath, [releaseCheck, "--skip-tests"], {
  cwd: pluginRoot,
  encoding: "utf8",
  env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` },
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /release:check tests \.\.\. skipped/);
assert.match(result.stdout, /- SKIP tests/);

const commands = fs.readFileSync(log, "utf8");
assert.doesNotMatch(commands, /npm run test:ci/, "skip-tests must not run the smoke suite twice");
assert.match(commands, /npm run dist:check/, "other release gates still run");
