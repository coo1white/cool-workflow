#!/usr/bin/env node
// entry-opencode-pin — pins cli/entry.ts's vendor short-flag redirect for
// `-opencode`. Before this change, -claude/-codex/-gemini/-deepseek each
// mapped to --agent-command builtin:<vendor>, but -opencode did not — an
// opencode-only user had no short flag to pin their agent.
//
// The redirect line lives inside runCli() (not a pure export), so the
// black-box seam is the real CLI: `cw doctor --json` reports the "agent"
// check from the SAME resolved agent config the drive would use. With
// auto-detect off (CW_NO_AUTO_AGENT=1), no CW_AGENT_COMMAND, and an empty
// CW_HOME, the agent check warns unless a pin flag maps to a builtin template.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as agentConfigModule from "../../dist/shell/agent-config.js";
import { tmpDir } from "../helpers/workspace.mjs";

const pluginRoot = path.join(import.meta.dirname, "..", "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

const tmp = tmpDir("cw-opencode-pin-");
const cwHome = path.join(tmp, "home");
fs.mkdirSync(cwHome, { recursive: true });

function checkAgent(extraArgs) {
  const env = { ...process.env, CW_NO_AUTO_AGENT: "1", CW_HOME: cwHome };
  delete env.CW_AGENT_COMMAND;
  const r = spawnSync(
    process.execPath,
    [cli, "doctor", "--json", ...extraArgs],
    { encoding: "utf8", env, cwd: tmp }
  );
  const payload = JSON.parse(r.stdout);
  const agent = payload.checks.find((c) => c.name === "agent");
  assert.ok(agent, "the doctor payload must have an 'agent' check");
  return { agent };
}

try {
  // Control: with auto-detect off and no pin flag, the agent check warns.
  // This proves the "ok" below comes from the flag, not the env.
  {
    const { agent } = checkAgent([]);
    assert.equal(agent.status, "warn", "no pin flag + no auto-detect must leave the agent check unconfigured");
  }

  // The new redirect: `-opencode` maps to --agent-command builtin:opencode,
  // so the same invocation now reports the agent as configured.
  {
    const { agent } = checkAgent(["-opencode"]);
    assert.equal(agent.status, "ok", "-opencode must pin the agent (builtin:opencode), like -claude/-codex/-gemini/-deepseek");
  }

  // The template behind the pin: builtin:opencode must resolve to the
  // opencode wrapper script — the pin reaches the OPENCODE agent path,
  // not just "some" agent.
  {
    const { resolveAgentConfig } = agentConfigModule;
    const cfg = resolveAgentConfig({ "agent-command": "builtin:opencode" }, { CW_NO_AUTO_AGENT: "1", CW_HOME: cwHome });
    assert.ok(String(cfg.command || "").includes("opencode-agent.js"), `builtin:opencode must resolve to opencode-agent.js (got: ${cfg.command})`);
  }

  // An existing pin flag still works the same way (the new line is an ADD,
  // not a reorder).
  {
    const { agent } = checkAgent(["-claude"]);
    assert.equal(agent.status, "ok", "-claude must still pin the agent");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("entry-opencode-pin: ok\n");
