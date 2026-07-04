#!/usr/bin/env node
"use strict";

// cli-recovery-hint — the top-level catch's recoveryHint map
// (SPEC/cli-surface.md "Top-level error path"): the `Try: <cmd>` tail is
// picked by literal substring match against the thrown message text, not
// by which command failed. This case proves both sides: messages that DO
// contain a matching substring get the expected hint, and a message that
// superficially LOOKS like it should match ("not found") but does not
// contain the exact literal substring the map checks for ("run id" or
// "run not found") gets NO hint at all — a precise, easy-to-get-wrong
// string-matching detail, not a semantic one.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  // unknown command -> "cw help"
  const unknown = run(["nosuchcommand"]);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stderr, "cw: Unknown command: nosuchcommand\n  Try: cw help\n");

  // message contains "app" + "not found" -> "cw app list"
  const appNotFound = run(["info", "no-such-app-xyz"]);
  assert.equal(appNotFound.status, 1);
  assert.equal(appNotFound.stderr, "cw: Workflow app not found: no-such-app-xyz\n  Try: cw app list\n");

  const appNotFound2 = run(["plan", "no-such-app-xyz"]);
  assert.equal(appNotFound2.stderr, "cw: Workflow app not found: no-such-app-xyz\n  Try: cw app list\n");

  // message literally contains "run id" (as consecutive words, from
  // io.required's own fixed "Missing run id." text) -> "cw run list"
  const missingRunId = run(["next"]);
  assert.equal(missingRunId.status, 1);
  assert.equal(
    missingRunId.stderr,
    'cw: Missing run id.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"\n  Try: cw run list\n'
  );

  // NEGATIVE proof: a message that talks about a run not being found, but
  // does NOT contain the literal substring "run id" or "run not found"
  // (the run id is spliced in the middle: "run no-such-run-id not found"),
  // gets NO Try: line at all. The hint map is exact-substring, not
  // semantic — a rebuild that "fixes" this to be smarter would diverge.
  const archiveMissing = run(["run", "archive", "no-such-run-id", "--json"]);
  assert.equal(archiveMissing.status, 1);
  assert.equal(archiveMissing.stdout, "");
  assert.equal(archiveMissing.stderr, "cw: Cannot archive: run no-such-run-id not found in source state (fail closed).\n");
  assert.doesNotMatch(archiveMissing.stderr, /Try:/);

  // "missing" + "repo" -> the -dir-flavored hint (quoting the question and
  // -dir explicitly). Triggered by an empty/invalid repo path so the run
  // dir creation itself fails with an ENOENT that reads "no such file or
  // directory" rather than a "missing ... repo" phrase — so instead prove
  // the missing+repo phrasing directly via the exact "Missing repository
  // path." shape thrown by io.required elsewhere. If no black-box trigger
  // exists for this exact branch without a real agent, this sub-case is
  // intentionally left out (see skipped_surface_items).

  // Every error above kept stdout perfectly empty — the recoverable-errors
  // invariant ("the error path never writes to stdout").
  for (const r of [unknown, appNotFound, appNotFound2, missingRunId, archiveMissing]) {
    assert.equal(r.stdout, "");
  }
});
