#!/usr/bin/env node
// cw-help-per-command-smoke: `cw help <verb>` and `cw <verb> --help` render the
// verb's subcommands + one-line summaries from the command table
// (src/wiring/commands.ts, the same rows the dispatcher runs), plus each
// row's flags.
//
// `cw help check` lists `cw check list` and `cw check show`; `cw help report`
// lists bundle and verify-bundle — each verb's rows, not just the verb itself.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;

function run(args) {
  return execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8" });
}

// `cw help <verb>` lists subcommands + registry summaries.
const check = run(["help", "check"]);
assert.match(check, /^cw check/m, "per-command help headers the verb");
assert.match(check, /cw check show <receipt-id>/, "per-command help lists subcommands from the table");
assert.match(check, /List the receipts in this folder/, "per-command help shows the row summaries");

// `cw <verb> --help` is an alias for `cw help <verb>` (byte-identical).
const reportFlag = run(["report", "--help"]);
const reportPositional = run(["help", "report"]);
assert.equal(reportFlag, reportPositional, "`cw report --help` === `cw help report`");
assert.match(reportFlag, /cw report verify-bundle <bundle>/, "verb --help renders the verb's subcommands");
assert.match(reportFlag, /--require-signatures/, "verb --help renders each row's flags");

// Unknown verb fails SOFT (exit 0, no throw) with a recovery hint back to full help.
const unknown = run(["help", "definitely-not-a-cmd"]);
assert.match(unknown, /Unknown command: definitely-not-a-cmd/, "unknown verb is named");
assert.match(unknown, /cw help/, "unknown verb points back to the full help");

// Bare `cw help` still prints the general help and advertises per-command help.
const general = run(["help"]);
assert.match(general, /Cool Workflow/, "general help still renders");
assert.match(general, /cw help <command>/, "general help advertises per-command help");

process.stdout.write("cw-help-per-command-smoke: ok\n");
