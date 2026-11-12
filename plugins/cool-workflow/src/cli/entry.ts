// cli/entry.ts — the `cw` / `cool-workflow` binaries: top-level flag
// redirects, then dispatch, then the catch that turns a thrown error into
// `cw: <message>` / `  Try: <hint>` on stderr. Color is TTY/env-gated
// (shell/term.ts); conformance pipes with NO_COLOR=1.

import { parseArgv, suggestCommand } from "./parseargv.js";
import { dispatch, runRow } from "./dispatch.js";
import { formatCommandHelp } from "../core/format/help.js";
import { ASK, COMMANDS } from "../wiring/commands.js";
import { CURRENT_COOL_WORKFLOW_VERSION } from "../core/version.js";
import { bold, dim, red } from "../shell/term.js";
import { styledHelp } from "./io.js";
import { recoveryHint } from "../core/format/recovery-hint.js";

const VENDORS = ["claude", "codex", "gemini", "opencode", "deepseek", "muse", "copilot", "antigravity", "grok"];

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgv(argv);

  // Top-level flags: accept --version / -v / --help / -h before command lookup.
  if (args.command?.startsWith("-") || !args.command) {
    if (args.command === "--version" || args.command === "-v" || args.options.v || args.options.version) {
      process.stdout.write(`${CURRENT_COOL_WORKFLOW_VERSION}\n`);
      return;
    }
    if (!args.command || args.command === "--help" || args.command === "-h" || args.options.h || args.options.help) {
      process.stdout.write(styledHelp());
      return;
    }
  }

  // Vendor short flags -> --agent-command.
  for (const vendor of VENDORS) if (args.options[vendor]) args.options["agent-command"] = `builtin:${vendor}`;

  // -dir / --dir / -d is a second name for --repo; an explicit --repo wins.
  if (!args.options.repo && args.options.dir) args.options.repo = args.options.dir;

  // Presentation flags set env vars before any agent spawn.
  if (args.options.verbose) process.env.CW_VERBOSE = "1";
  if (args.options["no-color"]) process.env.CW_NO_COLOR = "1";
  // --quiet silences only the [drive] progress lines, not agent output.
  if (args.options.quiet) process.env.CW_DRIVE_PROGRESS = "0";

  // `cw <verb> --help` / `-h` -> per-command help.
  if ((args.options.help || args.options.h) && args.command && !args.command.startsWith("-")) {
    process.stdout.write(formatCommandHelp(args.command, suggestCommand, COMMANDS));
    return;
  }

  // -q / --question, or a leading --resume: the ask row.
  if (args.command === "-q" || args.command === "--question") {
    if (!args.options.question && args.positionals[0]) args.options.question = args.positionals.shift();
    return runRow(ASK, args);
  }
  if (!args.command && typeof args.options.question === "string") return runRow(ASK, args);
  if (args.command === "--resume") {
    args.options.resume = true;
    return runRow(ASK, args);
  }

  await dispatch(args);
}

/** Broken pipe (`cw ... --json | head`): the reader has all it needs, so
 *  stop quietly with code 0; any other stream error is thrown again. */
function exitQuietOnEpipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error && error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

/** Top-level run wrapper matching src/cli.ts's catch shape byte-for-byte:
 *  `cw: <message>\n` then, only when a hint matches, `  Try: <hint>\n` on
 *  stderr; `process.exitCode = 1` (never a hard `process.exit`). */
export function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  exitQuietOnEpipe(process.stdout);
  exitQuietOnEpipe(process.stderr);
  return runCli(argv).catch((error: unknown) => {
    // On some platforms a broken-pipe write throws EPIPE in the write call
    // itself (not as a stream 'error' event) — same broken pipe, same quiet
    // exit 0, never a `cw: write EPIPE` line.
    if ((error as NodeJS.ErrnoException | null)?.code === "EPIPE") return;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${bold("cw:", process.stderr)} ${red(message, process.stderr)}\n`);
    const hint = recoveryHint(message);
    if (hint) process.stderr.write(`  ${dim("Try:", process.stderr)} ${hint}\n`);
    process.exitCode = 1;
  });
}
