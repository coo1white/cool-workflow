// cli/io.ts — shared CLI input/output helpers.
//
// Byte-exact port of src/cli/io.ts in the old build. Pure + zero-dep JSON
// stdout, plus one impure TTY-aware help formatter. See SPEC/cli-surface.md
// "Shared io helpers". Arg-coercion helpers (`required`/`optionalArg`/
// `wantsJson`) moved to core/util/cli-args.ts (architecture-review P2) —
// wiring/capability-table/*.ts needed them directly, and a cli/-layer file
// may not be imported by wiring/ (scripts/purity-gate.js's layer rule).
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

/** Machine payload to stdout (stdout = data; never colored, never chrome).
 *  Byte-capped via safeJsonStringify — an aggregate result too large to be
 *  useful (or large enough to blow V8's string limit) prints a small
 *  overflow notice instead of hundreds of MB. */
export function printJson(value: unknown): void {
  process.stdout.write(`${safeJsonStringify(value)}\n`);
}
