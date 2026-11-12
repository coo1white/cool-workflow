#!/usr/bin/env node
// cli-handler-maintenance-smoke: the `cw telemetry` and `cw demo` groups
// were carved out of the old command-surface god-dispatch into their own
// telemetry/demo handlers. Guard the dispatcher->handler routing and each
// group's usage shape. Routing is asserted via the usage path (bare verb
// and bogus subcommand), NOT via the
// fail-closed exit gates — those depend on registry/ledger contents a fresh
// home lacks, so they would exit 0 here and prove nothing about routing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
// Private state home so the registry/ledger are empty + deterministic, never the host's.
const home = tmpDir("cw-maintenance-handler-");
const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home };

function run(args) {
  return execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8", env });
}
function runFail(args) {
  try { run(args); return { code: 0, stderr: "" }; }
  catch (e) { return { code: e.status, stderr: String(e.stderr || "") }; }
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
  assert.match(r.stderr, /demo tamper \[--json\]/, "demo usage string surfaces");
}

// `demo bundle` went with the frozen surfaces: it is a bogus subcommand
// now and trips the same usage error.
{
  const r = runFail(["demo", "bundle", "--json"]);
  assert.notEqual(r.code, 0, "cw demo bundle exits non-zero");
  assert.match(r.stderr, /Usage: cw demo tamper \[--json\]/, "demo bundle is gone");
}

fs.rmSync(home, { recursive: true, force: true });
process.stdout.write("cli-handler-maintenance-smoke: ok\n");
