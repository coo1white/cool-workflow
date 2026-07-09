#!/usr/bin/env node
"use strict";

// multi-agent status|run --json — the MultiAgentHostResponse envelope on a
// freshly planned run. No worker dispatch, no agent. Pins: the fixed top
// level key set, state "needs-run" before any topology, "applied-topology"
// then "attached-topology" on repeat multi-agent run --topology calls, and
// state "ready-for-dispatch" once a topology is materialized.

const { run, gitRepo, caseMain, assert } = require("../lib");

function planRun(repo, question) {
  const p = run(["plan", "architecture-review", "--arg", `repo=${repo}`, "--arg", `question=${question}`], {
    cwd: repo,
  });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout).runId;
}

// Keys always present; performed/requiredHostAction/data are conditional
// (present only when relevant) so a plain "status" read omits them entirely.
const ENVELOPE_KEYS_ALWAYS = [
  "schemaVersion", "surface", "command", "runId", "state",
  "nextAction", "nextActions", "blockedReasons",
  "evidenceRequirements", "ids", "paths", "summaries",
];

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const runId = planRun(repo, "q1");

  // Fresh run: multi-agent status before any topology is applied.
  const status = run(["multi-agent", "status", runId, "--json"], { cwd: repo });
  assert.equal(status.status, 0, status.stderr);
  const statusPayload = JSON.parse(status.stdout);

  for (const k of ENVELOPE_KEYS_ALWAYS) {
    assert.ok(k in statusPayload, `envelope missing key ${k}`);
  }
  assert.equal(statusPayload.schemaVersion, 1);
  assert.equal(statusPayload.surface, "multi-agent-host");
  assert.equal(statusPayload.command, "status");
  assert.equal(statusPayload.runId, runId);
  assert.equal(statusPayload.state, "needs-run");
  // performed/requiredHostAction/data are absent (not null) on a plain status
  // read, since no host action was performed.
  assert.equal("performed" in statusPayload, false);
  assert.equal("requiredHostAction" in statusPayload, false);
  assert.equal("data" in statusPayload, false);
  assert.equal(
    statusPayload.nextAction,
    `cw multi-agent run ${runId} --topology map-reduce`
  );
  assert.deepEqual(statusPayload.blockedReasons, []);
  assert.deepEqual(statusPayload.evidenceRequirements, []);

  const idKeys = [
    "topologyRunIds", "topologyIds", "multiAgentRunIds", "blackboardIds",
    "topicIds", "groupIds", "roleIds", "fanoutIds", "faninIds",
    "candidateIds", "selectionIds", "commitIds", "auditEventIds",
  ];
  assert.deepEqual(Object.keys(statusPayload.ids), idKeys);
  for (const k of ["topologyRunIds", "topologyIds", "multiAgentRunIds", "blackboardIds", "roleIds"]) {
    assert.deepEqual(statusPayload.ids[k], [], `${k} empty before any topology`);
  }

  const pathKeys = [
    "statePath", "reportPath", "blackboardIndexPath", "auditSummaryPath",
    "auditEventLogPath", "candidateRankingPath", "workerManifestPaths", "workerResultPaths",
  ];
  assert.deepEqual(Object.keys(statusPayload.paths), pathKeys);

  const summaryKeys = [
    "topologies", "multiAgent", "multiAgentOperator", "blackboard",
    "workers", "candidates", "feedback", "commits", "trust",
  ];
  assert.deepEqual(Object.keys(statusPayload.summaries), summaryKeys);
  assert.deepEqual(statusPayload.summaries.topologies.officialTopologies, [
    "map-reduce", "debate", "judge-panel",
  ]);

  // multi-agent run --topology map-reduce: applies a topology.
  const applied = run(["multi-agent", "run", runId, "--topology", "map-reduce", "--json"], { cwd: repo });
  assert.equal(applied.status, 0, applied.stderr);
  const appliedPayload = JSON.parse(applied.stdout);
  assert.equal(appliedPayload.command, "run");
  assert.equal(appliedPayload.performed, "applied-topology");
  assert.equal(appliedPayload.state, "ready-for-dispatch");
  assert.equal(appliedPayload.ids.topologyIds.length, 1);
  assert.equal(appliedPayload.ids.topologyIds[0], "map-reduce");
  assert.equal(appliedPayload.ids.roleIds.length, 3, "map-reduce mints mapper-1, mapper-2, reducer");

  // Calling multi-agent run --topology map-reduce again attaches instead of
  // re-applying (idempotent on repeat).
  const attached = run(["multi-agent", "run", runId, "--topology", "map-reduce", "--json"], { cwd: repo });
  assert.equal(attached.status, 0, attached.stderr);
  const attachedPayload = JSON.parse(attached.stdout);
  assert.equal(attachedPayload.performed, "attached-topology");
  assert.equal(attachedPayload.state, "ready-for-dispatch");
  assert.deepEqual(attachedPayload.ids.topologyRunIds, appliedPayload.ids.topologyRunIds);
});
