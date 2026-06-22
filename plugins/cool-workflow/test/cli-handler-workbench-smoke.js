#!/usr/bin/env node
"use strict";

// cli-handler-workbench-smoke: the `cw workbench` group was carved out of the
// command-surface god-dispatch into src/cli/handlers/workbench.ts. Guard that the
// dispatcher still routes to the handler and the verb's behaviour is unchanged.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;

function run(args) {
  return execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8" });
}
function runFail(args) {
  try { run(args); return { code: 0, stderr: "" }; }
  catch (e) { return { code: e.status, stderr: String(e.stderr || "") }; }
}

// `cw workbench serve --once` emits the descriptor (no server) via the handler.
const desc = JSON.parse(run(["workbench", "serve", "--once"]));
assert.equal(desc.surface, "workbench", "serve --once returns the workbench descriptor");
assert.equal(desc.schemaVersion, 1);

// No subcommand and an unknown subcommand both hit the handler's usage error (exit 1).
for (const args of [["workbench"], ["workbench", "bogus"]]) {
  const r = runFail(args);
  assert.equal(r.code, 1, `cw ${args.join(" ")} exits non-zero`);
  assert.match(r.stderr, /workbench serve .* \| view <run-id>/, "handler usage string surfaces");
}

process.stdout.write("cli-handler-workbench-smoke: ok\n");
