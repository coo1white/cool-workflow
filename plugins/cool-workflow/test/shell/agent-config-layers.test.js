#!/usr/bin/env node
// agent-config-layers — pins that resolveAgentConfig takes the agent command
// and its args from the SAME layer (flags > env > file > auto-detect).
//
// The fault this guards: a durable $CW_HOME/agent-config.json written by
// `cw backend agent-config set --agent-command "claude -p {{input}}"` stores
// command "claude" + args ["-p", "{{input}}"]. A later run with a one-word
// CW_AGENT_COMMAND (or `-codex`, which maps to --agent-command
// builtin:codex) took the command from the higher layer but the args from
// the file — CW spawned command A with args written for command B.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveAgentConfig } = require(path.join(__dirname, "..", "..", "dist", "shell", "agent-config.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-agent-config-layers-"));
try {
  const cwHome = path.join(tmp, "home");
  fs.mkdirSync(cwHome, { recursive: true });
  fs.writeFileSync(
    path.join(cwHome, "agent-config.json"),
    JSON.stringify({ schemaVersion: 1, command: "claude", args: ["-p", "{{input}}"] })
  );
  const baseEnv = { CW_HOME: cwHome, CW_NO_AUTO_AGENT: "1", PATH: "" };

  // 1. env one-word command over a file with args: no file args attached.
  const envWins = resolveAgentConfig({}, { ...baseEnv, CW_AGENT_COMMAND: "mycli" });
  assert.equal(envWins.command, "mycli");
  assert.equal(envWins.source, "env");
  assert.equal(envWins.args, undefined, "file args must not attach to the env command");

  // 2. flag builtin over a file with args: the builtin template keeps its own argv.
  const flagWins = resolveAgentConfig({ agentCommand: "builtin:codex" }, baseEnv);
  assert.match(flagWins.command, /codex-agent\.js \{\{input\}\} \{\{result\}\}$/);
  assert.equal(flagWins.source, "flag");
  assert.equal(flagWins.args, undefined, "file args must not attach to the flag command");

  // 3. flag one-word command over an env command with args.
  const flagOverEnv = resolveAgentConfig({ agentCommand: "other" }, { ...baseEnv, CW_AGENT_COMMAND: "codex exec {{input}}" });
  assert.equal(flagOverEnv.command, "other");
  assert.equal(flagOverEnv.args, undefined, "env args must not attach to the flag command");

  // Non-mixed cases are unchanged.
  const fileOnly = resolveAgentConfig({}, baseEnv);
  assert.equal(fileOnly.command, "claude");
  assert.deepEqual(fileOnly.args, ["-p", "{{input}}"]);
  assert.equal(fileOnly.source, "file");

  const envSplit = resolveAgentConfig({}, { ...baseEnv, CW_AGENT_COMMAND: "codex exec {{input}}" });
  assert.equal(envSplit.command, "codex");
  assert.deepEqual(envSplit.args, ["exec", "{{input}}"]);

  const flagWithArgs = resolveAgentConfig({ agentCommand: "x", agentArgs: ["--a", "{{input}}"] }, baseEnv);
  assert.equal(flagWithArgs.command, "x");
  assert.deepEqual(flagWithArgs.args, ["--a", "{{input}}"]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("agent-config-layers ok");
