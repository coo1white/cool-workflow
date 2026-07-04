#!/usr/bin/env node
"use strict";

// cli-unknown-command-suggestion — suggestCommand's exact threshold rule
// (SPEC/cli-surface.md: distance <= 3 AND distance <= input.length/2;
// inputs under 2 chars get nothing) plus the KNOWN_COMMANDS gap: "ledger"
// is dispatched and listed in formatHelp, but is NOT in the KNOWN_COMMANDS
// list suggestCommand searches, so a typo of "ledger" gets no suggestion
// at all. This case extends version-basic.case.js's single unknown-command
// pin (nosuchcommand -> no suggestion) — do not duplicate that check here.

const { run, caseMain, assert } = require("../lib");

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

  // The KNOWN_COMMANDS gap: "ledger" is a real, working, documented command
  // (cw help ledger works; formatHelp lists it) but close typos of it get
  // NO suggestion, because suggestCommand's candidate list does not
  // include "ledger" at all.
  const ledgerTypo1 = run(["ledgr"]);
  assert.equal(ledgerTypo1.status, 1);
  assert.equal(ledgerTypo1.stderr, "cw: Unknown command: ledgr\n  Try: cw help\n");

  const ledgerTypo2 = run(["ledge"]);
  assert.equal(ledgerTypo2.status, 1);
  assert.equal(ledgerTypo2.stderr, "cw: Unknown command: ledge\n  Try: cw help\n");

  // Yet "ledger" itself dispatches fine and is a real command (usage error
  // when bare, not "unknown command") — proving the gap is specifically in
  // the suggestion list, not in dispatch.
  const ledgerBare = run(["ledger"]);
  assert.equal(ledgerBare.status, 1);
  assert.equal(ledgerBare.stderr, "cw: Usage: cw ledger propose|review|verify|apply|list [options]\n");
  assert.doesNotMatch(ledgerBare.stderr, /Unknown command/);
});
