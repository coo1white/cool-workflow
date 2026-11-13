#!/usr/bin/env node
// stopped-run-summary-exit-smoke — a run that stopped does not look like a
// good one.
//
//   1. `cw -q` that ends blocked (no agent) exits 2, and its JSON
//      is still on stdout; a finished run exits 0.
//   2. The terminal summary of a stopped run starts `! Report:`, not
//      `✓ Report:`; a finished run keeps `✓ Report:`.
//   3. No agent set: `Next: cw -q "<question>" -claude`, then `Try: cw report --show`, and
//      no `cw report --open` line in the middle.
//
// Hermetic: no real agent, no network.

import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cw } from "./helpers/cw.mjs";
import { tmpWorkspace } from "./helpers/workspace.mjs";
import { writeStubAgent } from "./helpers/stub-agent.mjs";
import { formatQuickstartSummary } from "../dist/shell/reporter.js";

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const repo = tmpWorkspace("cw-stopped-run-");
const base = { ...process.env, CW_HOME: repo, XDG_STATE_HOME: repo, HOME: repo, TMPDIR: repo, CW_NO_AUTO_AGENT: "1" };
spawnSync("git", ["init", "-q"], { cwd: repo });
const args = ["-q", "test?", "--repo", repo, "--json"];

// 1. Exit code: blocked is 2 with the JSON kept; complete is 0.
{
  const blocked = cw(args, { cwd: repo, env: { ...base, CW_AGENT_COMMAND: "" } });
  const payload = JSON.parse(blocked.stdout.trim());
  assert.equal(payload.status, "blocked", "no agent: the run is blocked");
  assert.equal(blocked.status, 2, "a blocked run exits 2");

  const stub = writeStubAgent(path.join(repo, "stub-agent.cjs"));
  const done = cw(args, { cwd: repo, env: { ...base, CW_AGENT_COMMAND: `${process.execPath} ${stub} {{result}}` } });
  const donePayload = JSON.parse(done.stdout.trim());
  assert.equal(donePayload.status, "complete", `the stub agent takes the run to the end (stderr: ${done.stderr.slice(-400)})`);
  assert.equal(done.status, 0, "a finished run exits 0");
  console.log("stopped-run: blocked exits 2, complete exits 0 OK");
}

// 2 and 3. The summary text.
{
  const noAgent = plain(formatQuickstartSummary({ runId: "R1", reportPath: "/tmp/r/report.md", status: "blocked", completedWorkers: 0, plannedWorkers: 14, agentConfigured: false }, false));
  assert.equal(
    noAgent,
    ["! Report: /tmp/r/report.md", "  ! Status: blocked — 0/14 workers", '  Next: cw -q "<question>" -claude', "  Try: cw report --show"].join("\n"),
    "no agent: a ! on the report line, one Next, one Try"
  );

  const parked = plain(formatQuickstartSummary({ runId: "R2", reportPath: "/tmp/r/report.md", status: "parked", agentConfigured: true, why: ["agent hop failed"] }, false)).split("\n");
  assert.equal(parked[0], "! Report: /tmp/r/report.md", "a parked run gets the ! too");
  assert.equal(parked.at(-1), "  Next: cw --resume --run R2", "a parked run still ends on the resume command");

  const done = plain(formatQuickstartSummary({ runId: "R3", reportPath: "/tmp/r/report.md", status: "complete", agentConfigured: true }, false)).split("\n");
  assert.equal(done[0], "✓ Report: /tmp/r/report.md", "a finished run keeps the green mark");
  console.log("stopped-run: summary marks and next steps OK");
}

console.log("stopped-run-summary-exit-smoke: ok");
