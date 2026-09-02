// core/format/help.ts — formatHelp, formatCommandHelp.
//
// Pure functions of already-loaded data. Byte-exact port of the old
// build's formatHelp and formatCommandHelp, plus the color helpers
// `bold`/`dim` keyed off stdout.
//
// LOAD-BEARING LAYOUT (project/docs/rebuild/PLAN.md byte-compat item 14 — do not "clean up"):
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
// project/docs/rebuild/PLAN.md milestone 2's own "done when": a CLI `--help` walk and an MCP
// `tools/list` round-trip read the SAME table rows for any capability
// wired into both.

import { cliCapabilities } from "../capability-table";

export interface CommandHelpRow {
  /** Full `cw <path...>` command string, e.g. "cw ledger list". */
  command: string;
  /** One-line summary shown after the padded command column. */
  summary: string;
  /** Optional per-flag help text, carried over from the row's own
   *  `CliBinding.flags` (core/capability-data.ts) when present. Rendered by
   *  `formatCommandHelp` as a "Flags" block after the row list — see that
   *  function for the render rule and the 4-space indent it must use. */
  flags?: Array<{ name: string; summary: string }>;
}

/** The "More commands" token set, in the old
 *  build's order (space-joined in the source, pipe-joined for display).
 *  One change from the old capture: `update` is gone. The verb had no code
 *  behind it in this build (`cw update` said "Unknown command"), so the
 *  help must not offer it. See parseargv.ts KNOWN_COMMANDS. Exported (only
 *  as a read-only source list, `formatHelp` below still owns the byte-
 *  pinned display format) so `core/format/completion.ts` can build a
 *  shell-completion word list from the SAME data instead of a third
 *  hand-maintained copy. */
export const MORE_COMMANDS_TOKENS: string[] = [
  "list", "search", "info", "init", "plan", "status", "next", "dispatch",
  "result", "state", "commit", "report", "app", "sandbox", "backend",
  "contract", "node", "feedback", "worker", "audit", "candidate", "review",
  "loop", "schedule", "routine", "registry", "run", "queue", "clones",
  "orphans", "history", "quickstart", "audit-run", "multi-agent", "topology",
  "summary", "blackboard", "coordinator", "metrics", "operator", "sched",
  "gc", "telemetry", "migration", "demo", "workbench", "approve", "reject",
  "comment", "handoff", "ledger", "graph", "eval", "man", "version",
  "fix", "completion",
];

const MORE_COMMANDS_WRAP_WIDTH = 76;

/** Greedily pack pipe-joined tokens into
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

/** The per-verb subcommand rows, keyed by
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
    // Two rows for one command string, on purpose — SPEC/cli-probe.md's
    // "Odd things a rebuild must copy or fix on purpose" item 5 names
    // `sched policy` as one of the show/set pairs a rebuild's help
    // printer must keep doubled; this single merged row was a regression
    // that lost the doubling (plugins/cool-workflow/project/docs/rebuild/SPEC/cli-help/sched.txt has
    // both), restored here with the old ground truth's exact wording.
    { command: "cw sched policy", summary: "Show the scheduling policy (file or default)." },
    { command: "cw sched policy", summary: "Set scheduling policy fields (concurrency/attempts/backoff/TTL)." },
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
    // NOTE: neither "cw run drive" row is listed here any more. The first
    // (read-only preview, "Preview the next agent-delegation...") is now a
    // real capability-table row (run.drive, PARITY WIRING) with its own
    // `cli.path`; the second (mutating "Drive a run by delegating...") is
    // also a real capability-table row (run.drive.step, milestone 6+7)
    // whose `helpPath` override displays it under the same "cw run drive"
    // command column. Both come from cliCommandHelpRows("run") below, so
    // neither is hand-duplicated here. Same for run archive/list/rerun/
    // resume/search/show (milestone 10, core/capability-table.ts) — only
    // the not-yet-implemented run-export family (milestone 11) stays
    // literal here.
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

/** The top-level `cw help` text. Color is
 *  intentionally NOT applied here (this milestone's conformance runs pipe
 *  stdout, so NO_COLOR/non-TTY always wins); byte content matches the
 *  plain-text capture at SPEC/cli-help/_root.txt, but for the dead
 *  `update` lines, which were taken out on purpose (no code was behind
 *  the verb — see MORE_COMMANDS_TOKENS note above), for a `--json`
 *  Flags row, added because the old build's capture predates the ~68
 *  capability-table rows that now support `--json`/`--format json`
 *  (io.ts's wantsJson) — the flag existed but was never documented here —
 *  and for a `--quiet` Flags row, a new CLI spelling of the existing
 *  CW_DRIVE_PROGRESS=0 env var (see cli/entry.ts); and for a `--resume`
 *  Flags row (architecture-review-driven fix), documenting the existing
 *  `--resume --run <id>` continuation flag (shell/pipeline-cli.ts's
 *  quickstartRun) that previously existed only in code comments and an
 *  auto-generated continue hint — a user who never happened to type it
 *  first had no way to discover it via `cw help`. */
