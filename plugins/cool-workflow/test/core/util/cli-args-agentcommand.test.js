#!/usr/bin/env node
// cli-args-agentcommand — pins the one agent-command parser in
// core/util/cli-args.ts. It took the place of four copies of the same
// white-space split: shell/agent-config.ts (splitCommand), shell/execution-backend/agent.ts
// (resolveAgentInvocation), scripts/release-flow.mjs and
// scripts/release-preflight.mjs (plus doctor.ts's first-token read). Each old
// copy is kept below as written and checked against the shared parser, so
// the argv bytes stay the same for every input.

const assert = require("node:assert/strict");
const {
  splitAgentCommandLine,
  splitAgentCommand,
  agentCommandArgv,
  substituteAgentArg,
} = require("../../../dist/core/util/cli-args");

// The old copies, byte for byte.
const oldSplitLine = (line) => line.split(/\s+/).filter(Boolean);
function oldConfigSplit(command, args) {
  if (!command) return { command: undefined, args };
  if (args && args.length) return { command, args };
  if (/\s/.test(command)) {
    const parts = command.split(/\s+/).filter(Boolean);
    return { command: parts[0], args: parts.slice(1) };
  }
  return { command, args };
}
function oldReleaseArgv(command, args) {
  const parts = String(command).split(/\s+/).filter(Boolean);
  return { binary: parts[0], args: [...parts.slice(1), ...(args || [])] };
}
const oldSubstitute = (arg, map) => arg.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? String(map[k]) : m));

const lines = [
  "claude",
  "claude -p",
  "claude -p {{input}}",
  "claude  -p\t--permission-mode acceptEdits\n{{input}}",
  "  codex exec  ",
  "node /abs/scripts/agents/claude-p-agent.js {{input}} {{result}}",
  "opencode run -m some/model {{manifest}}",
  "builtin:claude",
  "\"quoted arg\" stays two tokens",
  "a b",
  "",
  "   ",
];
const argSets = [undefined, [], ["x"], ["--flag", "{{result}}"]];

// splitAgentCommandLine: the plain split every site shared.
for (const line of lines) assert.deepEqual(splitAgentCommandLine(line), oldSplitLine(line), JSON.stringify(line));
assert.deepEqual(splitAgentCommandLine("claude -p {{input}}"), ["claude", "-p", "{{input}}"]);
assert.deepEqual(splitAgentCommandLine("\"a b\""), ["\"a", "b\""], "never shell-interpreted: quotes do not group");
// doctor.ts read the first token of a trimmed command: same token.
for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
  assert.equal(splitAgentCommandLine(line)[0], line.split(/\s+/)[0], JSON.stringify(line));
}

// splitAgentCommand: agent-config.ts's flag/env layer rule.
for (const line of [undefined, ...lines]) {
  for (const args of argSets) {
    assert.deepEqual(splitAgentCommand(line, args), oldConfigSplit(line, args), JSON.stringify([line, args]));
  }
}
assert.deepEqual(splitAgentCommand("claude -p {{input}}", undefined), { command: "claude", args: ["-p", "{{input}}"] });
assert.deepEqual(splitAgentCommand("claude", undefined), { command: "claude", args: undefined });
assert.deepEqual(splitAgentCommand("claude -p", ["x"]), { command: "claude -p", args: ["x"] }, "explicit args win; the command stays whole");
assert.deepEqual(splitAgentCommand(undefined, ["x"]), { command: undefined, args: ["x"] });

// agentCommandArgv: release-flow.mjs / release-preflight.mjs spawn argv.
for (const line of lines) {
  for (const args of argSets) {
    assert.deepEqual(agentCommandArgv(line, args), oldReleaseArgv(line, args), JSON.stringify([line, args]));
  }
}
assert.deepEqual(agentCommandArgv("node /abs/w.js {{input}} {{result}}", undefined), {
  binary: "node",
  args: ["/abs/w.js", "{{input}}", "{{result}}"],
});
assert.deepEqual(agentCommandArgv("claude -p", ["x"]), { binary: "claude", args: ["-p", "x"] }, "inline tokens first, then explicit args");

// substituteAgentArg: one fill for agent.ts and release-flow.mjs.
const map = { input: "in.md", result: "out.json", model: "", prompt: "$& $1 text" };
for (const arg of ["{{input}}", "--out={{result}}", "{{model}}", "{{unknown}}", "{{input}}{{result}}", "{{ input }}", "{{prompt}}", "plain"]) {
  assert.equal(substituteAgentArg(arg, map), oldSubstitute(arg, map), arg);
}
assert.equal(substituteAgentArg("{{unknown}}", map), "{{unknown}}", "an unknown key is left as written");
assert.equal(substituteAgentArg("{{prompt}}", map), "$& $1 text", "no $-patterns in the filled value");

console.log("cli-args-agentcommand: ok");
