#!/usr/bin/env node
// agent-config-builtin-only — shell/agent-config.ts: a custom CW_AGENT_COMMAND
// whose binary is named like a builtinOnly template's CLI (grok, copilot, agy) stays a
// custom command, as in 0.4.0: no `--version` probe (so `cw doctor` does not
// change its exit code) and no sandbox hosts. The builtin:<name> path still
// probes and gets its hosts (second 0.4.1 rejection).

import assert from "node:assert/strict";
import path from "node:path";
import { agentProbeTarget, agentSandboxVendor } from "../../dist/shell/agent-config.js";

const AGENTS = path.resolve(import.meta.dirname, "..", "..", "scripts", "agents");

for (const bin of ["grok", "copilot", "agy", "/usr/local/bin/grok", "grok.exe"]) {
  assert.deepEqual(agentProbeTarget(bin, ["-p", "{{input}}"]), { skip: "custom command" }, `${bin} is a custom command`);
  assert.deepEqual(agentSandboxVendor(bin, ["-p"]), { hosts: [], write: [] }, `${bin} gets no sandbox hosts`);
}

// A CLI not on builtinOnly is still matched by name, as before.
assert.deepEqual(agentProbeTarget("codex", ["exec"]), { cli: "codex" });

// The builtin wrappers of the three still probe their CLI and get hosts.
for (const [name, file, cli] of [["grok", "grok-agent.js", "grok"], ["copilot", "copilot-agent.js", "copilot"], ["antigravity", "antigravity-agent.js", "agy"]]) {
  const args = [path.join(AGENTS, file), "{{input}}", "{{result}}"];
  assert.deepEqual(agentProbeTarget("node", args), { cli });
  const v = agentSandboxVendor("node", args);
  assert.equal(v.name, name);
  assert.ok(v.hosts.length > 0, `${name} has sandbox hosts`);
}

console.log("agent-config-builtin-only: ok");