export function formatHelp(): string {
  const moreCommandsLines = wrapPipeJoined(MORE_COMMANDS_TOKENS, MORE_COMMANDS_WRAP_WIDTH);
  const lines: string[] = [
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
    ...moreCommandsLines,
    "",
    "    Run  cw help <command>  for one command's subcommands and descriptions.",
  ];
  return `${lines.join("\n")}\n`;
}

/** The old build's nearest-command-match function, passed in by the caller so this
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
    .map((row) => ({
      command: `cw ${(row.cli.helpPath ?? row.cli.path).join(" ")}`,
      summary: row.summary,
      ...(row.cli.flags ? { flags: row.cli.flags } : {}),
    }));
}

/** A verb that is only a `caseTokens` alias of another verb's row (e.g.
 *  `audit-run` -> `quickstart`) has NO row whose `cli.path[0]` matches it,
 *  so `cliCommandHelpRows` above finds nothing for it. This looks the
 *  alias up the same way the dispatcher does (registry-core.ts's
 *  findCapabilityByCliPath alias branch: a row whose `caseTokens` holds
 *  the token) and returns the verb the alias dispatches to. */
function aliasTargetVerb(verb: string): string | undefined {
  for (const row of cliCapabilities()) {
    if (row.cli.caseTokens && row.cli.caseTokens.includes(verb) && row.cli.path[0] !== verb) {
      return row.cli.path[0];
    }
  }
  return undefined;
}

/** `formatCommandHelp(verb)`. Unknown verb
 *  gives a SOFT text (never a throw); known verb lists its registry rows,
 *  sorted by command string, padded to the longest command column + 2
 *  (capped at 40, per the old registry's own cap; none of the milestone-1
 *  fixture rows exceed it). An alias verb (a `caseTokens` token like
 *  `audit-run`) gets an alias header line plus its target verb's rows —
 *  before this fix it fell into the unknown-verb text and, worse, the
 *  Did-you-mean line suggested the very verb the user just typed. */
export function formatCommandHelp(verb: string, suggestCommand: SuggestCommandFn): string {
  const rows = [...(COMMAND_HELP_ROWS[verb] ?? []), ...cliCommandHelpRows(verb)];
  if (rows.length === 0) {
    const target = aliasTargetVerb(verb);
    if (target) {
      const targetRows = [...(COMMAND_HELP_ROWS[target] ?? []), ...cliCommandHelpRows(target)];
      if (targetRows.length > 0) {
        return renderCommandHelpRows(`cw ${verb} — alias of cw ${target}`, targetRows);
      }
    }
    const hint = suggestCommand(verb);
    const lines = [`Unknown command: ${verb}`];
    if (hint) lines.push(`  Did you mean:  cw ${hint}`);
    lines.push("  Try:  cw help   (list all commands)");
    return `${lines.join("\n")}\n`;
  }
  return renderCommandHelpRows(`cw ${verb}`, rows);
}

/** The row-list rendering `formatCommandHelp` has always done, extracted
 *  so the alias page above can render its target's rows under its own
 *  header line without a second copy of the sort/pad/Flags logic. */
