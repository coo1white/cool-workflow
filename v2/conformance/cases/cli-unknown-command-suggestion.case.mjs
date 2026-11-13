#!/usr/bin/env node

// cli-unknown-command-suggestion — suggestCommand's exact threshold rule
// (SPEC/cli-surface.md: distance <= 3 AND distance <= input.length/2;
// inputs under 2 chars get nothing), and that a verb removed in batch 5
// (2026-11-12) is now an unknown command. This case extends
// version-basic.case.mjs's single unknown-command pin (nosuchcommand -> no
// suggestion) — do not duplicate that check here.

import { run, caseMain, assert } from "../lib.mjs";

caseMain(() => {
  // A single character input gets NOTHING, even one edit away from a
  // one-letter... there is no one-letter command, but the length-based cutoff
  // still applies at the boundary: inputs under 2 chars never get a hint.
  const oneChar = run(["x"]);
  assert.equal(oneChar.status, 1);
  assert.equal(oneChar.stderr, "cw: Unknown command: x\n  Try: cw help\n");

  // Two chars, no command within distance 3 (and <= half the input length
  // means distance must be <= 1 for a 2-char input) -> no suggestion.
  const twoChar = run(["xy"]);
  assert.equal(twoChar.status, 1);
  assert.equal(twoChar.stderr, "cw: Unknown command: xy\n  Try: cw help\n");

  // Close typos of real top-level commands DO get a "Did you mean" tail.
  const closeToVersion = run(["versio"]);
  assert.equal(closeToVersion.status, 1);
  assert.equal(closeToVersion.stderr, "cw: Unknown command: versio. Did you mean: version?\n  Try: cw help\n");

  const closeToHelp = run(["helpp"]);
  assert.equal(closeToHelp.status, 1);
  assert.equal(closeToHelp.stderr, "cw: Unknown command: helpp. Did you mean: help?\n  Try: cw help\n");

  // A typo far enough away (distance > 3, or > half the input length) gets
  // no suggestion even though it superficially resembles a real command.
  const farVersion = run(["vvvvvversion"]);
  assert.equal(farVersion.status, 1);
  assert.doesNotMatch(farVersion.stderr, /Did you mean/);

  // Every kept verb is in the suggestion list.
  for (const [typo, verb] of [["reprot", "report"], ["chek", "check"]]) {
    const r = run([typo]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `cw: Unknown command: ${typo}. Did you mean: ${verb}?\n  Try: cw help\n`);
  }

  // A verb removed in batch 5 fails closed as unknown, exit 1, stdout empty.
  for (const removed of ["ledger", "run", "quickstart", "audit", "telemetry", "doctor", "fix", "demo"]) {
    const r = run([removed]);
    assert.equal(r.status, 1, `cw ${removed}`);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, new RegExp(`^cw: Unknown command: ${removed}`));
  }
});
