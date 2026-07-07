#!/usr/bin/env node
// formatapps-help-command-help — pins formatCommandHelp(verb, suggestCommand):
// known-verb row rendering (2-space indent, padded command column, sorted
// by command string), the capability-table merge (cliCommandHelpRows),
// and the unknown-verb soft-fail text (never throws).
//
// Evidence: SPEC/cli-surface.md "formatCommandHelp(verb) (stdout)";
// src/core/format/help.ts's own header note on the literal-vs-table merge.

const assert = require("node:assert/strict");
const { formatCommandHelp } = require("../dist/core/format/help");

function noSuggestion() {
  return undefined;
}

// Known verb with a literal, multi-row COMMAND_HELP_ROWS entry ("clones"):
// bold header line `cw <verb>`, blank line, then rows sorted by command
// string, each `  <padded command>  <summary>`.
{
  const out = formatCommandHelp("clones", noSuggestion);
  const lines = out.split("\n");
  assert.equal(lines[0], "cw clones", "first line is 'cw <verb>'");
  assert.equal(lines[1], "", "second line is blank");
  assert.ok(lines[2].startsWith("  cw clones gc "), "row starts with a 2-space indent + padded command");
  assert.ok(lines[2].includes("Reclaim cached remote-source checkouts"), "row 1 carries the gc summary");
  assert.ok(lines[3].includes("List the cached remote-source checkouts"), "row 2 carries the list summary");
  // "cw clones gc" < "cw clones list" lexicographically -> gc row must come
  // first (line 2), list row second (line 3).
  assert.ok(lines[2].includes("clones gc"), "the gc row (lexicographically first) must be the first row");
  assert.ok(lines[3].includes("clones list"), "the list row (lexicographically second) must be the second row");
  assert.ok(out.endsWith("\n"), "output ends with a single trailing newline");
}

// Column padding: both rows pad their command column to the same width
// (the longest command length in this verb's row set, capped at 40) —
// verified by the fixed "cw clones <verb>" prefix each row's padded
// command column occupies before the 2-space gap to the summary.
{
  const out = formatCommandHelp("clones", noSuggestion);
  const lines = out.split("\n").filter((l) => l.startsWith("  cw clones"));
  // Row shape: "  " + command.padEnd(longest) + "  " + summary. The gap
  // between the end of the (unpadded) command text and the summary text
  // must differ per row by exactly the padding needed to reach one shared
  // column width.
  const gcMatch = lines[0].match(/^  (cw clones gc)( +)Reclaim/);
  const listMatch = lines[1].match(/^  (cw clones list)( +)List/);
  assert.ok(gcMatch && listMatch, "both rows must match the expected '<command><spaces><summary>' shape");
  const gcColumnEnd = 2 + gcMatch[1].length + gcMatch[2].length;
  const listColumnEnd = 2 + listMatch[1].length + listMatch[2].length;
  assert.equal(gcColumnEnd, listColumnEnd, "both clones rows must pad the command column to the same total width");
}

// Single-row verb ("help" itself): header + blank + one row.
{
  const out = formatCommandHelp("help", noSuggestion);
  assert.equal(out, "cw help\n\n  cw help  Print the human CLI help text.\n", "single-row verb renders header + blank + one padded row");
}

// Capability-table-derived verb ("list" — wired via cliCommandHelpRows):
// the row must appear even though it's absent from the literal
// COMMAND_HELP_ROWS table (this is the whole point of the milestone-2
// merge — literal and table-derived rows share one render path).
{
  const out = formatCommandHelp("list", noSuggestion);
  assert.ok(out.startsWith("cw list\n\n"), "header renders for a table-derived verb");
  assert.ok(/cw list\s+List bundled CW workflows\./.test(out), "the capability-table row's summary is rendered");
}

// Unknown verb with NO suggestion: never throws; soft 2-line message plus
// the generic "Try: cw help" tip, no "Did you mean" line.
{
  const out = formatCommandHelp("totally-bogus-verb", noSuggestion);
  assert.equal(
    out,
    "Unknown command: totally-bogus-verb\n  Try:  cw help   (list all commands)\n",
    "unknown verb with no suggestion gives the 2-line soft message"
  );
}

// Unknown verb WITH a suggestion: inserts the "Did you mean" line between
// the header and the generic tip.
{
  const out = formatCommandHelp("clone", (input) => (input === "clone" ? "clones" : undefined));
  assert.equal(
    out,
    "Unknown command: clone\n  Did you mean:  cw clones\n  Try:  cw help   (list all commands)\n",
    "unknown verb with a suggestion inserts the Did-you-mean line"
  );
}

// Empty-string verb behaves like any other unknown verb (no special case,
// no throw).
{
  const out = formatCommandHelp("", noSuggestion);
  assert.equal(out, "Unknown command: \n  Try:  cw help   (list all commands)\n", "empty verb is treated as an ordinary unknown command");
}

process.stdout.write("formatapps-help-command-help: ok\n");
