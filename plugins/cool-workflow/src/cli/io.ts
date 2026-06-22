// Shared CLI input/output helpers, extracted from command-surface.ts so the
// dispatcher and per-command handler modules import ONE copy instead of carrying
// these in the god-object. Pure + zero-dep: arg coercion + JSON stdout.

/** Require a positional/option value or fail with a copy-pasteable recovery tip. */
export function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"`);
  return value;
}

/** Normalize an optional CLI arg to a trimmed non-empty string, else undefined. */
export function optionalArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Machine payload to stdout (stdout = data; never colored, never chrome). */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** True when the caller asked for JSON output (`--json` or `--format json`). */
export function wantsJson(options: Record<string, unknown>): boolean {
  return Boolean(options.json || options.format === "json");
}
