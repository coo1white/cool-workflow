#!/usr/bin/env node
// agent-config-builtin-only — shell/agent-config.ts: a custom CW_AGENT_COMMAND
// whose binary is named like a builtinOnly template's CLI (grok, copilot, agy) stays a
// custom command, as in 0.4.0: no `--version` probe (so `cw doctor` does not
// change its exit code). The builtin:<name> path still probes.

import assert from "node:assert/strict";
import path from "node:path";
import { agentProbeTarget } from "../../dist/shell/agent-config.js";

const AGENTS = path.resolve(import.meta.dirname, "..", "..", "scripts", "agents");

for (const bin of ["grok", "copilot", "agy", "/usr/local/bin/grok", "grok.exe"]) {
  assert.deepEqual(agentProbeTarget(bin, ["-p", "{{input}}"]), { skip: "custom command" }, `${bin} is a custom command`);
}

// A CLI not on builtinOnly is still matched by name, as before.
assert.deepEqual(agentProbeTarget("codex", ["exec"]), { cli: "codex" });

// The builtin wrappers of the three still probe their CLI.
for (const [, file, cli] of [["grok", "grok-agent.js", "grok"], ["copilot", "copilot-agent.js", "copilot"], ["antigravity", "antigravity-agent.js", "agy"]]) {
  const args = [path.join(AGENTS, file), "{{input}}", "{{result}}"];
  assert.deepEqual(agentProbeTarget("node", args), { cli });
}

console.log("agent-config-builtin-only: ok");
