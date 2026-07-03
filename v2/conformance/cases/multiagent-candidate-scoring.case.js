#!/usr/bin/env node
"use strict";

// candidate register|score|rank|select — the candidate scoring gate, exercised
// on a plain planned run with a manual candidate (no worker, no agent, no
// multi-agent topology needed). Pins: default candidate id scheme, the
// score-requires-evidence fail-closed error, the score math (total/maxTotal/
// normalized/verdict), ranking.json's policy defaults, and the
// verifier-gate error when selecting without a verified verifier node.

const { run, gitRepo, readJson, caseMain, assert } = require("../lib");
const path = require("node:path");

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

  // Register a manual candidate: default id candidate-manual-0001.
  const registered = run(["candidate", "register", runId, "--json"], { cwd: repo });
  assert.equal(registered.status, 0, registered.stderr);
  const candidate = JSON.parse(registered.stdout);
  assert.equal(candidate.id, "candidate-manual-0001");
  assert.equal(candidate.kind, "manual");
  assert.equal(candidate.status, "registered");

  // Re-registering the same id is idempotent: same record comes back.
  const reRegistered = run(["candidate", "register", runId, "--id", candidate.id, "--json"], { cwd: repo });
  assert.equal(reRegistered.status, 0, reRegistered.stderr);
  assert.equal(JSON.parse(reRegistered.stdout).id, candidate.id);

  // Scoring with no evidence fails closed with the exact error string.
  const scoreNoEvidence = run(
    ["candidate", "score", runId, candidate.id, "--criterion", "correctness=1"],
    { cwd: repo }
  );
  assert.equal(scoreNoEvidence.status, 1);
  assert.equal(scoreNoEvidence.stderr, `cw: Candidate ${candidate.id} score requires evidence\n`);

  // Scoring with evidence: total/maxTotal/normalized/verdict math.
  const scored = run(
    ["candidate", "score", runId, candidate.id, "--criterion", "correctness=1", "--evidence", "a.txt:1", "--json"],
    { cwd: repo }
  );
  assert.equal(scored.status, 0, scored.stderr);
  const scorePayload = JSON.parse(scored.stdout);
  assert.equal(scorePayload.id, `score-${candidate.id}-0001`);
  assert.deepEqual(scorePayload.criteria, { correctness: 1 });
  assert.equal(scorePayload.total, 1);
  assert.equal(scorePayload.maxTotal, 1, "maxTotal defaults to max(total,1)");
  assert.equal(scorePayload.normalized, 1);
  assert.equal(scorePayload.verdict, "pass", "normalized >= 0.7 is a pass");

  // rank writes ranking.json with the default policy and a 1-based rank.
  const ranked = run(["candidate", "rank", runId, "--json"], { cwd: repo });
  assert.equal(ranked.status, 0, ranked.stderr);
  const rankPayload = JSON.parse(ranked.stdout);
  assert.deepEqual(rankPayload.policy, {
    id: "cw.candidate.default",
    title: "Default Candidate Scoring",
    requireEvidence: true,
    requireVerifierGate: true,
    tieBreaker: "createdAt",
  });
  assert.equal(rankPayload.candidates.length, 1);
  assert.equal(rankPayload.candidates[0].candidateId, candidate.id);
  assert.equal(rankPayload.candidates[0].rank, 1);
  assert.equal(rankPayload.candidates[0].verdict, "pass");
  assert.deepEqual(rankPayload.ties, []);

  const rankingPath = path.join(repo, ".cw", "runs", runId, "candidates", "ranking.json");
  const onDisk = readJson(rankingPath);
  assert.equal(onDisk.candidates[0].candidateId, candidate.id);

  // Selecting without a verified verifier node is blocked with the exact
  // error — the verifier gate applies even to a manually-scored candidate.
  const selectBlocked = run(["candidate", "select", runId, candidate.id], { cwd: repo });
  assert.equal(selectBlocked.status, 1);
  assert.equal(selectBlocked.stderr, `cw: Candidate ${candidate.id} requires a verified verifier node\n`);

  // Unknown candidate id gives the exact "Unknown candidate" error (once a
  // criterion is present, else "Missing score criteria" fires first).
  const unknown = run(
    ["candidate", "score", runId, "candidate-does-not-exist", "--criterion", "correctness=1", "--evidence", "a.txt:1"],
    { cwd: repo }
  );
  assert.equal(unknown.status, 1);
  assert.equal(
    unknown.stderr,
    `cw: Unknown candidate for run ${runId}: candidate-does-not-exist\n`
  );
});
