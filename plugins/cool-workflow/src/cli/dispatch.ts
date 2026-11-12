// cli/dispatch.ts — one parsed argv to one command row, then print its
// result by the row's jsonMode.

import { formatCommandHelp } from "../core/format/help.js";
import type { CommandResult, CommandRow } from "../core/command.js";
import { wantsJson } from "../core/util/cli-args.js";
import { COMMANDS, findCommand } from "../wiring/commands.js";
import { printJson, styledHelp } from "./io.js";
import { ParsedArgv, suggestCommand } from "./parseargv.js";

/** A "default" row prints its human view only on a real TTY without
 *  --json; every pipe gets the same JSON bytes. Color env never picks the mode. */
export function shouldRenderHuman(row: CommandRow, options: Record<string, unknown>, stream: { isTTY?: boolean } = process.stdout): boolean {
  return row.jsonMode === "default" && !wantsJson(options) && Boolean(row.humanRender) && Boolean(stream.isTTY);
}

function writeText(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function render(result: CommandResult, row: CommandRow, options: Record<string, unknown>): void {
  const useJson = row.jsonMode === "default" || (row.jsonMode === "flag" && wantsJson(options));
  if (shouldRenderHuman(row, options) && result.json !== undefined) writeText(row.humanRender!(result.json));
  else if (useJson && result.json !== undefined) printJson(result.json);
  else if (result.text !== undefined) writeText(result.text);
  else if (result.json !== undefined) printJson(result.json);
  if (result.exitCode !== undefined) process.exitCode = result.exitCode;
}

/** Run one row; `consumed` positionals were path tokens after the verb. */
export async function runRow(row: CommandRow, args: ParsedArgv, consumed = 0): Promise<void> {
  const result = await row.handler({ positionals: args.positionals.slice(consumed), options: args.options });
  render(result, row, args.options);
}

export async function dispatch(args: ParsedArgv): Promise<void> {
  const sub = args.positionals[0];
  const two = sub === undefined ? undefined : findCommand([args.command, sub]);
  if (two) return runRow(two, args, 1);
  const one = findCommand([args.command]);
  if (one) return runRow(one, args);
  if (args.command === "" || args.command === "help") {
    process.stdout.write(args.command === "help" && sub ? formatCommandHelp(sub, suggestCommand, COMMANDS) : styledHelp());
    return;
  }
  const hint = suggestCommand(args.command);
  throw new Error(`Unknown command: ${args.command}${hint ? `. Did you mean: ${hint}?` : ""}`);
}
