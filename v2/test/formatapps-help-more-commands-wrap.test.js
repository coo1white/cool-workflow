#!/usr/bin/env node
// formatapps-help-more-commands-wrap — pins the "More commands" pipe-join
// wrap rule inside formatHelp(): lines wrap at <= 76 columns (INCLUDING the
// 2-space indent), a token is never split across lines, and every line
// after wrapping still carries the load-bearing 2-space indent so the
// parity help-token parser reads each wrapped line as command tokens.
//
// Evidence: SPEC/cli-surface.md ("split and re-wrapped to lines of at most
// 76 columns, pipe-joined with a 2-space indent"); v2/PLAN.md byte-compat
// item 14.

const assert = require("node:assert/strict");
const { formatHelp } = require("../dist/core/format/help");

function moreCommandsLines() {
  const lines = formatHelp().split("\n");
  const start = lines.indexOf("More commands") + 1;
  const out = [];
  for (let i = start; lines[i] !== ""; i += 1) out.push(lines[i]);
  return out;
}

// Every wrapped line is <= 76 columns.
{
  const lines = moreCommandsLines();
  assert.ok(lines.length > 1, "the token list must wrap across more than one line");
  for (const line of lines) {
    assert.ok(line.length <= 76, `wrapped line must be <= 76 columns, got ${line.length}: ${JSON.stringify(line)}`);
  }
}

// Every wrapped line carries the 2-space indent (never a bare token list).
{
  const lines = moreCommandsLines();
  for (const line of lines) {
    assert.ok(line.startsWith("  "), "every wrapped 'More commands' line must start with a 2-space indent");
    assert.notEqual(line[2], " ", "the indent must be exactly 2 spaces, not more");
  }
}

// Re-joining all wrapped lines' tokens (stripping indent, splitting on "|")
// reproduces the exact SPEC token list in the exact original order — no
// token dropped, duplicated, or reordered by the wrap.
{
  const SPEC_TOKENS = (
    "list search info init plan status next dispatch result state commit report app sandbox backend " +
    "contract node feedback worker audit candidate review loop schedule routine registry run queue clones " +
    "orphans history quickstart audit-run multi-agent topology summary blackboard coordinator metrics " +
    "operator sched gc telemetry migration demo workbench approve reject comment handoff ledger graph eval " +
    "man version update fix"
  ).split(" ");
  const rejoined = moreCommandsLines()
    .map((line) => line.trim())
    .join("|")
    .split("|");
  assert.deepEqual(rejoined, SPEC_TOKENS, "unwrapping the wrapped lines must reproduce the SPEC token list in order");
}

// No token is ever split mid-word across a line break: every individual
// token from the rejoined list must appear intact (as a whole `|`- or
// line-delimited unit) somewhere in the raw wrapped output.
{
  const lines = moreCommandsLines();
  const fullText = lines.map((l) => l.trim()).join("|");
  const tokens = fullText.split("|");
  for (const token of tokens) {
    assert.ok(/^[a-z-]+$/.test(token), `each token must be a clean lower-case/hyphen word, never a partial split: ${JSON.stringify(token)}`);
  }
}

process.stdout.write("formatapps-help-more-commands-wrap: ok\n");
