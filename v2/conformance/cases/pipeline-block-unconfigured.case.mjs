#!/usr/bin/env node

// block: agent unconfigured — no CW_AGENT_COMMAND (and CW_NO_AUTO_AGENT=1
// turns off the PATH auto-detect of a real claude/codex/gemini/opencode
// binary) makes the drive refuse to spawn anything. The step and the exact
// reason string are fixed; agentConfigured is false; no worker is ever
// created. The run is still made and reported: exit 2, a report.md, and a
// hint naming the fix.

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, caseMain, assert } from "../lib.mjs";

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const r = run(["-q", "prove it", "--repo", repo, "--json"], { env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(r.status, 2);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "blocked");
  assert.equal(payload.agentConfigured, false);
  assert.equal(payload.parkedWorkers, 0);
  assert.equal(payload.completedWorkers, 0);
  assert.equal(payload.commitId, undefined);
  assert.equal(payload.steps.length, 1);
  assert.equal(payload.steps[0].action, "blocked");
  assert.equal(payload.steps[0].status, "blocked");
  assert.equal(
    payload.steps[0].reason,
    "agent backend not configured (set CW_AGENT_COMMAND or pass --agent-command) — refusing rather than fabricating a completion"
  );
  assert.ok(typeof payload.hint === "string" && payload.hint.length > 0, "a blocked run names the fix");
  assert.ok(fs.existsSync(payload.reportPath), "report.md is still written");

  // Blocked before ever delegating: no worker folder.
  const workersDir = path.join(path.dirname(payload.statePath), "workers");
  const workers = fs.existsSync(workersDir) ? fs.readdirSync(workersDir) : [];
  assert.deepEqual(workers, []);
});
