#!/usr/bin/env node
"use strict";

// State-explosion collapse rule: only the DECLARED collapsible kinds
// (blackboard-message, blackboard-context, agent-membership, worker,
// score, blackboard-snapshot, agent-role) are ever collapsed into a
// synthetic bucket — "task", "dispatch", "candidate", "selection",
// "commit", "feedback" nodes are NEVER collapsed, regardless of how many
// share a bucket key (plugins/cool-workflow/project/docs/rebuild/PLAN.md byte-compat item 9: "decisions,
// artifacts, fanins, candidates, selections, commits, feedback are never
// collapsed"; "task"/"dispatch" fall out of the same allowlist rule).
// Driven WITHOUT `-q`/drive() via a hand-written `state.json` (`tasks` +
// `dispatches` + `workers`, wired task->dispatch->worker so the real
// graph edges — "owns"/"dispatches"/"reports" — are also exercised).

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

function baseState(runId, cwd, runDir, tasks, dispatches, workers) {
  return {
    schemaVersion: 1,
    id: runId,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    cwd,
    workflow: { id: "fixture-workflow", title: "Fixture Workflow", summary: "", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks,
    dispatches,
    commits: [],
    paths: {
      runDir,
      state: path.join(runDir, "state.json"),
      report: path.join(runDir, "report.md"),
      tasksDir: path.join(runDir, "tasks"),
      resultsDir: path.join(runDir, "results"),
      dispatchesDir: path.join(runDir, "dispatches"),
      artifactsDir: path.join(runDir, "artifacts"),
      commitsDir: path.join(runDir, "commits"),
      stateNodesDir: path.join(runDir, "nodes"),
      feedbackDir: path.join(runDir, "feedback"),
    },
    workers,
  };
}

function task(id, dispatchId) {
  return {
    id,
    kind: "agent",
    phase: "review",
    status: "completed",
    requiresEvidence: false,
    prompt: `do ${id}`,
    taskPath: `/tmp/tasks/${id}.json`,
    resultPath: `/tmp/results/${id}.json`,
    loopStage: "interpret",
    dispatchId,
  };
}

function dispatch(id, workerIds) {
  return {
    id,
    phase: "review",
    taskIds: [],
    manifestPath: `/tmp/dispatches/${id}.json`,
    createdAt: "1970-01-01T00:00:00.000Z",
    workerIds,
  };
}

function worker(id, runId) {
  return {
    schemaVersion: 1,
    id,
    runId,
    taskId: `t-${id}`,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    status: "completed",
    workerDir: "/tmp/w",
    inputPath: "/tmp/w/input.json",
    resultPath: "/tmp/w/result.md",
    artifactsDir: "/tmp/w/artifacts",
    logsDir: "/tmp/w/logs",
    allowedPaths: [],
    feedbackIds: [],
    errors: [],
  };
}

caseMain(() => {
  const runId = "explosion-noncollapse-run";
  const repo = freshDir("repo");
  const runDir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  // 10 tasks, each dispatched to its own worker via one shared dispatch
  // manifest. 10 >= collapseBucket (6), but "task"/"dispatch" are not in
  // the collapsible-kinds allowlist, so none of them collapse — only the
  // 10 workers (a collapsible kind) do.
  const workerIds = [];
  const tasks = [];
  for (let i = 0; i < 10; i++) {
    const id = `t${i}`;
    workerIds.push(id);
    tasks.push(task(id, "d0"));
  }
  const dispatches = [dispatch("d0", workerIds)];
  const workers = workerIds.map((id) => worker(id, runId));

  const statePath = path.join(runDir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(baseState(runId, repo, runDir, tasks, dispatches, workers), null, 2) + "\n");

  const refresh = run(["summary", "refresh", runId, "--json"], { cwd: repo });
  assert.equal(refresh.status, 0);

  const show = run(["summary", "show", runId, "--json"], { cwd: repo });
  assert.equal(show.status, 0);
  const report = JSON.parse(show.stdout);
  const compact = report.compactGraph;

  // full graph: 1 run root + 10 tasks + 1 dispatch + 10 workers = 22.
  assert.equal(compact.fullNodeCount, 22);

  // Exactly one synthetic bucket (the 10 workers); tasks/dispatch never collapse.
  assert.equal(compact.syntheticNodes.length, 1);
  assert.equal(compact.syntheticNodes[0].id, `${runId}:summary:workers`);
  assert.equal(compact.syntheticNodes[0].collapsedNodeCount, 10);

  const compactIds = new Set(compact.nodes.map((n) => n.id));
  assert.ok(compactIds.has(`${runId}:run`));
  assert.ok(compactIds.has(`${runId}:dispatch:d0`), "dispatch nodes are never collapsed");
  for (let i = 0; i < 10; i++) {
    assert.ok(compactIds.has(`${runId}:task:t${i}`), `task node t${i} must stay expanded (not a collapsible kind)`);
  }
  assert.ok(compactIds.has(`${runId}:summary:workers`));
  for (let i = 0; i < 10; i++) {
    assert.ok(!compactIds.has(`${runId}:worker:t${i}`), `worker node t${i} must be collapsed into the synthetic bucket`);
  }

  // Real graph edges: task -owns-> from run root, and the dispatch's
  // "dispatches" edges into the (now-collapsed) workers get redirected to
  // the synthetic bucket rather than dropped.
  const ownsEdges = compact.edges.filter((e) => e.label === "owns" && e.from === `${runId}:run`);
  assert.equal(ownsEdges.length, 10, "one owns edge per task, from the run root");
  const dispatchToSynthetic = compact.edges.filter(
    (e) => e.from === `${runId}:dispatch:d0` && e.to === `${runId}:summary:workers`
  );
  assert.equal(dispatchToSynthetic.length, 1, "the dispatch's 10 worker edges collapse into 1 deduplicated edge to the synthetic node");
});