function renderCommandHelpRows(header: string, rows: CommandHelpRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : 0));
  const longest = Math.min(40, Math.max(...sorted.map((row) => row.command.length)));
  const lines: string[] = [header, ""];
  for (const row of sorted) {
    const padded = row.command.padEnd(longest, " ");
    lines.push(`  ${padded}  ${row.summary}`);
  }

  // Flags block(s): only for rows that declare at least one flag (most
  // rows do not — see CliBinding.flags). Uses the SAME 4-space indent as
  // formatHelp's own "Run cw help <command> ..." note above, on purpose:
  // the CLI/MCP parity help-token parser reads only 2-space lines as
  // command tokens, so any wider indent is a line it already knows to
  // skip. One row's command name is only spelled out in the block's own
  // header when more than one row on this page declares flags (e.g.
  // "cw ledger" lists both propose and review); a single-row page (e.g.
  // "cw doctor") just says "Flags".
  const flaggedRows = sorted.filter((row) => row.flags && row.flags.length > 0);
  if (flaggedRows.length > 0) {
    const oneFlaggedRow = flaggedRows.length === 1;
    for (const row of flaggedRows) {
      const flags = row.flags!;
      const flagWidth = Math.min(40, Math.max(...flags.map((flag) => flag.name.length)));
      lines.push("", oneFlaggedRow ? "    Flags" : `    Flags (${row.command})`);
      for (const flag of flags) {
        lines.push(`      ${flag.name.padEnd(flagWidth, " ")}  ${flag.summary}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/** `cw info <id>` human card — MILESTONE 12. Byte-exact in spirit to
 *  the old build's `formatInfo` (color stripped, matching
 *  this file's own `formatHelp`/`formatCommandHelp` — styling, if any, is
 *  applied by the shell layer, never here). `data` is the `showApp`/
 *  `showWorkflowApp` payload. */
export function formatInfo(appId: string, data: Record<string, unknown>): string {
  const inputs = (Array.isArray(data.inputs) ? data.inputs : []) as Array<Record<string, unknown>>;
  const phases = (Array.isArray(data.phases) ? data.phases : []) as Array<Record<string, unknown>>;
  const lines: string[] = [`cw info ${appId}`];
  if (data.title) lines.push(`  Title: ${data.title}`);
  if (data.version) lines.push(`  Version: ${data.version}`);
  if (data.summary) lines.push(`  Summary: ${data.summary}`);
  if (data.author) lines.push(`  Author: ${typeof data.author === "object" ? (data.author as Record<string, string>).name : data.author}`);
  if (data.compatible !== undefined) lines.push(`  Compatible: ${data.compatible ? "yes" : "no"}`);
  if (inputs.length > 0) {
    lines.push("  Inputs:");
    for (const one of inputs) {
      const name = one.name || "";
      const type = one.type || "string";
      const required = one.required ? ", required" : "";
      const def = one.default ? `, default: ${one.default}` : "";
      const desc = one.description ? ` — ${one.description}` : "";
      lines.push(`    - ${name} (${type}${required}${def})${desc}`);
    }
  }
  if (Array.isArray(data.sandboxProfiles) && data.sandboxProfiles.length > 0) {
    lines.push(`  Sandbox: ${data.sandboxProfiles.join(", ")}`);
  }
  const taskCount = data.taskCount || 0;
  if (phases.length > 0) {
    lines.push(`  Phases: ${phases.length} phase${phases.length !== 1 ? "s" : ""}, ${taskCount} task${taskCount !== 1 ? "s" : ""}`);
  }
  lines.push(`  Run: cw quickstart ${appId} --repo . --question "..."`);
  return lines.join("\n");
}

/** `cw search <keyword>`'s human text — byte-exact to the milestone-1
 *  carry-over's own formatSearchResults (moved here from cli/dispatch.ts
 *  so the search capability-table row, which lives in core/, can render
 *  its own text without core importing from cli/). */
export function formatSearchResults(
  keyword: string,
  results: Array<{ id: string; title: string; summary: string }>
): string {
  if (results.length === 0) {
    return `No workflows matched "${keyword}".\n  Tip: cw list for all available workflows.`;
  }
  const lines: string[] = [`${results.length} workflow${results.length === 1 ? "" : "s"} matching "${keyword}"`];
  for (const r of results) {
    lines.push(`  ${r.id} — ${r.title}`);
    const cut = r.summary.length > 120 ? `${r.summary.slice(0, 119)}…` : r.summary;
    lines.push(`    ${cut}`);
  }
  lines.push("");
  lines.push("Use cw info <id> for full details.");
  return lines.join("\n");
}

/** `cw list`'s TTY-only human text (the `list` row's `humanRender`, see
 *  core/capability-data.ts's CliBinding). Modeled on formatSearchResults
 *  above: one "<id> — <title>" line per workflow, then the same short
 *  next-step footer. NEVER printed to a pipe — the row's canonical JSON
 *  stays the only piped output (SPEC/cli-surface.md's jsonMode contract:
 *  "default" verbs are always JSON on a non-TTY stream). */
export function formatWorkflowList(workflows: unknown): string {
  const rows = (Array.isArray(workflows) ? workflows : []) as Array<Record<string, unknown>>;
  const lines: string[] = rows.map((w) => `${w.id} — ${w.title}`);
  lines.push("");
  lines.push("Use cw info <id> for full details.");
  return lines.join("\n");
}
