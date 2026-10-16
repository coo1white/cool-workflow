#!/usr/bin/env node
"use strict";

// cli-handler-node-smoke: the `cw node` group was carved out of the old
// command-surface god-dispatch into its own node handler. Guard the
// dispatcher->handler routing. We reason each assertion from io.ts
// `required` (throws "Missing <label>.") and the inner-switch Usage throws —
// NOT via the fail-closed verify exit, so a bare verb missing its required
// positional surfaces the handler's own error. (The `cw eval` half of this
// smoke went with the multi-agent family, slim-and-esm step 2.)

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
// Private state home so nothing reads/writes the host's CW state.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-node-handler-"));
const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home };

function runFail(args) {
  try { execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8", env }); return { code: 0, stderr: "" }; }
  catch (e) { return { code: e.status, stderr: String(e.stderr || "") }; }
}

// --- node routing through handleNode -----------------------------------------
const nodeUsage = /Usage: cw node list\|show\|graph/;

let r = runFail(["node"]);
assert.notEqual(r.code, 0, "cw node (no subcommand) exits non-zero");
assert.match(r.stderr, nodeUsage, "node no-subcommand hits the handler usage throw");

r = runFail(["node", "bogus"]);
assert.notEqual(r.code, 0, "cw node bogus exits non-zero");
assert.match(r.stderr, nodeUsage, "node bogus hits the handler usage throw");

r = runFail(["node", "list"]);
assert.notEqual(r.code, 0, "cw node list (no run id) exits non-zero");
assert.match(r.stderr, /Missing run id/, "node list routes to required(run id)");

// `node graph` proves the formatOperatorGraph branch is reachable through handleNode.
r = runFail(["node", "graph"]);
assert.notEqual(r.code, 0, "cw node graph (no run id) exits non-zero");
assert.match(r.stderr, /Missing run id/, "node graph routes to required(run id)");

r = runFail(["node", "verify"]);
assert.notEqual(r.code, 0, "cw node verify (no run id) exits non-zero");
assert.match(r.stderr, /Missing run id/, "node verify routes to required(run id)");

fs.rmSync(home, { recursive: true, force: true });
process.stdout.write("cli-handler-node-smoke: ok\n");
