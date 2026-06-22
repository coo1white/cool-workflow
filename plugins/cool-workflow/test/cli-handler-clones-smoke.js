#!/usr/bin/env node
"use strict";

// cli-handler-clones-smoke: the `cw clones` group was carved out of the
// command-surface god-dispatch into src/cli/handlers/clones.ts. Guard the
// dispatcher->handler routing and the verb's shape (robust to cache contents).

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
// Private state home so the clones cache is empty + deterministic, never the host's.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-clones-handler-"));
const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home };

function run(args) {
  return execFileSync(node, [cli, ...args], { cwd: pluginRoot, encoding: "utf8", env });
}
function runFail(args) {
  try { run(args); return { code: 0, stderr: "" }; }
  catch (e) { return { code: e.status, stderr: String(e.stderr || "") }; }
}

// `cw clones list --json` routes through the handler and returns the structured shape.
const list = JSON.parse(run(["clones", "list", "--json"]));
assert.equal(typeof list.count, "number", "clones list --json has a count");
assert.ok("clonesDir" in list && Array.isArray(list.entries), "clones list --json has clonesDir + entries");

// `cw clones gc --json` (nothing to reclaim in a fresh home) also routes + returns shape.
const gc = JSON.parse(run(["clones", "gc", "--json"]));
assert.ok("removed" in gc && "keptCount" in gc, "clones gc --json has removed + keptCount");

// No / unknown subcommand hits the handler's usage error (exit 1).
for (const args of [["clones"], ["clones", "bogus"]]) {
  const r = runFail(args);
  assert.equal(r.code, 1, `cw ${args.join(" ")} exits non-zero`);
  assert.match(r.stderr, /clones list .* \| clones gc/, "handler usage string surfaces");
}

fs.rmSync(home, { recursive: true, force: true });
process.stdout.write("cli-handler-clones-smoke: ok\n");
