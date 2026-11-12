#!/usr/bin/env node
// help-front-page-cap — docs/reference.md, "Output rules" rule 8: `cw help` gives at most
// five entries before "More commands"; a new one goes on only when an old
// one comes off. The 0.4.0 cut was turned back once for a sixth row; this
// test makes that a failing unit test, not a review note.
//
// It reads formatHelp(): after the "Cool Workflow" line and its blank line,
// every non-blank row up to the next blank line is one front-page entry.

import assert from "node:assert/strict";
import { formatHelp } from "../../../dist/core/format/help.js";

const MAX_FRONT_PAGE_ENTRIES = 5;

function frontPageEntries(text) {
  const lines = text.split("\n");
  const title = lines.indexOf("Cool Workflow");
  assert.notEqual(title, -1, 'formatHelp() must start its front page with "Cool Workflow"');
  assert.equal(lines[title + 1], "", 'a blank line must follow "Cool Workflow"');
  const entries = [];
  for (let i = title + 2; i < lines.length && lines[i] !== ""; i += 1) entries.push(lines[i]);
  return entries;
}

{
  const entries = frontPageEntries(formatHelp());
  assert.ok(entries.length > 0, "the front page must have at least one entry");
  assert.ok(
    entries.length <= MAX_FRONT_PAGE_ENTRIES,
    `cw help front page has ${entries.length} entries; docs/reference.md "Output rules" allows ${MAX_FRONT_PAGE_ENTRIES}. ` +
      `Take one off before a new one goes on:\n${entries.join("\n")}`
  );
  // The block after the front page is "Flags", then "More commands": the
  // count above is the part before them, not a later section.
  const text = formatHelp();
  assert.ok(text.indexOf(entries.at(-1)) < text.indexOf("More commands"), "the counted rows come before More commands");
}

// The parser itself: a sixth row is counted as six, so the cap can bite.
{
  const six = ["Cool Workflow", "", "  a  x", "  b  x", "  c  x", "  d  x", "  e  x", "  f  x", "", "Flags"].join("\n");
  assert.equal(frontPageEntries(six).length, 6);
}

process.stdout.write("help-front-page-cap: ok\n");
