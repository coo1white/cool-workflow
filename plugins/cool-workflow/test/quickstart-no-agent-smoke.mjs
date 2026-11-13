#!/usr/bin/env node
// quickstart-no-agent-smoke — Track A first-run acceptance.
//
// Proves the no-agent user path: a blocked `cw -q` is actionable (not a
// mysterious error). A user who starts cold (no agent installed) runs `cw -q`
// and gets a blocked run whose hint names the fix, never a fake answer.
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

try {
  // ---- cw -q with no agent: blocked, actionable, never fabricated -----------
  {
    const result = runCw(["-q", "test?", "--repo", cwd, "--json"], { CW_AGENT_COMMAND: "", CW_NO_AUTO_AGENT: "1" });
    assert.equal(result.status, 2, "a blocked run exits 2");
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.status, "blocked");
    assert.match(payload.hint || "", /add -claude to your cw command/, "the hint names the fix");
    assert.equal(payload.completedWorkers, 0, "blocked run completed zero workers");
    assert.ok(!payload.commitId, "blocked run has no commit (never fabricated)");
    assert.ok(fs.existsSync(payload.reportPath), "the report still says why");
  }

  process.stdout.write("quickstart-no-agent-smoke: ok (blocked is actionable)\n");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
