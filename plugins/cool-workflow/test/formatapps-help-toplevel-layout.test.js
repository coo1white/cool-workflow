#!/usr/bin/env node
// formatapps-help-toplevel-layout — pins formatHelp()'s exact byte layout:
// the top banner, the 2-space command-line indent, the "More commands"
// wrapped block, and the deliberately 4-space trailing note line.
//
// Evidence: SPEC/cli-surface.md "formatHelp() (stdout)" (the literal text
// block); project/docs/rebuild/PLAN.md byte-compat item 14 (2-space vs 4-space distinction).

const assert = require("node:assert/strict");
const { formatHelp } = require("../dist/core/format/help");

// Exact full-text golden value, sourced from SPEC/cli-surface.md's own
// "formatHelp() (stdout)" block (line-for-line, including the wrapped
// "More commands" block from the SPEC's own token list), plus the rows
// added after that capture (--json, --quiet, --resume, -opencode, -muse).
{
  const expected = [
    "Cool Workflow",
    "",
    '  -q "question" [-claude|-codex|-gemini|-deepseek|-muse]  Ask, get a report',
    '  -q "question" --link <url>                 Review a remote repo by URL',
    "  version                                   Show version",
    "  doctor                                    Check setup",
    "  fix                                       Show fix commands for setup issues",
    "",
    "Flags",
    "  -q, --question TEXT    The task or question to answer",
    "  -r, --repo PATH        Target repository path (default: .)",
    "  -d, --dir PATH         Project folder to review (alias for --repo)",
    "  -claude                Use Claude agent",
    "  -codex                 Use Codex agent",
    "  -gemini                Use Gemini (via opencode)",
    "  -opencode              Use OpenCode agent",
    "  -deepseek              Use DeepSeek (via opencode)",
    "  -muse                  Use Muse Code agent",
    "  --verbose              Show full agent narration live (default: compact)",
    "  --full                 Verbose, plus the report printed inline at the end",
    "  --no-color             Disable ANSI color (also honors NO_COLOR / FORCE_COLOR)",
    "  --json                 Print JSON for commands that support it",
    "  --quiet                Suppress [drive] progress lines (not agent output)",
    "  --resume --run <id>    Continue an interrupted run to completion",
    "",
    "More commands",
    "  list|search|info|init|plan|status|next|dispatch|result|state|commit|report",
    "  app|sandbox|backend|contract|node|feedback|worker|audit|candidate|review",
    "  loop|schedule|routine|registry|run|queue|clones|orphans|history|quickstart",
    "  audit-run|multi-agent|topology|summary|blackboard|coordinator|metrics",
    "  operator|sched|gc|telemetry|migration|demo|workbench|approve|reject",
    "  comment|handoff|ledger|graph|eval|man|version|fix|completion",
    "",
    "    Run  cw help <command>  for one command's subcommands and descriptions.",
  ].join("\n") + "\n";
  assert.equal(formatHelp(), expected, "formatHelp() must match the SPEC's exact byte layout");
}

// Trailing newline invariant: formatHelp() ends with exactly one \n, no
// trailing blank-line duplication.
{
  const out = formatHelp();
  assert.ok(out.endsWith("\n"), "formatHelp() must end with a newline");
  assert.ok(!out.endsWith("\n\n"), "formatHelp() must not end with a double newline");
}

// LOAD-BEARING: the top-level command rows use a 2-space indent (parsed
// as command tokens by the parity help-token checker).
{
  const lines = formatHelp().split("\n");
  const versionLine = lines.find((l) => l.includes("Show version"));
  assert.ok(versionLine.startsWith("  ") && !versionLine.startsWith("   "), "the 'version' row must use exactly a 2-space indent");
}

// LOAD-BEARING: the trailing "Run cw help <command> ..." note line uses a
// DELIBERATE 4-space indent, distinct from the 2-space command rows above
// it, so the parity help-token parser (2-space rule) skips it.
{
  const lines = formatHelp().split("\n");
  const noteLine = lines.find((l) => l.includes("Run  cw help <command>"));
  assert.ok(noteLine !== undefined, "the trailing note line must be present");
  assert.ok(noteLine.startsWith("    "), "the note line must start with a 4-space indent");
  assert.ok(!noteLine.startsWith("  ") || noteLine.startsWith("    "), "sanity: 4-space indent starts with 2-space too, but must be exactly 4");
  assert.equal(noteLine.match(/^ */)[0].length, 4, "the note line's leading-space run must be exactly 4, not 2 or 6");
}

// The parity help-token parser's 2-space rule: simulate the parser (reads
// only lines with EXACTLY a 2-space indent, i.e. line[2] is not a space)
// and confirm the note line is correctly skipped while real command rows
// are correctly kept.
{
  function parseTwoSpaceTokens(text) {
    return text
      .split("\n")
      .filter((line) => line.startsWith("  ") && line[2] !== " " && line[2] !== undefined && line.trim().length > 0)
      .map((line) => line.trim());
  }
  const tokenLines = parseTwoSpaceTokens(formatHelp());
  const noteCaptured = tokenLines.some((line) => line.includes("Run  cw help"));
  assert.equal(noteCaptured, false, "the 2-space parity parser must NOT capture the 4-space note line as a command token");
  const versionCaptured = tokenLines.some((line) => line.startsWith("version"));
  assert.equal(versionCaptured, true, "the 2-space parity parser MUST capture the 'version' row as a command token");
}

process.stdout.write("formatapps-help-toplevel-layout: ok\n");
