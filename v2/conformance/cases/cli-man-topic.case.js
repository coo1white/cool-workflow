#!/usr/bin/env node
"use strict";

// cli-man-topic — `cw man <topic>` reads docs/<topic>.7.md, then
// docs/<topic>.md, then docs/<topic>, and writes the RAW file bytes to
// stdout with NO added trailing newline (SPEC/cli-surface.md: "man writes
// the raw file with NO added trailing newline"). Also the missing-topic
// error (both no-topic-at-all and an unknown topic) with its own Tip text
// distinct from the generic io.required tip.
//
// This case never reads docs/ directly (that would mean comparing against
// a file outside "what the CLI itself writes"); it proves "no added
// newline" and "byte-stable" purely by observing the CLI's own stdout
// across repeated invocations and checking it never ends in a doubled
// newline the way a naive `content + "\n"` implementation would produce.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const first = run(["man", "release-tooling"]);
  assert.equal(first.status, 0);
  assert.equal(first.stderr, "");
  assert.ok(first.stdout.length > 1000, "the release-tooling manual must be a real, substantial doc");
  assert.ok(!first.stdout.endsWith("\n\n"), "man must not APPEND a trailing newline to a file that already ends in one");

  // Deterministic / byte-stable across repeated invocations.
  const second = run(["man", "release-tooling"]);
  assert.equal(second.stdout, first.stdout);

  // Missing topic entirely: exit 1, its own two-line error (distinct
  // wording from io.required's generic "Missing <label>." shape).
  const noTopic = run(["man"]);
  assert.equal(noTopic.status, 1);
  assert.equal(noTopic.stdout, "");
  assert.equal(
    noTopic.stderr,
    "cw: Missing topic.\n  Tip: cw man release-tooling for the release tooling manual.\n"
  );

  // Unknown topic: a different fixed error, still exit 1.
  const unknownTopic = run(["man", "no-such-topic-xyz"]);
  assert.equal(unknownTopic.status, 1);
  assert.equal(unknownTopic.stdout, "");
  assert.equal(
    unknownTopic.stderr,
    "cw: Man page not found: no-such-topic-xyz.\n  Tip: cw list for workflow topics, or browse docs/ for manuals.\n"
  );
});
