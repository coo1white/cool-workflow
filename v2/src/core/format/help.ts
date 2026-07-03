// core/format/help.ts — formatHelp, formatCommandHelp.
//
// Pure functions of already-loaded data. Byte-exact port of
// src/orchestrator.ts:899-1007 in the old build (formatHelp,
// formatCommandHelp) plus the color helpers `bold`/`dim` keyed off stdout.
//
// LOAD-BEARING LAYOUT (v2/PLAN.md byte-compat item 14 — do not "clean up"):
//   - The command-line rows under "Cool Workflow" and the `cw <path...>`
//     rows in formatCommandHelp use a 2-space indent. The CLI/MCP parity
//     help-token checker parses ONLY 2-space lines as command tokens.
//   - The trailing note line ("Run  cw help <command> ...") uses a
//     DELIBERATE 4-space indent so that same 2-space parser skips it and
//     never mistakes it for a command token.
//
// The header/flags/more-commands banner text stays hard-coded (it is not
// capability-table data — see SPEC/cli-help/_root.txt). The per-verb
// subcommand-row table (`COMMAND_HELP_ROWS`) is now a MIX: verbs whose
// capability already has a `cli` binding in core/capability-table.ts
// (`list`, `version`, `status`, `doctor`, `fix`, `backend`, `sandbox` as of
// milestone 5) are dropped from the literal table below and read from the
// capability table instead, via `cliCommandHelpRows()`; every other verb
// stays literal here until its own milestone lands. This satisfies
// v2/PLAN.md milestone 2's own "done when": a CLI `--help` walk and an MCP
// `tools/list` round-trip read the SAME table rows for any capability
// wired into both.

import { cliCapabilities } from "../capability-table";

export interface CommandHelpRow {
  /** Full `cw <path...>` command string, e.g. "cw ledger list". */
  command: string;
  /** One-line summary shown after the padded command column. */
  summary: string;
}

/** src/orchestrator.ts:934-951 — the exact "More commands" token set, in
 *  this exact order (space-joined in the source, pipe-joined for display). */
const MORE_COMMANDS_TOKENS: string[] = [
  "list", "search", "info", "init", "plan", "status", "next", "dispatch",
  "result", "state", "commit", "report", "app", "sandbox", "backend",
  "contract", "node", "feedback", "worker", "audit", "candidate", "review",
  "loop", "schedule", "routine", "registry", "run", "queue", "clones",
  "orphans", "history", "quickstart", "audit-run", "multi-agent", "topology",
  "summary", "blackboard", "coordinator", "metrics", "operator", "sched",
  "gc", "telemetry", "migration", "demo", "workbench", "approve", "reject",
  "comment", "handoff", "ledger", "graph", "eval", "man", "version",
  "update", "fix",
];

const MORE_COMMANDS_WRAP_WIDTH = 76;

/** src/orchestrator.ts:940-951 — greedily pack pipe-joined tokens into
 *  lines of at most `width` columns, INCLUDING the 2-space indent in the
 *  width check (a token is never split). Returns lines WITH the 2-space
 *  indent already applied — callers must not add another one. */
function wrapPipeJoined(tokens: string[], width: number): string[] {
  const lines: string[] = [];
  let line = "  ";
  for (const token of tokens) {
    const sep = line.length > 2 ? "|" : "";
    if (line.length + sep.length + token.length > width) {
      lines.push(line);
      line = "  ";
    }
    line += (line.length > 2 ? "|" : "") + token;
  }
  if (line.length > 2) lines.push(line);
  return lines;
}

/** src/orchestrator.ts:988-1007 — the per-verb subcommand rows, keyed by
 *  the verb (`cli.path[0]` in the old registry). Verbs whose capability
 *  now has a real `cli` binding in core/capability-table.ts (`list`,
 *  `version`, `status`) are read from `cliCommandHelpRows()` instead (see
 *  `formatCommandHelp` below) and are DELIBERATELY ABSENT from this
 *  literal table — do not re-add them here, that would be exactly the
 *  hand-sync drift this milestone's table exists to remove. Every other
 *  verb stays literal until its own milestone lands. */
