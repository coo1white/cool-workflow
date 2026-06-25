#!/usr/bin/env node
"use strict";

// cli-handler-maintenance-smoke: the `cw gc`, `cw telemetry`, and `cw demo`
// groups were carved out of the command-surface god-dispatch into
// src/cli/handlers/maintenance.ts. Guard the dispatcher->handler routing and
// each group's usage shape. Routing is asserted via the required/usage path
// (bare verb, bogus subcommand, and gc verify's `Missing run id`), NOT via the
// fail-closed exit gates — those depend on registry/ledger contents a fresh
// home lacks, so they would exit 0 here and prove nothing about routing.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
// Private state home so the registry/ledger are empty + deterministic, never the host's.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-maintenance-handler-"));
const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home };

function run(args) {
  return execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8", env });
}
function runFail(args) {
  try { run(args); return { code: 0, stderr: "" }; }
  catch (e) { return { code: e.status, stderr: String(e.stderr || "") }; }
}

// gc: bare verb + unknown subcommand hit the handler's usage error (exit !=0).
for (const args of [["gc"], ["gc", "bogus"]]) {
  const r = runFail(args);
  assert.notEqual(r.code, 0, `cw ${args.join(" ")} exits non-zero`);
  assert.match(r.stderr, /gc plan\|run\|verify/, "gc usage string surfaces");
}
// gc verify with no run id routes into the handler AND trips required() — proves
// the verify subcommand reaches its `required(id, "run id")` guard.
{
  const r = runFail(["gc", "verify"]);
  assert.notEqual(r.code, 0, "cw gc verify (no run id) exits non-zero");
  assert.match(r.stderr, /Missing run id/, "gc verify routes + required wired");
}

// telemetry: bare verb + unknown subcommand hit the handler's usage error.
// (NOTE: `telemetry verify` with no id does NOT call required — it tolerates an
// absent ledger and exits 0; so routing is asserted via the bare/bogus path.)
for (const args of [["telemetry"], ["telemetry", "bogus"]]) {
  const r = runFail(args);
  assert.notEqual(r.code, 0, `cw ${args.join(" ")} exits non-zero`);
  assert.match(r.stderr, /telemetry verify <run-id>/, "telemetry usage string surfaces");
}

// demo: bare verb + unknown subcommand hit the handler's usage error.
for (const args of [["demo"], ["demo", "bogus"]]) {
  const r = runFail(args);
  assert.notEqual(r.code, 0, `cw ${args.join(" ")} exits non-zero`);
  assert.match(r.stderr, /demo tamper\|bundle/, "demo usage string surfaces");
}

// Hermetic + already-proven-safe: `demo bundle --json` routes through the
// handler, runs the self-contained bundle demo, and proves it (exit 0).
{
  const bundle = JSON.parse(run(["demo", "bundle", "--json"]));
  assert.equal(bundle.proven, true, "demo bundle --json routes + proves the bundle guarantee");
}

fs.rmSync(home, { recursive: true, force: true });
process.stdout.write("cli-handler-maintenance-smoke: ok\n");
