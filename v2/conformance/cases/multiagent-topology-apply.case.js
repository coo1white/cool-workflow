#!/usr/bin/env node
"use strict";

// cw topology apply <run-id> <topology-id> — materializes multi-agent state
// on a plain planned run, with NO worker dispatch and NO agent needed. Pins:
// deterministic derived ids (<topology-run-id>-<suffix>), default role widths
// (map-reduce mapper-1/mapper-2/reducer; judge-panel judge-1/judge-2/judge-3/
// panel-chair), the judgeCount floor-at-2 rule, and the invalid-topology-id
// thrown error shape.

const { run, gitRepo, readJson, caseMain, assert } = require("../lib");

function planRun(repo, question) {
  const p = run(["plan", "architecture-review", "--arg", `repo=${repo}`, "--arg", `question=${question}`], {
    cwd: repo,
  });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout).runId;
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  // --- default map-reduce apply: mapper-1, mapper-2, reducer ---
  const runId1 = planRun(repo, "q1");
  const applied = run(["topology", "apply", runId1, "map-reduce"], { cwd: repo });
  assert.equal(applied.status, 0, applied.stderr);
  const topoRun = JSON.parse(applied.stdout);

  assert.equal(topoRun.topologyId, "map-reduce");
  assert.equal(topoRun.status, "planned");
  assert.match(topoRun.id, /^map-reduce-[0-9a-f]{16}$/, "deterministic topology-run id shape");

  const id = topoRun.id;
  assert.equal(topoRun.multiAgentRunId, `${id}-ma`);
  assert.equal(topoRun.blackboardId, `${id}-blackboard`);
  assert.deepEqual(topoRun.topicIds, [`${id}-mapper-outputs`, `${id}-reducer-synthesis`]);
  assert.deepEqual(topoRun.roleIds, [`${id}-mapper-1`, `${id}-mapper-2`, `${id}-reducer`]);
  assert.deepEqual(topoRun.groupIds, [`${id}-group`]);
  assert.deepEqual(topoRun.fanoutIds, [`${id}-fanout`]);
  assert.deepEqual(topoRun.faninIds, [], "no initial fanin by default");
  assert.deepEqual(topoRun.missingEvidence, [
    "mapper output artifact",
    "blackboard artifact ref",
    "reducer synthesis",
  ]);
  assert.deepEqual(topoRun.nextActions, [
    `node scripts/cw.js dispatch ${runId1} --multi-agent-fanout ${id}-fanout`,
    `node scripts/cw.js multi-agent fanin ${runId1} ${id}-fanin --fanout ${id}-fanout`,
    `node scripts/cw.js topology summary ${runId1}`,
  ]);

  // --- judge-panel with --judge-count 1: floors to 2, mints judge-1/judge-2 ---
  const runId2 = planRun(repo, "q2");
  const judgeLow = run(["topology", "apply", runId2, "judge-panel", "--judge-count", "1"], { cwd: repo });
  assert.equal(judgeLow.status, 0, judgeLow.stderr);
  const judgeLowRun = JSON.parse(judgeLow.stdout);
  const jid = judgeLowRun.id;
  assert.deepEqual(judgeLowRun.roleIds, [`${jid}-judge-1`, `${jid}-judge-2`, `${jid}-panel-chair`]);

  // --- judge-panel default: judge-1, judge-2, judge-3, panel-chair ---
  const runId3 = planRun(repo, "q3");
  const judgeDefault = run(["topology", "apply", runId3, "judge-panel"], { cwd: repo });
  assert.equal(judgeDefault.status, 0, judgeDefault.stderr);
  const judgeDefaultRun = JSON.parse(judgeDefault.stdout);
  const jdid = judgeDefaultRun.id;
  assert.deepEqual(judgeDefaultRun.roleIds, [
    `${jdid}-judge-1`,
    `${jdid}-judge-2`,
    `${jdid}-judge-3`,
    `${jdid}-panel-chair`,
  ]);

  // --- debate: always exactly 3 roles; debateRounds is accepted but unused ---
  const runId4 = planRun(repo, "q4");
  const debateApplied = run(["topology", "apply", runId4, "debate", "--debate-rounds", "99"], { cwd: repo });
  assert.equal(debateApplied.status, 0, debateApplied.stderr);
  const debateRun = JSON.parse(debateApplied.stdout);
  const did = debateRun.id;
  assert.deepEqual(debateRun.roleIds, [`${did}-position-a`, `${did}-position-b`, `${did}-synthesizer`]);

  // --- unknown topology id throws with the exact "Invalid topology" wrapper ---
  const runId5 = planRun(repo, "q5");
  const bad = run(["topology", "apply", runId5, "nosuchtopology"], { cwd: repo });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.equal(bad.stderr, "cw: Invalid topology nosuchtopology: Unknown topology id: nosuchtopology\n");

  // --- topologies/index.json on disk, per the applied run ---
  const indexPath = require("node:path").join(repo, ".cw", "runs", runId1, "topologies", "index.json");
  const index = readJson(indexPath);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.runId, runId1);
  assert.deepEqual(index.counts, { runs: 1 });
  assert.equal(index.runs.length, 1);
  assert.equal(index.runs[0].id, id);
  assert.equal(index.runs[0].topologyId, "map-reduce");
  assert.equal(index.runs[0].status, "planned");
  assert.ok(index.runs[0].updatedAt, "row carries updatedAt");
});
