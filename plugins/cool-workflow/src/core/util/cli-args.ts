// core/util/cli-args.ts — shared CLI argv / MCP tool-call arg-coercion
// helpers: required(), optionalArg(), wantsJson().
//
// Pure. No fs, no child_process, no net, no process.env, no Date.now(), no
// Math.random().
//
// Moved out of cli/io.ts (architecture-review P2): a cli/-layer file may
// not be imported by wiring/ (see scripts/purity-gate.js's layer rule),
// but every wiring/capability-table/*.ts slice called these three pure
// functions directly to coerce its own handler's args. Shared by CLI argv
// (cli/dispatch.ts, the wiring slices) AND MCP tool-call args (the same
// wiring slices' MCP handler bodies) — see core/util/numeric-flag.ts for
// the same CLI/MCP-shared framing.

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

/** True when the caller asked for JSON output (`--json` or `--format json`). */
export function wantsJson(options: Record<string, unknown>): boolean {
  return Boolean(options.json || options.format === "json");
}

/** Parse a boolean flag value that may arrive as a real boolean (bare
 *  `--flag`) or as a CLI/MCP string (`--flag false`). `Boolean("false")` is
 *  `true` in JS, so a plain Boolean() coercion silently ENABLES a flag the
 *  operator asked to turn off — on a gate-policy flag like
 *  `--allow-self-approval false` that is a fail-open. Recognized strings
 *  (case-insensitive, trimmed): true/1/yes/on and false/0/no/off/"".
 *  Anything else throws — fail closed, never guess. `undefined` and JSON
 *  `null` (an MCP caller's "unset") stay `undefined` so a caller's
 *  `?? existing ?? default` chain still governs an unset flag. */
export function parseBoolFlag(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
  if (text === "false" || text === "0" || text === "no" || text === "off" || text === "") return false;
  throw new Error(`Invalid boolean value for ${label}: "${String(value)}" (use true or false)`);
}
