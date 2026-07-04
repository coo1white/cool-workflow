#!/usr/bin/env node
"use strict";

// cli-command-help-shape — formatCommandHelp details not already pinned by
// cli-help-topics.case.js's byte-exact fixture diffs: the "Did you mean"
// tail for a near-typo of a REAL verb topic (distinct from the no-match
// and the audit-run self-suggestion cases already covered there), and the
// doubled-row shape for a family whose subcommand table intentionally
// lists the same command path twice with different one-line summaries
// (get/set or preview/drive pairs) — the SPEC's "odd things" #5.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  // A near-typo of a REAL command gets both an Unknown-command line and a
  // "Did you mean" tail naming the close command — exit 0 regardless.
  const typoAudit = run(["help", "auditt"]);
  assert.equal(typoAudit.status, 0);
  assert.equal(typoAudit.stdout, "Unknown command: auditt\n  Did you mean:  cw audit\n  Try:  cw help   (list all commands)\n");

  const typoWorker = run(["help", "workr"]);
  assert.equal(typoWorker.status, 0);
  assert.equal(typoWorker.stdout, "Unknown command: workr\n  Did you mean:  cw worker\n  Try:  cw help   (list all commands)\n");

  // Doubled rows: `backend agent config` appears twice (show + set forms)
  // with the SAME left-hand command path but different summaries — a
  // rebuild's help printer must not de-duplicate identical command paths.
  const backendHelp = run(["help", "backend"]);
  assert.equal(backendHelp.status, 0);
  const backendConfigRows = backendHelp.stdout.split("\n").filter((l) => l.includes("cw backend agent config"));
  assert.equal(backendConfigRows.length, 2, "backend agent config must appear as two distinct rows");
  assert.notEqual(backendConfigRows[0], backendConfigRows[1], "the two rows must carry different summaries");
  assert.match(backendConfigRows[0], /Show the effective agent delegation config/);
  assert.match(backendConfigRows[1], /Set the durable agent delegation config/);

  // `run drive` is the other doubled-row example: preview form + the
  // mutating drive form, same left-hand path, two summaries.
  const runHelp = run(["help", "run"]);
  assert.equal(runHelp.status, 0);
  const runDriveRows = runHelp.stdout.split("\n").filter((l) => /^ {2}cw run drive\s/.test(l));
  assert.equal(runDriveRows.length, 2, "run drive must appear as two distinct rows");
  assert.match(runDriveRows[0], /Preview the next agent-delegation drive step/);
  assert.match(runDriveRows[1], /Drive a run by delegating each worker/);

  // Rows are sorted by command path and 2-space led, padded so the summary
  // column lines up — spot check the sort order for a known-small family.
  const stateHelp = run(["help", "state"]);
  assert.equal(stateHelp.stdout, "cw state\n\n  cw state check  Check run-state schema compatibility.\n");
});