const COMMAND_HELP_ROWS: Record<string, CommandHelpRow[]> = {
  help: [{ command: "cw help", summary: "Print the human CLI help text." }],
  ledger: [
    {
      command: "cw ledger apply",
      summary:
        "Verify a proposal entry and return its suggestedDiff for `git apply` (fail-closed: no diff unless the entry verifies as a proposal).",
    },
    {
      command: "cw ledger list",
      summary:
        "Read + verify every entry in one or more shared ledger directories (fail-closed inbox; 2+ dirs union-verify mirrors).",
    },
    {
      command: "cw ledger propose",
      summary: "Build a verifiable cross-agent change proposal entry (printed as JSON).",
    },
    {
      command: "cw ledger review",
      summary: "Build a verifiable cross-agent review verdict entry (printed as JSON).",
    },
    {
      command: "cw ledger verify",
      summary: "Verify a ledger entry against its content digest (fail-closed on tampering).",
    },
  ],
  clones: [
    {
      command: "cw clones gc",
      summary:
        "Reclaim cached remote-source checkouts: a TTL sweep (--older-than-days, default 30) or --all. Deletes only inside the clones cache.",
    },
    {
      command: "cw clones list",
      summary:
        "List the cached remote-source checkouts that --link/URL reviews populate (origin URL, kind, commit, age, bytes). Read-only.",
    },
  ],
  run: [
    { command: "cw run archive", summary: "Archive/unarchive a run (overlay mark; never deletes source)." },
    {
      command: "cw run drive",
      summary: "Preview the next agent-delegation drive step for a run (read-only, deterministic).",
    },
    // NOTE: the second "cw run drive" row (the mutating "Drive a run by
    // delegating..." summary) is NOT listed here any more — it is now a
    // real capability-table row (run.drive.step, milestone 6+7) and comes
    // from cliCommandHelpRows("run") below, so it is not hand-duplicated
    // in both places.
    {
      command: "cw run export",
      summary: "Export a run to a portable archive with run-local files and digest integrity.",
    },
    {
      command: "cw run import",
      summary: "Restore a portable run archive into a target repo and verify restored file digests.",
    },
    {
      command: "cw run inspect-archive",
      summary: "Read-only integrity inspection of a portable run archive without importing it.",
    },
    { command: "cw run list", summary: "List indexed runs across repos (search with no filters)." },
    {
      command: "cw run rerun",
      summary: "Re-run a failed run as a NEW run linked to the original by provenance.",
    },
    {
      command: "cw run restore",
      summary:
        "Fail-closed restore of a portable run archive: integrity-inspect, import, and verify in one step; refuses anything that does not verify.",
    },
    {
      command: "cw run resume",
      summary:
        "Resolve a run by id and return its next runnable tasks/actions (read-only by default; the opt-in --drive/--once mode hands it to the shared agent-drive core, which mutates and is covered by run.drive.step).",
    },
    {
      command: "cw run search",
      summary: "Search runs by app/status/time/repo/free-text, deterministic + paginated.",
    },
    {
      command: "cw run show",
      summary: "Resolve one run by id across the registry; fail closed on missing source.",
    },
    {
      command: "cw run verify-import",
      summary: "Verify an imported run against its restore manifest and telemetry chain.",
    },
  ],
  // NOTE: "quickstart" is not listed here any more — it is now a real
  // capability-table row (milestone 6+7, core/capability-table.ts) and
  // comes from cliCommandHelpRows("quickstart") below, so its summary
  // text lives in exactly one place.
  man: [{ command: "cw man", summary: "Show a man page from docs/ (e.g. cw man release-tooling)." }],
  demo: [
    {
      command: "cw demo bundle",
      summary:
        "Prove portable-bundle verification: export a sealed report bundle, forge it two ways, watch report verify-bundle catch both offline with only the embedded public key.",
    },
    {
      command: "cw demo tamper",
      summary: "Prove tamper-evidence: build a signed telemetry ledger, forge it, watch verification fail offline.",
    },
  ],
};

