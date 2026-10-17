#!/usr/bin/env node
// agent-config-set-args — pins that `cw backend agent-config set` treats the
// stored command and its args as one unit (issue #784).
//
// The fault this guards: a file written by `--agent-command "claude -p
// {{input}}"` stores command "claude" + args ["-p", "{{input}}"]. A later
// `set --agent-command mycli` (no args) kept those args, so the file paired
// command mycli with args written for claude. Now a CHANGED command takes
// only the args given with it (none here, so the stored args are cleared);
// re-setting the SAME command with no args keeps the stored args. Operator-
// approved default change for 0.3.1, recorded in
// project/docs/intent/2026-10-16-release-gate-ci.md ("Operator decisions
// for 0.3.1").

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { setAgentConfigFile, loadAgentConfigFile } = require(path.join(__dirname, "..", "..", "dist", "shell", "agent-config.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-agent-config-set-args-"));
try {
  const env = { CW_HOME: tmp, CW_NO_AUTO_AGENT: "1", PATH: "" };
  const file = path.join(tmp, "agent-config.json");
  const stored = () => JSON.parse(fs.readFileSync(file, "utf8"));

  // 1. First set: command + args from one string.
  setAgentConfigFile({ agentCommand: "claude -p {{input}}", agentModel: "m1" }, env);
  assert.equal(stored().command, "claude");
  assert.deepEqual(stored().args, ["-p", "{{input}}"]);

  // 2. Same command, no args: the stored args stay.
  setAgentConfigFile({ agentCommand: "claude" }, env);
  assert.equal(stored().command, "claude");
  assert.deepEqual(stored().args, ["-p", "{{input}}"], "re-setting the same command keeps its args");

  // 3. A field with no command (a model change): the stored args stay.
  setAgentConfigFile({ agentModel: "m2" }, env);
  assert.deepEqual(stored().args, ["-p", "{{input}}"], "a set without --agent-command keeps the args");
  assert.equal(stored().model, "m2");

  // 4. A NEW command with no args: the old command's args are cleared.
  setAgentConfigFile({ agentCommand: "mycli" }, env);
  assert.equal(stored().command, "mycli");
  assert.equal(stored().args, undefined, "a changed command must not keep the old command's args");
  assert.equal(loadAgentConfigFile(env).args, undefined, "the loaded file has no args for mycli");
  assert.equal(stored().model, "m2", "only the args are tied to the command; the model stays");

  // 5. A NEW command with args given: stored as given.
  setAgentConfigFile({ agentCommand: "othercli", agentArgs: ["--in", "{{input}}"] }, env);
  assert.equal(stored().command, "othercli");
  assert.deepEqual(stored().args, ["--in", "{{input}}"]);

  // 6. The same command with new args: the new args win.
  setAgentConfigFile({ agentCommand: "othercli --x" }, env);
  assert.deepEqual(stored().args, ["--x"]);

  console.log("agent-config-set-args: ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
