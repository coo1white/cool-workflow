// cli/entry.ts — the real entry point (`cw` / `cool-workflow` binaries).
//
// Byte-exact port of the shape of src/cli.ts + the top-of-function part of
// src/cli/command-surface.ts's `runCli` in the old build: top-level flag
// redirects, then dispatch (see cli/dispatch.ts), then the top-level
// catch that turns any thrown error into the fixed `cw: <message>` /
// `  Try: <hint>` stderr shape.
//
// Color: MILESTONE 11 (reporting/observability) wires shell/term.ts's
// color primitives here — the "Cool Workflow" help header is bolded and
// the error path is styled (bold "cw:", red message, dim "Try:"), TTY/
// env-gated exactly as SPEC/reporting-ux.md's "Color rule" describes.
// Every conformance case still pipes with NO_COLOR=1 by default (lib.js),
// so byte content there is unaffected; cli-color-env.case.js exercises
// the FORCE_COLOR/NO_COLOR/CW_NO_COLOR branches explicitly.

import { parseArgv } from "./parseargv";
import { dispatch } from "./dispatch";
import { formatCommandHelp } from "../core/format/help";
import { suggestCommand } from "./parseargv";
import { findCapability } from "../core/capability-table";
import type { CliHandlerResult } from "../core/capability-data";
import { bold, dim, red } from "../shell/term";
import { styledHelp } from "./io";

/** MILESTONE 2: `version` is now a pure projection of the capability
 *  table's `version` row — there is exactly one place its print text
 *  lives (core/capability-table.ts's cli handler), not a second
 *  hard-coded copy here. `help` has no row of its own (it is cli/
 *  entry.ts's own top-level redirect, same as milestone 1); its text
 *  comes from core/format/help.ts either way. */
function printVersion(): void {
  const row = findCapability("version");
  // `version`'s own handler is a pure, synchronous projection (never one of
  // the live drive rows) -- safe to read `.text` straight off it rather than
  // route through the generic (possibly-async) dispatch path.
  const result = row?.cli?.handler({ positionals: [], options: {} }) as CliHandlerResult | undefined;
  process.stdout.write(result?.text ?? "");
}

/** src/cli.ts:18-29 — map a top-level error message to ONE copy-pasteable
 *  recovery command. Content-based so it stays correct regardless of which
 *  call site threw; returns undefined rather than a wrong guess. */
export function recoveryHint(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.startsWith("unknown command")) return "cw help";
  if (m.includes("not configured") || m.includes("agent backend")) return "cw doctor";
  if (m.includes("missing") && m.includes("repo")) return 'cw -q "<question>" -dir <project-folder>';
  if (m.includes("app") && (m.includes("not found") || m.includes("not available"))) return "cw app list";
  if (m.includes("run id") || m.includes("run not found")) return "cw run list";
  return undefined;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgv(argv);

  // Top-level flags: accept --version / -v / --help / -h before command lookup.
  // (src/cli/command-surface.ts:46-55)
  if (args.command?.startsWith("-") || !args.command) {
    if (args.command === "--version" || args.command === "-v" || args.options.v || args.options.version) {
      printVersion();
      return;
    }
    if (!args.command || args.command === "--help" || args.command === "-h" || args.options.h || args.options.help) {
      process.stdout.write(styledHelp());
      return;
    }
  }

  // Vendor short flags -> --agent-command (src/cli/command-surface.ts:59-62).
  if (args.options.claude) args.options["agent-command"] = "builtin:claude";
  if (args.options.codex) args.options["agent-command"] = "builtin:codex";
  if (args.options.gemini) args.options["agent-command"] = "builtin:gemini";
  if (args.options.deepseek) args.options["agent-command"] = "builtin:deepseek";

  // -dir / --dir / -d is a second name for --repo; an explicit --repo wins
  // (src/cli/command-surface.ts:65).
  if (!args.options.repo && args.options.dir) args.options.repo = args.options.dir;

  // Presentation flags set env vars before any agent spawn
  // (src/cli/command-surface.ts:73-75).
  if (args.options.verbose) process.env.CW_VERBOSE = "1";
  if (args.options["no-color"]) process.env.CW_NO_COLOR = "1";
  if (args.options.full) process.env.CW_OUTPUT = "full";

  // `cw <verb> --help` / `-h` -> per-command help
  // (src/cli/command-surface.ts:80-83).
  if ((args.options.help || args.options.h) && args.command && !args.command.startsWith("-")) {
    process.stdout.write(formatCommandHelp(args.command, suggestCommand));
    return;
  }

  // Bare -q / --question -> redirect to quickstart (src/cli/command-surface.ts:88-93).
  if (args.command === "-q" || args.command === "--question") {
    if (!args.options.question && args.positionals[0]) args.options.question = args.positionals.shift();
    args.command = "quickstart";
  } else if (!args.command && typeof args.options.question === "string") {
    args.command = "quickstart";
  }

  await dispatch(args);
}

/** Top-level run wrapper matching src/cli.ts's catch shape byte-for-byte:
 *  `cw: <message>\n` then, only when a hint matches, `  Try: <hint>\n` on
 *  stderr; `process.exitCode = 1` (never a hard `process.exit`). */
export function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  return runCli(argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${bold("cw:", process.stderr)} ${red(message, process.stderr)}\n`);
    const hint = recoveryHint(message);
    if (hint) process.stderr.write(`  ${dim("Try:", process.stderr)} ${hint}\n`);
    process.exitCode = 1;
  });
}
