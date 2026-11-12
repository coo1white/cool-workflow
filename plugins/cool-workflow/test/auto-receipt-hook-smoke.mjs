#!/usr/bin/env node
// auto-receipt-hook-smoke — the Claude Code PreToolUse hook that turns a
// plain test command into `cw check --tee -- <command>`
// (scripts/auto-receipt-hook.mjs, docs/reference.md "Test runs in Claude
// Code"):
//   a test command is rewritten, with the other tool_input fields kept and
//   no permissionDecision (the hook never approves anything);
//   a compound command, a non-test command, an opt-out, a missing `cw` and
//   bad input are left alone (exit 0, no output);
//   hooks/hooks.json runs it on Bash next to the tag guard;
//   end to end: the rewritten command, run by a shell in a temp git repo,
//   passes the test's stdout, stderr and exit code through and leaves a
//   receipt in .cw/receipts/.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CLI } from "./helpers/cw.mjs";
import { tmpDir } from "./helpers/workspace.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, "scripts", "auto-receipt-hook.mjs");

// A `cw` on PATH that runs this checkout's CLI.
const bin = tmpDir("cw-auto-receipt-bin-");
fs.writeFileSync(path.join(bin, "cw"), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NO_COLOR: "1" };
delete env.CW_AUTO_RECEIPT;
delete env.CW_CHECK_PRIVKEY;
delete env.CW_CHECK_PUBKEY;

function hook(command, extraEnv = {}, toolName = "Bash", raw) {
  const input = raw ?? JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { command, description: "Run the tests", timeout: 60000 } });
  const r = spawnSync(process.execPath, [HOOK], { input, env: { ...env, ...extraEnv }, encoding: "utf8" });
  assert.equal(r.status, 0, `hook exit for ${command}: ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

// Rewritten.
for (const command of ["npm test", "npm run test:unit", "pnpm test", "yarn test", "bun test", "npx vitest run", "npx jest --ci", "pytest -x tests/", "go test ./...", "cargo test", "make test", '  pytest -k "fast or slow"  ']) {
  const out = hook(command);
  assert.ok(out, `${command} should be rewritten`);
  const h = out.hookSpecificOutput;
  assert.equal(h.hookEventName, "PreToolUse");
  assert.equal(h.updatedInput.command, `cw check --tee -- ${command.trim()}`);
  assert.equal(h.updatedInput.description, "Run the tests", "other tool_input fields are kept");
  assert.equal(h.updatedInput.timeout, 60000);
  assert.equal("permissionDecision" in h, false, "the hook never approves a call");
  assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
}

// Left alone.
for (const command of [
  "npm test | tail", "npm test && git push", "npm test; rm -rf x", "npm test > out.txt", "npm test 2>&1", "npm test &",
  "pytest $(cat files)", "pytest `cat files`", "(npm test)", "npm test\nrm -rf x", "go test \\\n ./...",
  "npm install", "npm testing", "make test-all", "ls", "git status", "cw check -- npm test", "FOO=1 npm test", "",
]) assert.equal(hook(command), null, `${JSON.stringify(command)} should not be rewritten`);
for (const value of ["off", "OFF", "0", "false"]) assert.equal(hook("npm test", { CW_AUTO_RECEIPT: value }), null, `CW_AUTO_RECEIPT=${value} turns it off`);
assert.equal(hook("npm test", { PATH: path.dirname(process.execPath) }), null, "no cw on PATH: no rewrite");
assert.equal(hook("npm test", {}, "Edit"), null, "only the Bash tool");
assert.equal(hook("", {}, "Bash", "not json"), null, "bad input fails open");

// hooks.json runs it on Bash, and keeps the tag guard.
const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse;
const bash = hooks.filter((h) => h.matcher === "Bash").flatMap((h) => h.hooks.map((x) => x.command));
assert.ok(bash.includes("node ${CLAUDE_PLUGIN_ROOT}/scripts/auto-receipt-hook.mjs"), "hooks.json runs the auto-receipt hook");
assert.ok(bash.includes("node ${CLAUDE_PLUGIN_ROOT}/scripts/block-unapproved-tag.mjs"), "hooks.json keeps the tag guard");

// End to end: run what the hook hands back, through a shell, in a git repo.
const repo = tmpDir("cw-auto-receipt-repo-");
const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
git("init", "-q");
for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git("config", k, v);
fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "tiny", private: true, scripts: { test: "node t.mjs" } }));
fs.writeFileSync(path.join(repo, "t.mjs"), 'console.log("3 tests passed"); console.error("a warning"); process.exit(Number(process.env.T_EXIT || 0));\n');
git("add", "-A");
git("commit", "-qm", "init");

function runRewritten(extraEnv = {}) {
  const command = hook("npm test").hookSpecificOutput.updatedInput.command;
  return spawnSync("/bin/sh", ["-c", command], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8" });
}
const receipts = () => (fs.existsSync(path.join(repo, ".cw", "receipts")) ? fs.readdirSync(path.join(repo, ".cw", "receipts")) : []);

const pass = runRewritten();
assert.equal(pass.status, 0, pass.stderr);
assert.match(pass.stdout, /3 tests passed/, "the test's stdout passes through on stdout");
assert.doesNotMatch(pass.stdout, /schemaVersion/, "no JSON mixed into the test's stdout");
assert.match(pass.stderr, /a warning/, "the test's stderr passes through on stderr");
const id = /receipt (rc-[0-9a-f]{16})\. Cite it as receipt:rc-/.exec(pass.stderr)?.[1];
assert.ok(id, `one receipt line on stderr: ${pass.stderr}`);
assert.deepEqual(receipts(), [`${id}.json`]);
const receipt = JSON.parse(fs.readFileSync(path.join(repo, ".cw", "receipts", `${id}.json`), "utf8"));
assert.deepEqual(receipt.argv, ["npm", "test"]);
assert.equal(receipt.exitCode, 0);

const fail = runRewritten({ T_EXIT: "7" });
assert.equal(fail.status, 7, "the test's exit code passes through unchanged");
assert.match(fail.stderr, /failed: npm test \(exit 7/);
assert.equal(receipts().length, 2, "a failed run keeps its receipt too");

console.log("auto-receipt-hook smoke: ok");
