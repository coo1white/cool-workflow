#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const srcEntrypoint = path.join(pluginRoot, "src", "cli.ts");
const srcCommandSurface = path.join(pluginRoot, "src", "cli", "command-surface.ts");

const entrypoint = fs.readFileSync(srcEntrypoint, "utf8");
const entrypointLines = entrypoint.trimEnd().split(/\r?\n/);

assert.ok(fs.existsSync(srcCommandSurface), "CLI command handling must live under src/cli/");
assert.ok(entrypointLines.length <= 80, `src/cli.ts must stay a thin entrypoint, got ${entrypointLines.length} lines`);
assert.match(entrypoint, /from "\.\/cli\/command-surface"/, "src/cli.ts must delegate to the command surface module");
assert.doesNotMatch(entrypoint, /\bswitch\s*\(/, "src/cli.ts must not own the command dispatcher");
assert.doesNotMatch(entrypoint, /case\s+"[^"]+":/, "src/cli.ts must not own command cases");

const commandSurface = fs.readFileSync(srcCommandSurface, "utf8");
assert.match(commandSurface, /export async function runCli\b/, "command surface must export runCli");
assert.match(commandSurface, /parseArgv\(/, "command surface must preserve parseArgv-based CLI parsing");

process.stdout.write(`cli-command-surface-smoke: ok (${entrypointLines.length} entrypoint lines)\n`);
