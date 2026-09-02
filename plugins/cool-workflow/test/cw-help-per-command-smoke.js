#!/usr/bin/env node
"use strict";

// cw-help-per-command-smoke: `cw help <verb>` and `cw <verb> --help` render the
// verb's CLI subcommands + one-line summaries derived from CAPABILITY_REGISTRY
// (the same table the dispatcher and CLI/MCP parity check use). Additive: the
// bare `cw help` general output is unchanged except a 4-space discoverability note.
//
// CUTOVER AUDIT (v2) — no import to repoint: this smoke only shells out to the
// real CLI (dist/cli.js via execFileSync), so it does NOT crash on the old
// flat-dist layout. It fails on GENUINE v2 behavior. Classification: REAL-GAP.
//
// v2 drops per-command subcommand rows the old build listed:
//   1. `cw commit summary` — GONE as a CLI subcommand AND as a help row.
//      Old: the old build's capability registry module had commit.summary with
//        cli: { path: ["commit","summary"], jsonMode: "flag" }, surface "both".
//      v2: src/core/capability-table.ts keeps only the MCP tool
//        (cw_commit_summary); NO attachCliBinding for commit.summary, and
//        `commit` is absent from COMMAND_HELP_ROWS in src/core/format/help.ts.
//        So `cw help commit` shows only `cw commit`, and `cw commit summary`
//        mis-dispatches ("summary" is read as a positional runId).
//   2. `cw worker list` (and worker show/manifest/output/fail/validate) — the
//      CLI still dispatches (through the worker.usage catch-all,
//      src/core/capability-table.ts addCliOnlyCapability, hiddenFromHelp),
//      but the per-subcommand HELP rows are gone: only worker.summary has a
//      non-hidden cli binding (src/core/capability-table.ts), so
//      `cw help worker` shows only `cw worker summary`.
// The registry data still EXISTS in v2 (both capabilities are live rows); v2
// just no longer surfaces them via `cw help <verb>` (and, for commit.summary,
// no longer exposes the CLI subcommand at all). Assertions below are LEFT
// FAILING on purpose — the intent (help lists the verb's registry subcommands)
// is unchanged; do not weaken them to force green. Phase B must restore the
// commit.summary CLI binding + the per-subcommand worker help rows.

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
