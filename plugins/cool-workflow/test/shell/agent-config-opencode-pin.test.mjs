#!/usr/bin/env node
// agent-config-opencode-pin — builtin:opencode, the template behind the
// -opencode short flag, resolves to the opencode wrapper script: the pin
// reaches the OPENCODE agent path, not just "some" agent. That -opencode
// pins the agent end to end is v2/conformance/cases/cli-vendor-flags.

import assert from "node:assert/strict";
import path from "node:path";
import { resolveAgentConfig } from "../../dist/shell/agent-config.js";
import { tmpDir } from "../helpers/workspace.mjs";

const cwHome = path.join(tmpDir("cw-opencode-pin-"), "home");
const cfg = resolveAgentConfig({ "agent-command": "builtin:opencode" }, { CW_NO_AUTO_AGENT: "1", CW_HOME: cwHome });
assert.ok(String(cfg.command || "").includes("opencode-agent.js"), `builtin:opencode must resolve to opencode-agent.js (got: ${cfg.command})`);

process.stdout.write("agent-config-opencode-pin: ok\n");
