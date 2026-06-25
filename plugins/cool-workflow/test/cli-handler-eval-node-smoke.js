#!/usr/bin/env node
"use strict";

// cli-handler-eval-node-smoke: the `cw eval` and `cw node` groups were carved
// out of the command-surface god-dispatch into src/cli/handlers/eval.ts and
// src/cli/handlers/node.ts. Guard the dispatcher->handler routing. We reason
// each assertion from io.ts `required` (throws "Missing <label>.") and the
// inner-switch Usage throws — NOT via the fail-closed gate/verify exit, so a
// bare verb missing its required positional surfaces the handler's own error.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
// Private state home so nothing reads/writes the host's CW state.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-eval-node-handler-"));
const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home };

function runFail(args) {
  try { execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8", env }); return { code: 0, stderr: "" }; }
  catch (e) { return { code: e.status, stderr: String(e.stderr || "") }; }
}

// --- eval routing through handleEval -----------------------------------------
let r = runFail(["eval"]);
assert.notEqual(r.code, 0, "cw eval (no subcommand) exits non-zero");
assert.match(r.stderr, /Usage: cw\.js eval snapshot/, "eval no-subcommand hits the handler usage throw");

r = runFail(["eval", "bogus"]);
assert.notEqual(r.code, 0, "cw eval bogus exits non-zero");
assert.match(r.stderr, /Usage: cw\.js eval snapshot/, "eval bogus hits the handler usage throw");

r = runFail(["eval", "snapshot"]);
assert.notEqual(r.code, 0, "cw eval snapshot (no run id) exits non-zero");
assert.match(r.stderr, /Missing run id/, "eval snapshot routes to required(run id)");

r = runFail(["eval", "gate"]);
assert.notEqual(r.code, 0, "cw eval gate (no suite id) exits non-zero");
assert.match(r.stderr, /Missing suite id or path/, "eval gate routes to required(suite id or path)");

// --- node routing through handleNode -----------------------------------------
const nodeUsage = /Usage: cw\.js node list\|show\|graph/;

r = runFail(["node"]);
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
process.stdout.write("cli-handler-eval-node-smoke: ok\n");
