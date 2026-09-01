// cli/global-flags.ts — the shared global CLI flag set, plus the TTY-gated
// unknown-flag warning for capability rows that declare `flagsComplete`
// (core/capability-data.ts's CliBinding).
//
// WHY: an unknown flag used to be dropped without a sound — `cw doctor
// --jsno` ran fine, printed the human report, and exited 0, so a typo of
// `--json` was easy to miss. A full allowlist check for EVERY command is
// not safe (a missed name means a FALSE warning, and many scripted and
// conformance callers assert stderr === ""), so the design here is
// incremental and fail-open:
//   - only a row that declares `flagsComplete: true` is ever checked, and
//     a row earns that mark only after its handler's option reads have
//     been checked against source, one by one;
//   - the warning is ONE line to stderr, printed ONLY when stderr is a
//     real interactive terminal (same injectable-stream gate as
//     shell/workbench-host.ts's printServeHint) — a piped, scripted, or
//     conformance run can never see it;
//   - stdout bytes and the exit code never change.

import type { CliBinding } from "../core/capability-data";

/** Every option key the shared CLI front door reads for ANY command, so a
 *  `flagsComplete` row's check never flags them. Built by reading the
 *  actual consumers:
 *   - cli/entry.ts: `version`/`v`, `help`/`h`, the vendor shorthands
 *     `claude`/`codex`/`gemini`/`deepseek`/`muse` (each sets `agent-command`),
 *     `repo`/`dir` (`--dir`/`-d` is a global alias for `--repo`),
 *     `verbose`, `no-color`, `full`, `quiet`, `question` (`-q`), and the
 *     `--resume --run <id>` continuation pair;
 *   - cli/dispatch.ts + core/util/cli-args.ts's wantsJson: `json`,
 *     `format`;
 *   - cli/parseargv.ts's short-alias table: `link` (`-l`),
 *     `agent-command` (`-a`) — the short spellings map to these long
 *     names before any handler sees them;
 *   - the doctor/fix handlers' shared working-dir override: `cwd`.
 *  Keys are the POST-parse spellings (what lands in `args.options`). */
export const GLOBAL_CLI_FLAGS: readonly string[] = [
  "agent-command",
  "claude",
  "codex",
  "cwd",
  "deepseek",
  "dir",
  "format",
  "full",
  "gemini",
  "h",
  "help",
  "json",
  "link",
  "muse",
  "no-color",
  "question",
  "quiet",
  "repo",
  "resume",
  "run",
  "v",
  "verbose",
  "version",
];

/** "changed-from" -> "changedFrom". A name with no dash comes back as-is. */
function kebabToCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/** "changedFrom" -> "changed-from". A name with no capitals comes back as-is. */
function camelToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** The option key a declared flag help entry documents: the first token
 *  of its display name, without the leading dashes ("--changed-from REF"
 *  -> "changed-from"). */
function flagNameToKey(name: string): string {
  return name.trim().split(/\s+/)[0].replace(/^-+/, "");
}

/** The full accepted-key set for one row: the row's declared flags plus
 *  the global set, each in BOTH its kebab-case and camelCase spelling. */
function knownKeysFor(cli: Pick<CliBinding, "flags">): Set<string> {
  const known = new Set<string>();
  const add = (key: string): void => {
    known.add(key);
    known.add(kebabToCamel(key));
    known.add(camelToKebab(key));
  };
  for (const name of GLOBAL_CLI_FLAGS) add(name);
  for (const flag of cli.flags ?? []) add(flagNameToKey(flag.name));
  return known;
}

/** The option keys this row does not know about (pure; exported for unit
 *  tests). Empty unless the row declares `flagsComplete`. */
export function unknownFlagKeys(cli: Pick<CliBinding, "flags" | "flagsComplete">, options: Record<string, unknown>): string[] {
  if (!cli.flagsComplete) return [];
  const known = knownKeysFor(cli);
  return Object.keys(options).filter((key) => !known.has(key));
}

/** Write ONE warning line to `stream` when a `flagsComplete` row got an
 *  option it does not read — and only when the stream is a real TTY, so
 *  no piped caller, script, or conformance case can ever see it. stdout
 *  and the exit code are untouched either way. */
export function warnUnknownFlags(
  cli: Pick<CliBinding, "path" | "flags" | "flagsComplete">,
  options: Record<string, unknown>,
  stream: { isTTY?: boolean; write: (text: string) => unknown } = process.stderr
): void {
  if (!stream.isTTY) return;
  const unknown = unknownFlagKeys(cli, options);
  if (unknown.length === 0) return;
  const label = unknown.length === 1 ? "flag" : "flags";
  const list = unknown.map((key) => `--${key}`).join(", ");
  stream.write(`cw: warning: unknown ${label} ${list} (see: cw help ${cli.path[0]})\n`);
}
