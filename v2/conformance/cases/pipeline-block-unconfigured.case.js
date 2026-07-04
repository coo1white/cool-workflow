#!/usr/bin/env node
"use strict";

// block: agent unconfigured — no CW_AGENT_COMMAND/CW_AGENT_ENDPOINT (and
// CW_NO_AUTO_AGENT=1 turns off the PATH auto-detect of a real claude/codex/
// gemini/opencode binary) makes the drive refuse to spawn anything. The
// step and the exact reason string are fixed; DriveResult.agentConfigured
// is false; nothing is dispatched, no worker/dispatch is ever created.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const r = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: { CW_NO_AUTO_AGENT: "1" } }
  );
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "blocked");
  assert.equal(payload.agentConfigured, false);
  assert.equal(payload.parkedWorkers, 0);
  assert.equal(payload.completedWorkers, 0);
  assert.equal(payload.steps.length, 1);
  assert.equal(payload.steps[0].action, "blocked");
  assert.equal(payload.steps[0].status, "blocked");
  assert.equal(
    payload.steps[0].reason,
    "agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion"
  );

  // A read-only preview of the same run agrees: nextAction "blocked".
  const preview = run(["run", "drive", payload.runId, "--json"], { cwd: repo, env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(preview.status, 0);
  const previewPayload = JSON.parse(preview.stdout);
  assert.equal(previewPayload.nextAction, "blocked");
  assert.equal(previewPayload.agentConfigured, false);

  // Blocked before ever dispatching: no dispatch manifest, no worker dir.
  const runDir = path.dirname(payload.statePath);
  const dispatchFiles = fs.existsSync(path.join(runDir, "dispatches"))
    ? fs.readdirSync(path.join(runDir, "dispatches"))
    : [];
  assert.deepEqual(dispatchFiles, []);
});
