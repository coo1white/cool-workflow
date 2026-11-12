#!/usr/bin/env node
// quickstart-no-agent-smoke — Track A first-run acceptance.
//
// Proves the no-agent user path: demo tamper works without an agent,
// `cw doctor` clearly reports agent status and names an install command, and
// a blocked `cw -q` is actionable (not a mysterious error). A user who starts
// cold (no agent installed) can:
//   1. Run `demo tamper` and see trust holds
//   2. Run `cw doctor` and see exactly what's missing, with the fix
//   3. Run `cw -q` and get a blocked run with a hint, never a fake answer
//
// Hermetic: no agent binary, no network, no shared state. Black box: it only
// spawns dist/cli.js and asserts on stdout/JSON.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cwd = tmpDir("cw-no-agent-smoke-");
const env = { ...process.env, CW_HOME: cwd, XDG_STATE_HOME: cwd, HOME: cwd, TMPDIR: cwd };
spawnSync("git", ["init", "-q"], { cwd });

function runCw(args, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
}

function json(args, extraEnv = {}) {
  return JSON.parse(runCw([...args, "--json"], extraEnv).stdout.trim());
}

try {
  // ---- 1. demo tamper works without agent -------------------------------------
  {
    const result = runCw(["demo", "tamper"]);
    assert.equal(result.status, 0, "demo tamper exits 0");
    assert.ok(result.stdout.includes("tamper-evidence holds"), "demo tamper proves trust holds");
  }

  // ---- 2. cw doctor prints clear diagnosis for no-agent state ------------------
  {
    // With CW_AGENT_COMMAND cleared: auto-detect may find an agent (ok), or
    // report it as warn/fail. Either outcome is correct — the check runs.
    const doct = json(["doctor"], { CW_AGENT_COMMAND: "" });
    const agentCheck = doct.checks.find((c) => c.name === "agent");
    assert.ok(agentCheck, "doctor includes an agent check");
    assert.ok(
      ["ok", "warn", "fail"].includes(agentCheck.status),
      `doctor agent check runs (status: ${agentCheck.status})`
    );
    assert.ok(doct.checks.some((c) => c.name === "node" && c.status === "ok"), "doctor checks node runtime");
  }

  // ---- 3. with no agent, cw doctor names the fix and the no-agent first steps -
  {
    const result = runCw(["doctor"], { CW_AGENT_COMMAND: "", CW_NO_AUTO_AGENT: "1" });
    const out = result.stdout;
    assert.equal(result.status, 0, "no agent is a warning, not a failure");
    assert.match(out, /! agent: No agent backend configured/, "doctor says the agent is missing");
    assert.match(out, /fix: Install an agent CLI such as Claude Code, then add -claude/, "doctor gives the fix");
    assert.ok(out.includes("cw demo tamper") && out.includes("cw check -- npm test"), "doctor lists the no-agent steps");
  }

  // ---- 4. cw -q with no agent: blocked, actionable, never fabricated -----------
  {
    const result = runCw(["-q", "test?", "--repo", cwd, "--json"], { CW_AGENT_COMMAND: "", CW_NO_AUTO_AGENT: "1" });
    assert.equal(result.status, 2, "a blocked run exits 2");
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.status, "blocked");
    assert.ok(payload.hint, "blocked payload has a hint");
    assert.equal(payload.completedWorkers, 0, "blocked run completed zero workers");
    assert.ok(!payload.commitId, "blocked run has no commit (never fabricated)");
    assert.ok(fs.existsSync(payload.reportPath), "the report still says why");
  }

  process.stdout.write("quickstart-no-agent-smoke: ok (demo runs without agent + doctor guides setup + blocked is actionable)\n");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
