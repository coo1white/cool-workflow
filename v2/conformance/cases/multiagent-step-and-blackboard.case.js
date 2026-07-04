#!/usr/bin/env node
"use strict";

// multi-agent step / multi-agent blackboard — deterministic one-step-at-a-time
// host loop and the coordinator's blackboard summary, all reachable without
// dispatching a worker or calling an agent. Pins: "needs-run" step collapses
// to performed="none" with a requiredHostAction and nextAction "host-action";
// blackboard access before any topology throws the exact "no blackboard"
// error; after applying a topology, one step creates exactly one dispatch
// manifest (never more) and multi-agent blackboard summary reads it back.

const { run, gitRepo, caseMain, assert } = require("../lib");

function planRun(repo, question) {
  const p = run(["plan", "architecture-review", "--arg", `repo=${repo}`, "--arg", `question=${question}`], {
    cwd: repo,
  });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout).runId;
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const runId = planRun(repo, "q1");

  // Step before any topology: performed none, requiredHostAction set, the
  // single next action collapses to the fixed host-action row.
  const stepNoTopology = run(["multi-agent", "step", runId, "--json"], { cwd: repo });
  assert.equal(stepNoTopology.status, 0, stepNoTopology.stderr);
  const stepPayload = JSON.parse(stepNoTopology.stdout);
  assert.equal(stepPayload.state, "needs-run");
  assert.equal(stepPayload.performed, "none");
  assert.ok(stepPayload.requiredHostAction, "requiredHostAction must be set");
  assert.equal(stepPayload.nextAction, "host-action");
  assert.deepEqual(stepPayload.nextActions, [
    { command: "host-action", reason: stepPayload.requiredHostAction, priority: "high" },
  ]);

  // Blackboard access before any topology throws the exact error.
  const blackboardNoTopology = run(["multi-agent", "blackboard", runId, "summary"], { cwd: repo });
  assert.equal(blackboardNoTopology.status, 1);
  assert.equal(
    blackboardNoTopology.stderr,
    `cw: Run ${runId} has no blackboard. Use multi-agent run --topology <id> first.\n`
  );

  // Apply a topology, then step once: exactly one dispatch manifest, for the
  // first fanout role only (never every task at once).
  const applied = run(["multi-agent", "run", runId, "--topology", "map-reduce", "--json"], { cwd: repo });
  assert.equal(applied.status, 0, applied.stderr);

  const step1 = run(["multi-agent", "step", runId, "--json"], { cwd: repo });
  assert.equal(step1.status, 0, step1.stderr);
  const step1Payload = JSON.parse(step1.stdout);
  assert.equal(step1Payload.performed, "created-dispatch-manifest");
  assert.equal(step1Payload.state, "awaiting-worker-output");
  assert.equal(step1Payload.paths.workerManifestPaths.length, 1, "one worker manifest per step");
  assert.equal(step1Payload.data.tasks.length, 1, "one task dispatched per step");

  // Stepping again with the same worker still running does not create a
  // second manifest: a running worker blocks further dispatch this step, and
  // the state itself reads "blocked" with the exact reason string.
  const step2 = run(["multi-agent", "step", runId, "--json"], { cwd: repo });
  assert.equal(step2.status, 0, step2.stderr);
  const step2Payload = JSON.parse(step2.stdout);
  assert.equal(step2Payload.performed, "none");
  assert.equal(step2Payload.state, "blocked");
  assert.deepEqual(step2Payload.blockedReasons, [
    `worker ${step1Payload.data.tasks[0].workerId} is running`,
  ]);

  // Blackboard summary now reads the applied topology's board.
  const blackboardSummary = run(["multi-agent", "blackboard", runId, "summary", "--json"], { cwd: repo });
  assert.equal(blackboardSummary.status, 0, blackboardSummary.stderr);
  const bbPayload = JSON.parse(blackboardSummary.stdout);
  assert.equal(bbPayload.performed, "read-blackboard");
  assert.equal(bbPayload.ids.blackboardIds.length, 1);
  assert.equal(bbPayload.ids.topicIds.length, 2, "map-reduce declares 2 blackboard topics");
  assert.deepEqual(bbPayload.evidenceRequirements, [
    "mapper output artifact",
    "blackboard artifact ref",
    "reducer synthesis",
  ]);

  // Unknown blackboard action throws the exact usage string (pass --topic so
  // the action check is reached instead of the ambiguous-topic guard, since
  // map-reduce boards start with 2 topics).
  const badAction = run(
    ["multi-agent", "blackboard", runId, "not-a-real-action", "--topic", "does-not-matter"],
    { cwd: repo }
  );
  assert.equal(badAction.status, 1);
  assert.equal(
    badAction.stderr,
    "cw: Usage: multi-agent blackboard <run-id> [summary|topics|messages|post|artifacts|add-artifact|context|snapshot]\n"
  );
});
