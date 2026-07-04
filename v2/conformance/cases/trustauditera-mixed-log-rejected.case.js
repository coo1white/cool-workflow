#!/usr/bin/env node
"use strict";

// Trust-audit "era" rule (ledger-trust.md risk #10 / invariant #10):
// a run's trust-audit event log is written by ONE code version, so it must
// be either fully chained (every line has a real prevEventHash-linked
// eventHash) or fully "legacy" (pre-chaining, no hash fields at all -- this
// is `unchained` by design, not a failure). A MIXED log -- one or more
// hash-less lines spliced into an otherwise-chained log -- must be
// REJECTED by `cw audit verify`: this is what a forger who drops a fabricated
// event into a real chain (hoping "legacy" reads as an allowed shape) would
// produce, and it must be caught, not silently accepted as "partially
// verified" or waved through as "legacy".
//
// The chained log is built the only way a case may build one black-box: a
// real stub-agent run through the CLI (this is what actually writes
// audit/events.jsonl -- see ledger-trust.md's "Files on disk" table). The
// case then hand-splices exactly one legacy-shaped (hash-less) line into
// the middle of that real, otherwise-valid file and re-verifies.

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

// Strip the hash-chain fields off a real event to fabricate a pre-chaining
// "legacy" line -- same shape a log written before the chaining feature
// existed would have: every OTHER field present, just no prevEventHash/
// eventHash.
function toLegacyLine(event, id) {
  const legacy = Object.assign({}, event);
  delete legacy.prevEventHash;
  delete legacy.eventHash;
  legacy.id = id;
  return JSON.stringify(legacy);
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const runId = JSON.parse(r.stdout).runId;

  const evPath = eventsPath(repo, runId);
  const original = readLines(evPath);
  assert.ok(original.length >= 4, "a real run must produce several trust-audit events to splice into");

  // --- sanity baseline: the real, untouched chain verifies clean ---
  const baseline = run(["audit", "verify", runId], { cwd: repo });
  assert.equal(baseline.status, 0);
  const baselineResult = JSON.parse(baseline.stdout);
  assert.equal(baselineResult.verified, true);
  assert.equal(baselineResult.eventCount, original.length);
  assert.equal(baselineResult.chained, original.length);
  assert.equal(baselineResult.unchained, 0);
  assert.deepEqual(baselineResult.failedChecks, []);

  // --- contrast: an ALL-legacy log (every line hash-less) verifies TRUE,
  // just with unchained counts -- this is the "not a failure" shape a mixed
  // log must NOT be confused with.
  const allLegacyLines = original.map((line, i) => toLegacyLine(JSON.parse(line), `audit-legacy-${i}`));
  writeLines(evPath, allLegacyLines);
  const allLegacyVerify = run(["audit", "verify", runId], { cwd: repo });
  assert.equal(allLegacyVerify.status, 0, "an all-legacy (pre-chaining) log is unchained-by-design, not a forgery");
  const allLegacyResult = JSON.parse(allLegacyVerify.stdout);
  assert.equal(allLegacyResult.verified, true);
  assert.equal(allLegacyResult.chained, 0);
  assert.equal(allLegacyResult.unchained, original.length);
  assert.deepEqual(allLegacyResult.failedChecks, []);

  // restore the real chained log before mutating it again
  writeLines(evPath, original);

  // --- the actual gap: splice ONE hash-less legacy line into the MIDDLE of
  // the otherwise-valid chained log. This is a mixed-era log and must be
  // REJECTED with a distinct code, not accepted as clean or as "legacy".
  const mid = Math.floor(original.length / 2);
  const midEvent = JSON.parse(original[mid]);
  const spliced = original.slice();
  spliced.splice(mid, 0, toLegacyLine(midEvent, "audit-legacy-splice-mid-0001"));
  writeLines(evPath, spliced);

  const mixedVerify = run(["audit", "verify", runId], { cwd: repo });
  assert.equal(mixedVerify.status, 1, "a mixed chained/legacy log must fail closed, exit 1");
  const mixedResult = JSON.parse(mixedVerify.stdout);
  assert.equal(mixedResult.present, true);
  assert.equal(mixedResult.verified, false, "must NOT be silently accepted as verified");
  assert.equal(mixedResult.eventCount, original.length + 1);
  assert.equal(mixedResult.unchained, 1, "exactly the one spliced legacy line is counted unchained");
  assert.equal(mixedResult.chained, original.length);
  assert.ok(mixedResult.failedChecks.length > 0, "the mixed log must carry at least one failed check");
  const codes = mixedResult.failedChecks.map((c) => c.code);
  assert.ok(
    codes.includes("trust-audit-unchained-event"),
    `expected a trust-audit-unchained-event failure, got: ${JSON.stringify(mixedResult.failedChecks)}`
  );
  // this is a DISTINCT code from a plain broken-chain or corrupt-line failure
  const names = mixedResult.failedChecks.map((c) => c.name);
  assert.ok(names.includes("unchained-events"), "the unchained-events check name must be present");

  // --- isolate the signal further: splice the SAME kind of legacy line at
  // the very END of the chain (no following chained event whose prevHash
  // would also break), so the ONLY failure possible is the era-mix
  // rejection itself, not a knock-on chain-link break.
  const lastEvent = JSON.parse(original[original.length - 1]);
  const splicedAtEnd = original.slice();
  splicedAtEnd.push(toLegacyLine(lastEvent, "audit-legacy-splice-end-0001"));
  writeLines(evPath, splicedAtEnd);

  const endVerify = run(["audit", "verify", runId], { cwd: repo });
  assert.equal(endVerify.status, 1);
  const endResult = JSON.parse(endVerify.stdout);
  assert.equal(endResult.verified, false);
  assert.equal(endResult.unchained, 1);
  assert.equal(endResult.chained, original.length);
  assert.deepEqual(
    endResult.failedChecks,
    [{ name: "unchained-events", code: "trust-audit-unchained-event" }],
    "with no following chained event to break, the ONLY failure is the era-mix rejection itself -- " +
      "a distinct code from both a clean chain (no failedChecks) and a broken-chain-link failure"
  );
});
