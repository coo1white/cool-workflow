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

// UI/UX fix: a verb whose CliBinding declares `flags` gets a "Flags" block
// after its row list ("doctor" is a single-row verb, so the block's own
// header is bare "Flags", no command name repeated). The block's lines use
// a WIDER indent than the row lines above them on purpose — same reason
// formatHelp's own trailing note does — so the CLI/MCP parity help-token
// parser (which reads only exactly-2-space lines as command tokens) skips
// them.
{
  const out = formatCommandHelp("doctor", noSuggestion);
  const lines = out.split("\n");
  const rowLine = lines.find((l) => l.startsWith("  cw doctor "));
  assert.ok(rowLine && !rowLine.startsWith("   "), "the row line itself keeps its plain 2-space indent");
  const flagsHeaderIndex = lines.indexOf("    Flags");
  assert.ok(flagsHeaderIndex > -1, "a bare 'Flags' header appears for a single-row flagged verb");
  const onrampLine = lines.find((l) => l.includes("--onramp"));
  assert.ok(onrampLine, "the --onramp flag is documented");
  // The parity help-token parser (scripts/parity-check.js's cliHelpTokens)
  // treats a line as a command token ONLY when it starts with exactly 2
  // spaces (2-space indent, not 4+). This line must fail that test, i.e.
  // NOT start with exactly 2 spaces — it must start with 4 or more.
  const startsWithExactlyTwoSpaces = onrampLine.startsWith("  ") && !onrampLine.startsWith("    ");
  assert.equal(startsWithExactlyTwoSpaces, false, "the --onramp line is NOT at the bare 2-space command-token indent");
  assert.ok(lines.indexOf(onrampLine) > flagsHeaderIndex, "the --onramp line comes after the Flags header");
}

// Multi-row flagged verb ("ledger" — both propose and review declare their
// own flags): each gets its own "Flags (cw ledger <sub>)" header so the
// two flag sets are never merged into one ambiguous list.
{
  const out = formatCommandHelp("ledger", noSuggestion);
  assert.ok(out.includes("\n    Flags (cw ledger propose)\n"), "propose gets its own labeled Flags header");
  assert.ok(out.includes("\n    Flags (cw ledger review)\n"), "review gets its own labeled Flags header");
  assert.ok(out.includes("--from AGENT/REPO"), "propose's --from flag is documented");
  assert.ok(out.includes("--verdict approved|rejected"), "review's --verdict flag is documented");
  const proposeIndex = out.indexOf("Flags (cw ledger propose)");
  const reviewIndex = out.indexOf("Flags (cw ledger review)");
  assert.ok(proposeIndex < reviewIndex, "propose's Flags block comes before review's (sorted command order)");
}

// Alias verb ("audit-run" is a caseTokens alias of quickstart, with no
// row of its own): renders an alias header line plus the TARGET verb's
// rows — never the unknown-command text, and never a Did-you-mean line
// pointing back at the alias itself (the old self-pointing bug).
{
  const out = formatCommandHelp("audit-run", () => "audit-run");
  const lines = out.split("\n");
  assert.equal(lines[0], "cw audit-run — alias of cw quickstart", "alias page header names the alias and its target");
  assert.equal(lines[1], "", "second line is blank, same as a normal help page");
  assert.ok(out.includes("cw quickstart"), "the target verb's row renders under the alias header");
  assert.ok(!out.includes("Unknown command"), "alias page never shows the unknown-command text");
  assert.ok(!out.includes("Did you mean"), "alias page never shows a Did-you-mean line");
  // Below the header, the alias page is byte-identical to the target's page.
  const target = formatCommandHelp("quickstart", noSuggestion);
  assert.equal(lines.slice(1).join("\n"), target.split("\n").slice(1).join("\n"), "alias body matches the target verb's body");
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
