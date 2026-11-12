#!/usr/bin/env node
// agent-config-fix-hint — every "no agent" hint names a form that works.
//
// The fault this guards (first-run walkthrough, 2026-11-03): `cw doctor`,
// `cw quickstart --check` and the `cw -q` hint told a new user to pass
// --agent-command "claude -p", but a bare "claude -p" never completes a
// worker (docs/reference.md, "Agents and wrappers"). Now all of them give the one
// AGENT_FIX text, which names -claude / builtin:claude, the README's form.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AGENT_FIX, resolveAgentConfig } from "../../dist/shell/agent-config.js";
import { cw } from "../helpers/cw.mjs";
import { tmpDir } from "../helpers/workspace.mjs";

const tmp = tmpDir("cw-agent-fix-hint-");
try {
  const env = { ...process.env, CW_HOME: path.join(tmp, "home"), CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
  for (const key of ["CW_AGENT_COMMAND", "CW_AGENT_MODEL"]) delete env[key];
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# target\n");
  spawnSync("git", ["init", "-q"], { cwd: repo });

  // 1. The text itself: no bare "claude -p"; it names -claude and builtin:claude.
  assert.equal(typeof AGENT_FIX, "string");
  assert.ok(!AGENT_FIX.includes('"claude -p"'), "the fix never names the bare claude -p");
  assert.match(AGENT_FIX, / -claude\b/);
  assert.match(AGENT_FIX, /CW_AGENT_COMMAND=builtin:claude/);

  // 2. Every form it names resolves to a bundled wrapper, not a bare CLI.
  for (const name of ["claude", "codex", "gemini", "opencode"]) {
    assert.ok(AGENT_FIX.includes(`-${name}`), `the fix names -${name}`);
    const cfg = resolveAgentConfig({ "agent-command": `builtin:${name}` }, { PATH: "", CW_NO_AUTO_AGENT: "1", CW_HOME: env.CW_HOME });
    assert.equal(cfg.source, "flag");
    assert.match(String(cfg.command), /scripts[\\/]agents[\\/]/, `builtin:${name} is a bundled wrapper`);
  }
  const fromEnv = resolveAgentConfig({}, { PATH: "", CW_NO_AUTO_AGENT: "1", CW_HOME: env.CW_HOME, CW_AGENT_COMMAND: "builtin:claude" });
  assert.match(String(fromEnv.command), /claude-p-agent\.js/, "CW_AGENT_COMMAND=builtin:claude is the claude wrapper");

  // 3. cw doctor gives it.
  const doctor = cw(["doctor", "--json"], { cwd: repo, env });
  const agent = JSON.parse(doctor.stdout).checks.find((check) => check.name === "agent");
  assert.equal(agent.status, "warn");
  assert.equal(agent.fix, AGENT_FIX, "cw doctor's fix");

  // 4. The cw -q hint gives it, and keeps the DELEGATES line.
  const ask = cw(["-q", "How does it work?", "--json"], { cwd: repo, env });
  const result = JSON.parse(ask.stdout);
  assert.equal(result.status, "blocked");
  assert.equal(result.hint, `agent backend not configured — ${AGENT_FIX} The one command DELEGATES worker execution to YOUR agent; it never executes a model itself.`);
  console.log("agent-config-fix-hint: every no-agent hint names -claude OK");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
