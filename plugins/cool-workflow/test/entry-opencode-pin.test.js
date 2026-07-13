#!/usr/bin/env node
// entry-opencode-pin — pins cli/entry.ts's vendor short-flag redirect for
// `-opencode`. Before this change, -claude/-codex/-gemini/-deepseek each
// mapped to --agent-command builtin:<vendor>, but -opencode did not — an
// opencode-only user had no short flag to pin their agent.
//
// The redirect line lives inside runCli() (not a pure export), so the
// black-box seam is the real CLI: `cw quickstart --check --json` reports
// the "agent" preflight check from the SAME resolved agent config the
// drive would use. With auto-detect off (CW_NO_AUTO_AGENT=1), no
// CW_AGENT_COMMAND, and an empty CW_HOME, the agent check is "blocked"
// unless a pin flag maps to a builtin template.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.join(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-opencode-pin-"));
const cwHome = path.join(tmp, "home");
fs.mkdirSync(cwHome, { recursive: true });

function checkAgent(extraArgs) {
  const env = { ...process.env, CW_NO_AUTO_AGENT: "1", CW_HOME: cwHome };
  delete env.CW_AGENT_COMMAND;
  const r = spawnSync(
    process.execPath,
    [cli, "quickstart", "-q", "x", "--check", "--json", "--repo", tmp, ...extraArgs],
    { encoding: "utf8", env }
  );
  // Note: --check exits non-zero when any check is blocked, so the exit
  // code is asserted per case below, not here.
  const payload = JSON.parse(r.stdout);
  const agent = payload.checks.find((c) => c.name === "agent");
  assert.ok(agent, "the --check payload must have an 'agent' check");
  return { agent, status: r.status };
}

try {
  // Control: with auto-detect off and no pin flag, the agent check is
  // blocked (and the whole --check exits non-zero). This proves the "ok"
  // below comes from the flag, not the env.
  {
    const { agent, status } = checkAgent([]);
    assert.equal(agent.status, "blocked", "no pin flag + no auto-detect must leave the agent check blocked");
    assert.notEqual(status, 0, "a blocked --check must exit non-zero");
  }

  // The new redirect: `-opencode` maps to --agent-command builtin:opencode,
  // so the same invocation now reports the agent as configured.
  {
    const { agent, status } = checkAgent(["-opencode"]);
    assert.equal(agent.status, "ok", "-opencode must pin the agent (builtin:opencode), like -claude/-codex/-gemini/-deepseek");
    assert.equal(status, 0, "an all-ok --check must exit 0");
  }

  // The template behind the pin: builtin:opencode must resolve to the
  // opencode wrapper script — the pin reaches the OPENCODE agent path,
  // not just "some" agent.
  {
    const { resolveAgentConfig } = require("../dist/shell/agent-config");
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