/** src/orchestrator.ts:899-933 — the top-level `cw help` text. Color is
 *  intentionally NOT applied here (this milestone's conformance runs pipe
 *  stdout, so NO_COLOR/non-TTY always wins); byte content matches the
 *  plain-text capture at SPEC/cli-help/_root.txt exactly. */
export function formatHelp(): string {
  const moreCommandsLines = wrapPipeJoined(MORE_COMMANDS_TOKENS, MORE_COMMANDS_WRAP_WIDTH);
  const lines: string[] = [
    "Cool Workflow",
    "",
    '  -q "question" [-claude|-codex|-gemini|-deepseek]  Ask a question, get a report',
    '  -q "question" --link <url>                 Review a remote repo by URL',
    "  version                                   Show version",
    "  update                                    Update to latest release",
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
    "  -deepseek              Use DeepSeek (via opencode)",
    "  --verbose              Show full agent narration live (default: compact)",
    "  --full                 Verbose, plus the report printed inline at the end",
    "  --no-color             Disable ANSI color (also honors NO_COLOR / FORCE_COLOR)",
    "",
    "More commands",
    ...moreCommandsLines,
    "",
    "    Run  cw help <command>  for one command's subcommands and descriptions.",
  ];
  return `${lines.join("\n")}\n`;
}

/** src/orchestrator.ts:875-887 equivalent — passed in by the caller so this
 *  module stays a pure function of already-loaded data (no import cycle on
 *  cli/parseargv.ts's suggestCommand). */
export type SuggestCommandFn = (input: string) => string | undefined;

/** MILESTONE 2 — the capability-table projection half of
 *  `COMMAND_HELP_ROWS`: every declared `cli` binding whose `path[0]`
 *  matches `verb` becomes one row, `cw <path.join(" ")>` / `summary`.
 *  Merged into `formatCommandHelp` below so a verb can have BOTH literal
 *  rows (not-yet-migrated subcommands) and table-derived rows (migrated
 *  ones) without duplicating data by hand. */
function cliCommandHelpRows(verb: string): CommandHelpRow[] {
  return cliCapabilities()
    .filter((row) => row.cli.path[0] === verb)
    .map((row) => ({ command: `cw ${(row.cli.helpPath ?? row.cli.path).join(" ")}`, summary: row.summary }));
}

/** src/orchestrator.ts:988-1007 — `formatCommandHelp(verb)`. Unknown verb
 *  gives a SOFT text (never a throw); known verb lists its registry rows,
 *  sorted by command string, padded to the longest command column + 2
 *  (capped at 40, per the old registry's own cap; none of the milestone-1
 *  fixture rows exceed it). */
export function formatCommandHelp(verb: string, suggestCommand: SuggestCommandFn): string {
  const rows = [...(COMMAND_HELP_ROWS[verb] ?? []), ...cliCommandHelpRows(verb)];
  if (rows.length === 0) {
    const hint = suggestCommand(verb);
    const lines = [`Unknown command: ${verb}`];
    if (hint) lines.push(`  Did you mean:  cw ${hint}`);
    lines.push("  Try:  cw help   (list all commands)");
    return `${lines.join("\n")}\n`;
  }

  const sorted = [...rows].sort((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : 0));
  const longest = Math.min(40, Math.max(...sorted.map((row) => row.command.length)));
  const lines: string[] = [`cw ${verb}`, ""];
  for (const row of sorted) {
    const padded = row.command.padEnd(longest, " ");
    lines.push(`  ${padded}  ${row.summary}`);
  }
  return `${lines.join("\n")}\n`;
}
