#!/usr/bin/env node
"use strict";

// trust-audit eventHash JSON round-trip drops nested undefined (ledger-trust.md
// risk #5, src/trust-audit.ts:72-86): eventHash = sha256(stableStringify(
// JSON.parse(JSON.stringify(event sans eventHash)))). The round-trip means the
// record-time hash (over an in-memory event object that may carry a
// correlation-id field set to undefined) must equal the verify-time hash
// (recomputed from the parsed-from-disk event, which never has that key at
// all -- JSON has no undefined). Get this wrong (e.g. naively hash the raw
// in-memory object, or serialize undefined as null) and either record-time
// and verify-time hashes disagree, or a null-vs-omitted rebuild produces a
// different byte stream and a different hash.
//
// CLI-reachable proof: `multi-agent.permission` events (recorded by the same
// code path on every authority check) carry `scoreId` as one of the 19
// pass-through CORRELATION_ID_FIELDS (ledger-trust.md: "audit/index.json ...
// omits scoreId from the correlation ids") -- it is set only when a score
// already exists in the caller's context, else it is genuinely absent
// (undefined at construction, not null) rather than explicitly cleared.
//
// A judge-panel run naturally produces BOTH shapes from the identical event
// kind at different points in one real workflow:
//   1. `multi-agent score` (a judge role scoring a candidate) checks the
//      `judge.rationale` permission BEFORE any score record exists -> its
//      `multi-agent.permission` event has candidateId but NO scoreId key.
//   2. `multi-agent select` (a non-authorized role attempting selection)
//      checks `candidate.select` AFTER a score exists -> its
//      `multi-agent.permission` event has BOTH candidateId and scoreId.
//
// Both events chain through the same hash-chained log, and `cw audit verify`
// must recompute both event hashes clean -- proving the round-trip-drop rule
// holds identically whether or not the optional field was present.

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

  const applied = run(["topology", "apply", runId, "judge-panel"], { cwd: repo });
  assert.equal(applied.status, 0, applied.stderr);
  const topoRun = JSON.parse(applied.stdout);
  const judgeRoleId = `${topoRun.id}-judge-1`;
  const chairRoleId = `${topoRun.id}-panel-chair`;

  const registered = run(["candidate", "register", runId, "--json"], { cwd: repo });
  assert.equal(registered.status, 0, registered.stderr);
  const candidateId = JSON.parse(registered.stdout).id;

  // Step 1: score under judge authority. This records a `judge.rationale`
  // permission check BEFORE any score exists for this candidate -- the
  // `multi-agent.permission` event this produces has candidateId (known:
  // the CLI resolved --candidate) but genuinely no scoreId at all (none
  // exists yet at the point the permission gate runs).
  const scored = run(
    [
      "multi-agent",
      "score",
      runId,
      "--candidate",
      candidateId,
      "--criterion",
      "correctness=4",
      "--evidence",
      "a.txt:1",
      "--role",
      judgeRoleId,
      "--reason",
      "solid work",
      "--json",
    ],
    { cwd: repo }
  );
  assert.equal(scored.status, 0, scored.stderr);

  // Step 2: attempt selection under the CHAIR role, with no accepted judge
  // rationale recorded for the chair itself -- this is denied, and by now a
  // score record DOES exist for the candidate, so the resulting
  // `candidate.select` `multi-agent.permission` event carries BOTH
  // candidateId AND scoreId (the CLI folds in the known score context).
  const selectDenied = run(
    [
      "multi-agent",
      "select",
      runId,
      "--candidate",
      candidateId,
      "--role",
      chairRoleId,
      "--reason",
      "chair pick",
      "--allow-unverified",
      "--json",
    ],
    { cwd: repo }
  );
  assert.equal(selectDenied.status, 1, "chair has no accepted judge rationale for this candidate -- selection is denied");

  // Read the raw hash-chained log the CLI wrote and find both permission
  // events by their distinguishing `metadata.operation`.
  const eventsPath = path.join(repo, ".cw", "runs", runId, "audit", "events.jsonl");
  const lines = require("node:fs")
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  const permissionEvents = lines.filter((e) => e.kind === "multi-agent.permission");
  assert.ok(permissionEvents.length >= 2, "expected at least one judge.rationale-gate and one candidate.select-gate permission event");

  const scoreGateEvent = permissionEvents.find((e) => e.metadata && e.metadata.operation === "judge.rationale");
  const selectGateEvent = permissionEvents.find((e) => e.metadata && e.metadata.operation === "candidate.select");
  assert.ok(scoreGateEvent, "expected a judge.rationale permission-check event from the score step");
  assert.ok(selectGateEvent, "expected a candidate.select permission-check event from the select step");

  // The core assertion: same event kind, same candidateId in scope, but
  // scoreId is a genuinely OMITTED key (not null) on the earlier event and a
  // genuinely PRESENT key on the later one -- not two different shapes
  // hand-crafted for the test, but the CLI's own natural output at two
  // different points in one real workflow.
  assert.equal(scoreGateEvent.candidateId, candidateId);
  assert.ok(!("scoreId" in scoreGateEvent), "the judge.rationale permission event has no score yet -- scoreId must be OMITTED, not null");

  assert.equal(selectGateEvent.candidateId, candidateId);
  assert.ok("scoreId" in selectGateEvent, "the candidate.select permission event runs after scoring -- scoreId must be a present key");
  assert.equal(typeof selectGateEvent.scoreId, "string");

  // Both events still carry a hash-chain pair (prevEventHash/eventHash) --
  // this run predates neither, so both are chained, not legacy.
  assert.match(scoreGateEvent.eventHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(selectGateEvent.eventHash, /^sha256:[0-9a-f]{64}$/);

  // The proof that matters: `cw audit verify` independently recomputes every
  // eventHash from the FILE (the parsed-from-disk form, which never has an
  // undefined key at all) and must match what was persisted at record time
  // for BOTH shapes -- the omitted-scoreId event and the present-scoreId
  // event both re-hash clean side by side in the same chain. If the record-
  // time hash had been taken over the raw in-memory object (with `scoreId:
  // undefined` as an actual own key) instead of the round-tripped form, the
  // two hashing passes would disagree and this would report a digest
  // mismatch on the very event that omits the field.
  const verify = run(["audit", "verify", runId, "--json"], { cwd: repo });
  assert.equal(verify.status, 0, verify.stderr);
  const verifyResult = JSON.parse(verify.stdout);
  assert.equal(verifyResult.present, true);
  assert.equal(verifyResult.verified, true, "both the omitted-scoreId and present-scoreId events must independently re-hash clean");
  assert.equal(verifyResult.corruptLines, 0);
  assert.deepEqual(verifyResult.failedChecks, []);
  assert.equal(verifyResult.chained, verifyResult.eventCount, "every event, including both permission-check shapes, is chained");
});
