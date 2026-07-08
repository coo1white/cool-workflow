// cli/io.ts — shared CLI input/output helpers.
//
// Byte-exact port of src/cli/io.ts in the old build. Pure + zero-dep: arg
// coercion + JSON stdout. See SPEC/cli-surface.md "Shared io helpers".
//
// MILESTONE 11 (reporting/observability) adds `styledHelp` — the one
// place `formatHelp()`'s plain text gets its "Cool Workflow" header
// bolded, TTY/env-gated via shell/term.ts's `bold()`. Kept here (not in
// core/format/help.ts, which stays a pure text generator) since it needs
// shell/term.ts's env/TTY read.

import { formatHelp } from "../core/format/help";
import { safeJsonStringify } from "../core/format/safe-json";
import { bold } from "../shell/term";

/** Bold ONLY the fixed "Cool Workflow" header line of `formatHelp()`'s
 *  plain text. */
export function styledHelp(): string {
  const text = formatHelp();
  return text.replace(/^Cool Workflow\n/, `${bold("Cool Workflow")}\n`);
}

/** Require a positional/option value or fail with a copy-pasteable recovery tip. */
export function required(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(
      `Missing ${label}.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"`
    );
  }
  return value;
}

/** Normalize an optional CLI arg to a trimmed non-empty string, else undefined. */
export function optionalArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Machine payload to stdout (stdout = data; never colored, never chrome).
 *  Byte-capped via safeJsonStringify — an aggregate result too large to be
 *  useful (or large enough to blow V8's string limit) prints a small
 *  overflow notice instead of hundreds of MB. */
export function printJson(value: unknown): void {
  process.stdout.write(`${safeJsonStringify(value)}\n`);
}

/** True when the caller asked for JSON output (`--json` or `--format json`). */
export function wantsJson(options: Record<string, unknown>): boolean {
  return Boolean(options.json || options.format === "json");
}
