#!/usr/bin/env node
// pipeline-cli-stop-log — the parked terminal summary finds the stopped
// worker's agent-stderr.log when the task id holds a character that
// safeFileName changes in the worker folder name (a `/` in `verify/x`
// gives `worker-verify_x-0001`). Before the fix the folder was looked up by
// the raw task id, so `Why:` lost the agent's own words.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatQuickstartHuman } from "../../../dist/shell/commands/pipeline-cli.js";
import { tmpDir } from "../../helpers/workspace.mjs";

const work = tmpDir("cw-stop-log-");
try {
  const runDir = path.join(work, "run");
  const logs = path.join(runDir, "workers", "worker-verify_x-0001", "logs");
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, "agent-stderr.log"), "first\nthe agent's own last line\n", "utf8");
  const text = formatQuickstartHuman({
    runId: "run-1",
    status: "parked",
    reportPath: path.join(runDir, "report.md"),
    statePath: path.join(runDir, "state.json"),
    completedWorkers: 0,
    plannedWorkers: 1,
    agentConfigured: true,
    steps: [{ action: "park", status: "parked", taskId: "verify/x", reason: "agent hop failed (attempt 3/3)" }],
  }).replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(text, /the agent's own last line/, "Why: has the agent's last line");
  assert.match(text, /All of it: \S*worker-verify_x-0001[\\/]logs[\\/]agent-stderr\.log/, "Why: names the log");
  console.log("pipeline-cli-stop-log: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
