#!/usr/bin/env node
"use strict";

// multi-agent run|role|group (kernel create, no --topology) — the raw
// MultiAgentRun/AgentRole/AgentGroup records, reachable directly from the CLI
// with no worker, no agent, no topology. Pins: the id scheme prefix-NNNN
// (mar-0001, role-0001, group-0001) from collection position, the duplicate-id
// error, unknown-id error, and the chair/judge title-substring trust-policy
// derivation (policyForRole).

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

  // Kernel create with an explicit --id: raw MultiAgentRun record (not a
  // host envelope) with id mar-0001, status planned.
  const created = run(["multi-agent", "run", runId, "--id", "mar-0001", "--json"], { cwd: repo });
  assert.equal(created.status, 0, created.stderr);
  const mar = JSON.parse(created.stdout);
  assert.equal(mar.id, "mar-0001");
  assert.equal(mar.status, "planned");
  assert.equal(mar.runId, runId);

  // Duplicate id throws the exact kernel error (CLI wraps it with a "Try:" tip).
  const dup = run(["multi-agent", "run", runId, "--id", "mar-0001"], { cwd: repo });
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /^cw: Duplicate MultiAgentRun id: mar-0001\n/);

  // Roles mint role-0001, role-0002 by collection position (padStart 4, "0").
  const judgeRole = run(
    ["multi-agent", "role", runId, "--multi-agent-run", "mar-0001", "--title", "Judge", "--json"],
    { cwd: repo }
  );
  assert.equal(judgeRole.status, 0, judgeRole.stderr);
  const judgeRolePayload = JSON.parse(judgeRole.stdout);
  assert.equal(judgeRolePayload.id, "role-0001");
  assert.equal(judgeRolePayload.multiAgentRunId, "mar-0001");
  // Title "Judge" (substring "judge") -> judge verdict+rationale write ops,
  // candidate score only (no select, no chair-only ops).
  assert.deepEqual(judgeRolePayload.policy.allowedJudgeOperations, ["verdict", "rationale"]);
  assert.deepEqual(judgeRolePayload.policy.allowedCandidateOperations, ["score"]);
  assert.ok(
    !judgeRolePayload.policy.allowedWriteOperations.includes("snapshot"),
    "a plain judge role does not get the chair's snapshot write op"
  );

  const chairRole = run(
    ["multi-agent", "role", runId, "--multi-agent-run", "mar-0001", "--title", "Panel Chair", "--json"],
    { cwd: repo }
  );
  assert.equal(chairRole.status, 0, chairRole.stderr);
  const chairRolePayload = JSON.parse(chairRole.stdout);
  assert.equal(chairRolePayload.id, "role-0002", "second role in the collection");
  // Title "Panel Chair" (substring "chair") -> chair ops: snapshot +
  // coordinator-decision writes, candidate score+select, judge rationale+panel-decision.
  assert.deepEqual(chairRolePayload.policy.allowedCandidateOperations, ["score", "select"]);
  assert.deepEqual(chairRolePayload.policy.allowedJudgeOperations, ["rationale", "panel-decision"]);
  assert.ok(chairRolePayload.policy.allowedWriteOperations.includes("snapshot"));
  assert.ok(chairRolePayload.policy.allowedWriteOperations.includes("coordinator-decision"));

  // requiredEvidenceFor is the fixed map on every role's policy.
  assert.deepEqual(judgeRolePayload.policy.requiredEvidenceFor, {
    "judge.rationale": ["judge rationale evidence"],
    "judge.verdict": ["judge verdict evidence"],
    "judge.panel-decision": ["judge messages", "score evidence", "coordinator decision"],
    "candidate.select": ["score evidence", "judge rationale"],
  });

  // Groups mint group-0001.
  const group = run(
    ["multi-agent", "group", runId, "--multi-agent-run", "mar-0001", "--title", "G1", "--json"],
    { cwd: repo }
  );
  assert.equal(group.status, 0, group.stderr);
  const groupPayload = JSON.parse(group.stdout);
  assert.equal(groupPayload.id, "group-0001");
  assert.equal(groupPayload.status, "forming");
  // Group policy is wide open: all write/candidate/judge ops allowed.
  assert.deepEqual(groupPayload.policy.allowedCandidateOperations, ["register", "score", "select"]);
  assert.deepEqual(groupPayload.policy.allowedJudgeOperations, ["verdict", "rationale", "panel-decision"]);

  // multi-agent show <id> round-trips the created record; unknown id throws.
  const shown = run(["multi-agent", "show", runId, "mar-0001", "--json"], { cwd: repo });
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).id, "mar-0001");

  const showUnknown = run(["multi-agent", "show", runId, "mar-9999"], { cwd: repo });
  assert.equal(showUnknown.status, 1);
  assert.match(showUnknown.stderr, /Unknown MultiAgentRun id.*mar-9999/);
});
