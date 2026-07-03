#!/usr/bin/env node
"use strict";

// Review-gate STACKING never replaces a verifier error (multi-agent.md risk
// #8: "the review gate stacking (append-only, never replacing verifier
// errors) are load-bearing"). The review gate runs INSIDE selectCandidate,
// AFTER the verifier checks, and can only ADD errors.
//
// Pins two things with one candidate:
// 1. When BOTH a real verifier error (no verified verifier node at all) AND
//    a review-gate rejection are present at once, `candidate select` throws
//    BOTH messages joined with "; ", verifier error first — the verifier
//    error is never dropped or overwritten by the review-gate's own reason.
// 2. When the review gate IS satisfied (an authorized approval, no veto),
//    the verifier error surfaces ALONE — the review gate adds nothing when
//    it has nothing to add.

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

  // --- Case A: rejection stacks ON TOP of the verifier error -------------
  const runIdA = planRun(repo, "q1");

  const registeredA = run(["candidate", "register", runIdA, "--json"], { cwd: repo });
  assert.equal(registeredA.status, 0, registeredA.stderr);
  const candidateA = JSON.parse(registeredA.stdout);

  // Gate selection on 1 approval from an authorized "lead" role.
  const policyA = run(
    ["review", "policy", runIdA, "--requiredApprovals", "1", "--authorizedRoles", "lead", "--appliesTo", "selection", "--json"],
    { cwd: repo }
  );
  assert.equal(policyA.status, 0, policyA.stderr);

  // A blocking veto: an authorized, attested reject.
  const rejectA = run(
    ["reject", "candidate", runIdA, candidateA.id, "--actor", "alice", "--role", "lead", "--attested", "--rationale", "not good"],
    { cwd: repo }
  );
  assert.equal(rejectA.status, 0, rejectA.stderr);

  // This candidate was never scored/verified, so selectCandidate's OWN
  // verifier check ("Candidate <id> requires a verified verifier node")
  // fires too. Both failures must show up, joined by "; ", verifier error
  // first — the review gate's rejection message is appended, not swapped in.
  const selectA = run(["candidate", "select", runIdA, candidateA.id], { cwd: repo });
  assert.equal(selectA.status, 1);
  assert.equal(
    selectA.stderr,
    `cw: Candidate ${candidateA.id} requires a verified verifier node; Review gate blocked (rejected): rejected by alice (not good)\n`
  );

  // --- Case B: gate satisfied -> verifier error surfaces ALONE -----------
  const runIdB = planRun(repo, "q2");

  const registeredB = run(["candidate", "register", runIdB, "--json"], { cwd: repo });
  assert.equal(registeredB.status, 0, registeredB.stderr);
  const candidateB = JSON.parse(registeredB.stdout);

  const policyB = run(
    ["review", "policy", runIdB, "--requiredApprovals", "1", "--authorizedRoles", "lead", "--appliesTo", "selection", "--json"],
    { cwd: repo }
  );
  assert.equal(policyB.status, 0, policyB.stderr);

  // An authorized, attested approval satisfies the quorum this time.
  const approveB = run(
    ["approve", "candidate", runIdB, candidateB.id, "--actor", "alice", "--role", "lead", "--attested"],
    { cwd: repo }
  );
  assert.equal(approveB.status, 0, approveB.stderr);

  // The review gate has nothing to add now (status "approved"). Only the
  // pre-existing verifier error is thrown — no trailing "; Review gate..."
  // clause, and no silent pass either.
  const selectB = run(["candidate", "select", runIdB, candidateB.id], { cwd: repo });
  assert.equal(selectB.status, 1);
  assert.equal(selectB.stderr, `cw: Candidate ${candidateB.id} requires a verified verifier node\n`);
});
