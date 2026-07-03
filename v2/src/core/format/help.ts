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
  // NOTE: "ledger" is not listed here any more — ledger propose/review/
  // verify/apply/list are now real capability-table rows (milestone 8,
  // core/capability-table.ts) and come from cliCommandHelpRows("ledger")
  // below, so their summary text lives in exactly one place.
  //
  // "clones" (and, below, "schedule"/"routine"/"sched"/"registry"/"queue"/
  // "gc"/"orphans") STAY literal here even though milestone 10 gave each
  // verb a real capability-table row: that row's OWN `cli.path` is the
  // bare 1-token verb (e.g. ["clones"]) because dispatchTable only
  // supports 1- or 2-token paths and these verbs each have MANY
  // subcommands handled by one internal switch — so the row's `cli`
  // binding is a dispatch/usage-error mechanism, not a per-subcommand
  // help entry, and is marked `hiddenFromHelp` for exactly that reason
  // (core/capability-table.ts). The per-subcommand summaries a human
  // reads via `cw help clones` therefore still come from literal rows
  // here, same as every other not-yet-per-subcommand-tabled verb below.
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
  schedule: [
    { command: "cw schedule create", summary: "Create a scheduled CW task." },
    { command: "cw schedule list", summary: "List scheduled CW tasks." },
    { command: "cw schedule delete", summary: "Delete a scheduled CW task." },
    { command: "cw schedule due", summary: "List due scheduled CW tasks." },
    { command: "cw schedule complete", summary: "Mark a scheduled task complete." },
    { command: "cw schedule pause", summary: "Pause a scheduled CW task." },
    { command: "cw schedule resume", summary: "Resume a scheduled CW task." },
    { command: "cw schedule run-now", summary: "Create an immediate scheduled-task run record." },
    { command: "cw schedule history", summary: "List scheduled-task run history." },
    { command: "cw schedule daemon", summary: "Tick the wall-clock scheduler once (--once) or run forever." },
  ],
  routine: [
    { command: "cw routine create", summary: "Create a routine-style API/GitHub trigger." },
    { command: "cw routine list", summary: "List routine-style triggers." },
    { command: "cw routine delete", summary: "Delete a routine-style trigger." },
    { command: "cw routine fire", summary: "Record an API/GitHub trigger event." },
    { command: "cw routine events", summary: "List routine trigger events." },
  ],
  sched: [
    { command: "cw sched plan", summary: "Read-only control-plane lease plan for the queue+policy+now." },
    { command: "cw sched lease", summary: "Claim eligible queue entries as leases (concurrency-bounded)." },
    { command: "cw sched release", summary: "Release a held lease (failed -> retry/backoff or park)." },
    { command: "cw sched complete", summary: "Complete a held lease (terminal success)." },
    { command: "cw sched reclaim", summary: "Reclaim expired leases (each counts a failed attempt)." },
    { command: "cw sched reset", summary: "Reset a parked entry to ready (operator recovery)." },
    { command: "cw sched policy", summary: "Show or set the scheduling policy (concurrency/attempts/backoff/TTL)." },
  ],
  registry: [
    { command: "cw registry refresh", summary: "Recompute and persist the derived run registry index." },
    { command: "cw registry show", summary: "Read the run registry index with valid|stale|absent freshness." },
  ],
  queue: [
    { command: "cw queue add", summary: "Enqueue a pending/planned run with explicit ordering policy." },
    { command: "cw queue list", summary: "List the durable run queue in policy order." },
    { command: "cw queue drain", summary: "Mark the next ready queue entries drained (the host still executes)." },
    { command: "cw queue show", summary: "Show one durable queue entry." },
  ],
  gc: [
    {
      command: "cw gc plan",
      summary: "Dry-run plan of run reclamation (per-kind bytes + capability downgrade); frees nothing.",
    },
    {
      command: "cw gc run",
      summary: "Execute the write-ahead reclamation transaction (skeleton -> tombstone -> fsync -> free).",
    },
    {
      command: "cw gc verify",
      summary: "Re-prove a reclaimed run: skeleton-complete, tombstone chain untampered, artifacts reconstructable.",
    },
  ],
  orphans: [
    {
      command: "cw orphans list",
      summary:
        "List run directories under .cw/runs/ that the run registry cannot see (no state.json — a killed/interrupted process never wrote one), with age + bytes. Read-only.",
    },
    {
      command: "cw orphans gc",
      summary:
        "Reclaim orphan run directories (no state.json): an age sweep (--min-age-minutes, default 60) or --all. Deletes only inside a scanned repo's .cw/runs/, never a run the registry knows about.",
    },
  ],
  run: [
    {
      command: "cw run drive",
      summary: "Preview the next agent-delegation drive step for a run (read-only, deterministic).",
    },
    // NOTE: the second "cw run drive" row (the mutating "Drive a run by
    // delegating..." summary) is NOT listed here any more — it is now a
    // real capability-table row (run.drive.step, milestone 6+7) and comes
    // from cliCommandHelpRows("run") below, so it is not hand-duplicated
    // in both places. Same for run archive/list/rerun/resume/search/show
    // (milestone 10, core/capability-table.ts) — only the not-yet-
    // implemented run-export family (milestone 11) stays literal here.
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
    {
      command: "cw run restore",
      summary:
        "Fail-closed restore of a portable run archive: integrity-inspect, import, and verify in one step; refuses anything that does not verify.",
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
  // NOTE: "demo" is not listed here any more — demo tamper/bundle are now
  // real capability-table rows (milestone 8, core/capability-table.ts)
  // and come from cliCommandHelpRows("demo") below.
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
    .filter((row) => row.cli.path[0] === verb && !row.cli.hiddenFromHelp)
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
