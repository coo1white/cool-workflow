#!/usr/bin/env node
"use strict";

// cli-unknown-flag-warning.test — an unknown flag used to be dropped with
// no sound (`cw doctor --jsno` ran fine, exit 0). This pins the additive,
// fail-open fix (cli/global-flags.ts): ONLY a row that declares
// `flagsComplete: true` is checked, the warning is ONE stderr line, and
// it prints ONLY when stderr is a real TTY — a piped/scripted run stays
// byte-silent, so no conformance case or script can ever see it.
//
// Fake-stream style of test/workbench-serve-tty-hint.test.js.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { GLOBAL_CLI_FLAGS, unknownFlagKeys, warnUnknownFlags } = require(path.join(pluginRoot, "dist", "cli", "global-flags.js"));
const { REGISTRY } = require(path.join(pluginRoot, "dist", "core", "capability-table.js"));

function fakeStream(isTTY) {
  const buf = [];
  return { isTTY, write: (s) => (buf.push(String(s)), true), text: () => buf.join("") };
}

function rowCli(capability) {
  const row = REGISTRY.find((r) => r.capability === capability);
  assert.ok(row && row.cli, `${capability} must have a cli binding`);
  return row.cli;
}

// ===== 1. unknown flag on a marked row + TTY stderr -> exactly one warning line =====
{
  const doctor = rowCli("doctor");
  assert.equal(doctor.flagsComplete, true, "doctor must be marked flagsComplete");
  const s = fakeStream(true);
  warnUnknownFlags(doctor, { jsno: true }, s);
  assert.equal(s.text(), "cw: warning: unknown flag --jsno (see: cw help doctor)\n", "one warning line for one unknown flag");

  const s2 = fakeStream(true);
  warnUnknownFlags(doctor, { jsno: true, verbos: true }, s2);
  assert.equal(s2.text(), "cw: warning: unknown flags --jsno, --verbos (see: cw help doctor)\n", "still ONE line for two unknown flags");
  console.log("cli-unknown-flag-warning: a marked row warns once on a TTY ok");
}

// ===== 2. every legitimate flag (row flags + globals, both spellings) -> silent =====
{
  const doctor = rowCli("doctor");
  const s = fakeStream(true);
  const legit = { onramp: true, fix: true, "changed-from": "HEAD~1", changedFrom: "HEAD~1", json: true, cwd: "." };
  for (const key of GLOBAL_CLI_FLAGS) legit[key] = true;
  warnUnknownFlags(doctor, legit, s);
  assert.equal(s.text(), "", "no warning for any declared or global flag, in either spelling");

  const ledgerPropose = rowCli("ledger.propose");
  assert.equal(ledgerPropose.flagsComplete, true, "ledger.propose must be marked flagsComplete");
  const s2 = fakeStream(true);
  warnUnknownFlags(ledgerPropose, { from: "a", to: "b", title: "t", rationale: "r", files: "x,y", diff: "d" }, s2);
  assert.equal(s2.text(), "", "every flag ledgerProposeCli reads is known");

  const ledgerReview = rowCli("ledger.review");
  assert.equal(ledgerReview.flagsComplete, true, "ledger.review must be marked flagsComplete");
  const s3 = fakeStream(true);
  warnUnknownFlags(ledgerReview, { from: "a", to: "b", target: "id", verdict: "approved", findings: "f" }, s3);
  assert.equal(s3.text(), "", "every flag ledgerReviewCli reads is known");
  console.log("cli-unknown-flag-warning: all real flags stay silent ok");
}

// ===== 3. non-TTY -> silent, even with an unknown flag on a marked row =====
{
  const doctor = rowCli("doctor");
  const s = fakeStream(false);
  warnUnknownFlags(doctor, { jsno: true }, s);
  assert.equal(s.text(), "", "a piped stderr never sees the warning");
  const s2 = fakeStream(undefined);
  warnUnknownFlags(doctor, { jsno: true }, s2);
  assert.equal(s2.text(), "", "isTTY undefined counts as not a TTY");
  console.log("cli-unknown-flag-warning: non-TTY stays byte-silent ok");
}

// ===== 4. an unmarked row -> always silent (fail-open by design) =====
{
  const quickstart = rowCli("quickstart");
  assert.notEqual(quickstart.flagsComplete, true, "quickstart must NOT be marked (its option surface was not fully verified)");
  const s = fakeStream(true);
  warnUnknownFlags(quickstart, { "definitely-not-a-flag": true }, s);
  assert.equal(s.text(), "", "an unmarked row never warns, even on a TTY");
  assert.deepEqual(unknownFlagKeys(quickstart, { x: 1 }), [], "unknownFlagKeys is empty for an unmarked row");
  console.log("cli-unknown-flag-warning: unmarked rows never warn ok");
}

console.log("cli-unknown-flag-warning.test: ok");
