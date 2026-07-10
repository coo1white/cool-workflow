#!/usr/bin/env node
"use strict";
// @cw-smoke: tags fast

// cli-epipe-smoke — `cw <verb> --json | head -1` (any reader that goes away
// early) must NOT crash the CLI with an unhandled `write EPIPE` stack trace.
//
// Before the fix, a bare `process.stdout.write` after the read end of the
// pipe was closed made an async 'error' event on process.stdout; main()'s
// promise .catch never sees a stream event, so node came down hard:
// exit 1 + "Unhandled 'error' event ... Error: write EPIPE" on stderr.
// The fix is ONE process-level 'error' listener in cli/entry.ts's main()
// (exitQuietOnEpipe) that covers every raw write point: on EPIPE the CLI
// stops quietly with exit 0; any other stream error still comes up as
// before.
//
// The test spawns the REAL built CLI (dist/cli.js) with stdout piped and
// closes the read end at once — before the child even boots — so the
// child's first stdout write is certain to hit a broken pipe (no race).
// Both output forms are covered: --json (printJson) and human text (help).
// The bar: exit 0, empty stderr, for every run.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;

function runWithBrokenPipe(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [cli, ...args], {
      cwd: pluginRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Close OUR read end of the child's stdout pipe right away. The child
    // is still booting, so its first write to stdout is certain to see a
    // broken pipe — this is the deterministic form of `cw ... | head -1`
    // where head goes away before cw is done writing.
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}

async function main() {
  let passed = 0;
  // One --json verb (printJson path) and one human-text verb (raw help
  // write) — the two output shapes a downstream `head` cuts short.
  const cases = [
    ["list", "--json"],
    ["help"],
  ];
  for (const args of cases) {
    // Run each case 3 times: the old crash was an async event, so a single
    // green run could hide a race. All runs must be clean.
    for (let i = 0; i < 3; i++) {
      const { code, signal, stderr } = await runWithBrokenPipe(args);
      const label = `cw ${args.join(" ")} (run ${i + 1})`;
      assert.equal(signal, null, `${label}: no signal kill, got ${signal}`);
      assert.equal(code, 0, `${label}: broken pipe must exit 0, got ${code}\nstderr:\n${stderr}`);
      assert.equal(stderr, "", `${label}: broken pipe must print NOTHING on stderr, got:\n${stderr}`);
      assert.ok(!stderr.includes("EPIPE"), `${label}: no EPIPE stack trace`);
      passed += 1;
    }
  }
  console.log(
    `cli-epipe-smoke: ok (${passed} runs — --json and human output both exit 0, silent, when the pipe reader goes away early)`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
