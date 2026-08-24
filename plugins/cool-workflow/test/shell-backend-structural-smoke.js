"use strict";
// shell-backend-structural-smoke — proves the `shell` backend runs a
// command line with NO shell process (audit recommendation 7).
//
// Before: the guarded line went to spawnSync(..., { shell: true }) — a
// character the guard missed would have gone to /bin/sh. Now the guard
// refuses every control character, quote mark, and backslash, and the
// line is split on white space and spawned as plain argv, shell:false.
//   1. guard    — the old control set AND the new quote/backslash set are
//                 refused with the byte-exact message.
//   2. argv     — a guard-clean line reaches the child as exact argv
//                 (proved by a child that prints its own argv).
//   3. metachar — a metacharacter smuggled INTO one arg is refused, so it
//                 can never reach a child at all, let alone a shell.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { runBackend } = require(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"));
const { checkShellGuard } = require(path.join(pluginRoot, "dist/shell/execution-backend/local.js"));
const { sha256 } = require(path.join(pluginRoot, "dist/core/hash.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));

const REFUSAL = "Shell backend refused: args contain shell control characters. Use the node, bun, or agent backend instead for untrusted inputs.";

function assertRefused(command, args, why) {
  assert.throws(
    () => checkShellGuard(command, args),
    (e) => e.message === REFUSAL,
    `guard must refuse ${why} with the byte-exact message`
  );
}

function main() {
  // ---- 1. guard: old set still refused, quote/backslash now refused ----
  assertRefused("echo", ["a;b"], "a semicolon (old set)");
  assertRefused("echo", ["$(id)"], "command substitution (old set)");
  assertRefused("echo", ["it's"], "a single quote (new set)");
  assertRefused("echo", ['say "hi"'], "a double quote (new set)");
  assertRefused("echo", ["a\\b"], "a backslash (new set)");
  // A clean line passes the guard.
  checkShellGuard("echo", ["plain", "words", "only"]);

  // ---- 2. argv: the child sees the exact white-space-split tokens ------
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-shell-structural-"));
  try {
    const probe = path.join(work, "argv-probe.js");
    fs.writeFileSync(probe, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n", "utf8");
    const ctx = sandboxContextForValidation(pluginRoot);
    const readonly = showBundledSandboxProfile("readonly", ctx);

    const clean = runBackend({
      schemaVersion: 1,
      cwd: work,
      sandboxPolicy: readonly,
      label: "shell-structural-argv",
      backendId: "shell",
      command: process.execPath,
      args: [probe, "x", "y"]
    });
    assert.equal(clean.status, "completed", `clean line completes (evidence: ${JSON.stringify(clean.evidence)})`);
    const stdoutEntry = clean.evidence.find((e) => e.startsWith("stdoutSha256:"));
    assert.equal(
      stdoutEntry,
      `stdoutSha256:${sha256(JSON.stringify(["x", "y"]))}`,
      "child argv is exactly the white-space-split tokens"
    );

    // ---- 3. a metachar inside one arg never reaches any child ----------
    assert.throws(
      () => runBackend({
        schemaVersion: 1,
        cwd: work,
        sandboxPolicy: readonly,
        label: "shell-structural-refused",
        backendId: "shell",
        command: process.execPath,
        args: [probe, "x;id"]
      }),
      (e) => e.message === REFUSAL,
      "a smuggled metachar is refused before any spawn"
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  process.stdout.write("shell-backend-structural-smoke: PASS\n");
}

main();
