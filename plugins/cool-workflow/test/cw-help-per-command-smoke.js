#!/usr/bin/env node
"use strict";

// cw-help-per-command-smoke: `cw help <verb>` and `cw <verb> --help` render the
// verb's CLI subcommands + one-line summaries derived from CAPABILITY_REGISTRY
// (the same table the dispatcher and CLI/MCP parity check use). Additive: the
// bare `cw help` general output is unchanged except a 4-space discoverability note.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;

function run(args) {
  return execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8" });
}

// `cw help <verb>` lists subcommands + registry summaries.
const commit = run(["help", "commit"]);
assert.match(commit, /^cw commit/m, "per-command help headers the verb");
assert.match(commit, /cw commit summary/, "per-command help lists subcommands from the registry");
assert.match(commit, /commit summary for a run/i, "per-command help shows registry summaries");

// `cw <verb> --help` is an alias for `cw help <verb>` (byte-identical).
const workerFlag = run(["worker", "--help"]);
const workerPositional = run(["help", "worker"]);
assert.equal(workerFlag, workerPositional, "`cw worker --help` === `cw help worker`");
assert.match(workerFlag, /cw worker list/, "verb --help renders the verb's subcommands");

// Unknown verb fails SOFT (exit 0, no throw) with a recovery hint back to full help.
const unknown = run(["help", "definitely-not-a-cmd"]);
assert.match(unknown, /Unknown command: definitely-not-a-cmd/, "unknown verb is named");
assert.match(unknown, /cw help/, "unknown verb points back to the full help");

// Bare `cw help` still prints the general help and advertises per-command help.
const general = run(["help"]);
assert.match(general, /Cool Workflow/, "general help still renders");
assert.match(general, /cw help <command>/, "general help advertises per-command help");

process.stdout.write("cw-help-per-command-smoke: ok\n");
