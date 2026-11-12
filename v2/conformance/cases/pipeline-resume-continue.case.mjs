#!/usr/bin/env node

// Resume across processes: a run that parked (the agent kept failing) is
// continued with `cw --resume --run <id>` once the agent is fixed. The
// parked workers are reopened with a fresh budget (reopenedWorkers), every
// worker is accepted, the run makes its one commit (state-0001), and the
// output names the run it resumed (resumedFrom).

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, readJson, caseMain, assert, stubAgentEnv } from "../lib.mjs";

const FAIL_AGENT = path.join(import.meta.dirname, "fixtures", "stub-agent-fail.mjs");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const first = run(["-q", "prove it", "--repo", repo, "--json"], {
    env: { CW_AGENT_COMMAND: `node ${FAIL_AGENT} {{input}} {{result}}` },
  });
  assert.equal(first.status, 2);
  const parked = JSON.parse(first.stdout);
  assert.equal(parked.status, "parked");

  const resumed = run(["--resume", "--run", parked.runId, "--json"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(resumed.status, 0, resumed.stderr);
  const done = JSON.parse(resumed.stdout);
  assert.equal(done.runId, parked.runId);
  assert.equal(done.resumedFrom, parked.runId);
  assert.equal(done.status, "complete");
  assert.equal(done.completedWorkers, done.plannedWorkers);
  assert.equal(done.parkedWorkers, 0);
  assert.equal(done.commitId, "state-0001");
  assert.deepEqual([...done.reopenedWorkers].sort(), parked.steps.filter((s) => s.action === "park").map((s) => s.taskId).sort());

  const state = readJson(done.statePath);
  assert.ok(state.tasks.every((t) => t.status === "completed"));
  assert.equal(state.commits.length, 1);
  assert.ok(fs.existsSync(path.join(path.dirname(done.statePath), "commits", "state-0001.json")));

  // Resuming a finished run is a no-op that still exits 0 and makes no
  // second commit.
  const again = run(["--resume", "--run", parked.runId, "--json"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(again.status, 0);
  assert.equal(readJson(done.statePath).commits.length, 1);
});
