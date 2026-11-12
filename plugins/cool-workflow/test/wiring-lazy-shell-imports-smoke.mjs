#!/usr/bin/env node
// wiring-lazy-shell-imports-smoke — perf cycle P1-4.
//
// The command table (src/wiring/commands.ts) is loaded for EVERY command.
// Each row loads its shell module only inside its own handler, so a command
// that never touches a module never pays to load it: `cw --version` is a
// pure constant and must stay lean.
//
// Proven deterministically (not by timing -- see cycle P1-2's own note on
// why wall-clock assertions are flaky under this repo's concurrent test
// suite): a `--require`-injected hook records, at the load step of
// `module.registerHooks` (which sees `require()` and ES `import` alike;
// Node 22.15+), the path of every module actually loaded, for a handful of real
// `cw` invocations run as real child processes against the real
// dist/cli.js. A command that never touches a given capability must not
// load that capability's shell module at all; a command that does must.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import nodeModule from "node:module";
import { tmpDir } from "./helpers/workspace.mjs";

if (typeof nodeModule.registerHooks !== "function") {
  process.stdout.write(`wiring-lazy-shell-imports-smoke: skipped (module.registerHooks needs Node 22.15 or later; this is ${process.versions.node})\n`);
  process.exit(0);
}

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(pluginRoot, "dist/cli.js");

const hookDir = tmpDir("cw-lazy-hook-");
const hookPath = path.join(hookDir, "hook.js");
fs.writeFileSync(
  hookPath,
  [
    '"use strict";',
    'const Module = require("module");',
    'const fs = require("fs");',
    'const { fileURLToPath } = require("url");',
    "const loaded = new Set();",
    "Module.registerHooks({",
    "  load(url, context, nextLoad) {",
    '    if (url.startsWith("file:")) loaded.add(fileURLToPath(url));',
    "    return nextLoad(url, context);",
    "  },",
    "});",
    'process.on("exit", () => {',
    "  fs.writeFileSync(process.env.CW_LAZY_PROBE_OUT, JSON.stringify([...loaded]));",
    "});",
  ].join("\n"),
  "utf8"
);

/** Runs `dist/cli.js <args>` as a real child process with the module-load
 *  tracking hook injected, and returns the set of absolute module paths
 *  Node actually resolved+loaded during that one invocation. Does not care
 *  about the command's exit code -- an invocation can fail (e.g. status on
 *  a nonexistent run id) and still prove the shell module it needed got
 *  loaded on the way to that failure. */
function loadedModulesFor(args, cwd) {
  const outFile = path.join(tmpDir("cw-lazy-probe-"), "modules.json");
  spawnSync(process.execPath, ["--require", hookPath, cliPath, ...args], {
    cwd: cwd || pluginRoot,
    encoding: "utf8",
    env: { ...process.env, CW_LAZY_PROBE_OUT: outFile },
  });
  return new Set(JSON.parse(fs.readFileSync(outFile, "utf8")));
}

function loadedShellModule(loaded, relativeShellPath) {
  const suffix = `shell/${relativeShellPath}`;
  for (const p of loaded) if (p.endsWith(suffix)) return true;
  return false;
}

const HEAVY = ["commands/pipeline-cli.js", "commands/report-cli.js", "commands/report-view-cli.js", "commands/check-cli.js", "doctor.js", "drive.js", "run-store.js", "tamper-demo.js"];

try {
  // 1. `cw --version`: needs nothing but a pure constant.
  {
    const loaded = loadedModulesFor(["--version"]);
    for (const mod of HEAVY) {
      assert.equal(loadedShellModule(loaded, mod), false, `cw --version must not load shell/${mod} -- it doesn't need it`);
    }
    assert.ok(loaded.size < 30, `cw --version loaded ${loaded.size} modules total, expected a lean startup`);
  }

  // 2. Each command loads its own shell module, and not the drive or the others.
  for (const [args, needs, skips] of [
    [["doctor", "--json"], "doctor.js", ["commands/pipeline-cli.js", "commands/report-cli.js", "commands/check-cli.js", "drive.js", "tamper-demo.js"]],
    [["check", "list", "--json"], "commands/check-cli.js", ["commands/pipeline-cli.js", "commands/report-cli.js", "doctor.js", "drive.js", "tamper-demo.js"]],
    [["report", "definitely-not-a-real-run-id"], "commands/report-view-cli.js", ["commands/pipeline-cli.js", "commands/check-cli.js", "doctor.js", "drive.js", "tamper-demo.js"]],
  ]) {
    const loaded = loadedModulesFor(args, hookDir);
    assert.ok(loadedShellModule(loaded, needs), `cw ${args.join(" ")} must load shell/${needs} -- it is what does the work`);
    for (const mod of skips) {
      assert.equal(loadedShellModule(loaded, mod), false, `cw ${args.join(" ")} must not load shell/${mod} -- unrelated`);
    }
  }
} finally {
  fs.rmSync(hookDir, { recursive: true, force: true });
}

process.stdout.write("wiring-lazy-shell-imports-smoke: ok\n");
