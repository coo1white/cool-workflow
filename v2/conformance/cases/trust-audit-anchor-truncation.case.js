#!/usr/bin/env node
"use strict";

// Trust-audit head anchor (tail-truncation detection).
//
// A pure chain walk is blind to ONE tamper shape: delete the last N lines
// of audit/events.jsonl and the rest is a shorter but perfectly consistent
// chain — a plain `cw audit verify` stays green. The head anchor closes
// that hole without changing any old bytes:
//
//   - `cw audit head <run>` prints {eventCount, headHash} (read-only);
//   - `cw audit verify <run> --expect-head <hash> --expect-count <n>`
//     fails closed with the distinct code `trust-audit-truncated` when the
//     walked log comes up short of that earlier capture;
//   - with NO anchor flags, `audit verify` output stays byte-identical to
//     the pre-anchor shape (no `anchor` key), so old callers see no change.
//
// The chained log is built the only way a case may build one black-box: a
// real stub-agent run through the CLI (same recipe as
// trustauditera-mixed-log-rejected.case.js).

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

function eventsPath(repo, runId) {
  return path.join(repo, ".cw", "runs", runId, "audit", "events.jsonl");
}

function readLines(p) {
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

function writeLines(p, lines) {
  fs.writeFileSync(p, lines.join("\n") + "\n");
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const runId = JSON.parse(r.stdout).runId;

  const evPath = eventsPath(repo, runId);
  const original = readLines(evPath);
  assert.ok(original.length >= 4, "a real run must produce several trust-audit events to truncate");

  // --- capture the anchor: head hash + event count of the intact log ---
  const headRes = run(["audit", "head", runId], { cwd: repo });
  assert.equal(headRes.status, 0);
  assert.equal(headRes.stderr, "", "audit head: stderr must be empty");
  const head = JSON.parse(headRes.stdout);
  assert.equal(head.schemaVersion, 1);
  assert.equal(head.runId, runId);
  assert.equal(head.eventCount, original.length);
  const lastEvent = JSON.parse(original[original.length - 1]);
  assert.equal(head.headHash, lastEvent.eventHash, "the head anchor is the last event's eventHash");

  // --- POLA: a plain (un-anchored) verify keeps its exact pre-anchor
  // output shape — no `anchor` key, verified green.
  const plainBaseline = run(["audit", "verify", runId], { cwd: repo });
  assert.equal(plainBaseline.status, 0);
  const plainResult = JSON.parse(plainBaseline.stdout);
  assert.equal(plainResult.verified, true);
  assert.ok(!("anchor" in plainResult), "no anchor flags -> no anchor key in the output");

  // --- an anchored verify on the INTACT log passes and echoes the anchor ---
  const okAnchored = run(
    ["audit", "verify", runId, "--expect-head", head.headHash, "--expect-count", String(head.eventCount)],
    { cwd: repo }
  );
  assert.equal(okAnchored.status, 0);
  const okResult = JSON.parse(okAnchored.stdout);
  assert.equal(okResult.verified, true);
  assert.deepEqual(okResult.anchor, {
    expectHead: head.headHash,
    expectCount: head.eventCount,
    satisfied: true,
  });

  // --- the gap itself: cut the last 2 lines off the log. The chain that
  // remains is consistent, so a plain verify MUST still read green (this
  // is exactly why the anchor exists — pin the gap so a future "fix" that
  // changes plain-verify behavior is a deliberate, versioned choice).
  writeLines(evPath, original.slice(0, original.length - 2));
  const plainTruncated = run(["audit", "verify", runId], { cwd: repo });
  assert.equal(plainTruncated.status, 0, "a plain chain walk cannot see tail truncation");
  const plainTruncatedResult = JSON.parse(plainTruncated.stdout);
  assert.equal(plainTruncatedResult.verified, true);
  assert.equal(plainTruncatedResult.eventCount, original.length - 2);

  // --- the anchored verify catches it: exit 1, distinct code, both the
  // count shortfall and the missing head are reported.
  const caught = run(
    ["audit", "verify", runId, "--expect-head", head.headHash, "--expect-count", String(head.eventCount)],
    { cwd: repo }
  );
  assert.equal(caught.status, 1, "an anchored verify of a truncated log must fail closed, exit 1");
  const caughtResult = JSON.parse(caught.stdout);
  assert.equal(caughtResult.verified, false);
  assert.equal(caughtResult.anchor.satisfied, false);
  assert.deepEqual(
    caughtResult.failedChecks,
    [
      { name: "anchor-count", code: "trust-audit-truncated" },
      { name: "anchor-head", code: "trust-audit-truncated" },
    ],
    "truncation is a DISTINCT code from digest/chain/era failures"
  );

  // --- truncate-then-append forgery: pad the shortened log back past the
  // captured count with real appended events (audit attest writes one).
  // The count check is satisfied, but the captured head is no longer ON
  // the chain (new events link from an earlier point) — still caught.
  for (let i = 0; i < 3; i++) {
    const attest = run(["audit", "attest", runId, "--note", `pad-${i}`], { cwd: repo });
    assert.equal(attest.status, 0);
  }
  const padded = run(["audit", "head", runId], { cwd: repo });
  assert.ok(JSON.parse(padded.stdout).eventCount >= head.eventCount, "the padded log reaches the captured count");
  const forged = run(
    ["audit", "verify", runId, "--expect-head", head.headHash, "--expect-count", String(head.eventCount)],
    { cwd: repo }
  );
  assert.equal(forged.status, 1, "a truncated-then-padded log must still fail the head check");
  const forgedResult = JSON.parse(forged.stdout);
  assert.equal(forgedResult.verified, false);
  assert.deepEqual(
    forgedResult.failedChecks,
    [{ name: "anchor-head", code: "trust-audit-truncated" }],
    "with the count padded back, the missing head is the one remaining failure"
  );

  // --- malformed anchor flags fail closed (never silently weaken the
  // check the caller asked for).
  const badCount = run(["audit", "verify", runId, "--expect-count", "abc"], { cwd: repo });
  assert.equal(badCount.status, 1);
  assert.match(badCount.stderr, /--expect-count requires a non-negative integer/);
  const bareHead = run(["audit", "verify", runId, "--expect-head"], { cwd: repo });
  assert.equal(bareHead.status, 1);
  assert.match(bareHead.stderr, /--expect-head requires a hash value/);
});
