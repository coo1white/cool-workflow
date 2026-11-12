// core/util/cli-args.ts — shared CLI argv / MCP tool-call arg-coercion
// helpers: required(), optionalArg(), wantsJson(), the bool readers
// (boolWord, flagOn, parseBoolFlag), the one --cwd reader, cwdArg(); and THE
// one agent-command parser (CW_AGENT_COMMAND, --agent-command,
// agent-config.json "command", builtin:<name> templates) — split on white
// space, NEVER shell-interpreted.
//
// Pure. No fs, no child_process, no net, no process.env, no Date.now(), no
// Math.random().
//
// These live in core/, not cli/io.ts: a cli/-layer file may
// not be imported by wiring/ (see scripts/purity-gate.mjs's layer rule),
// but every wiring/capability-table/*.ts slice called these three pure
// functions directly to coerce its own handler's args. Shared by CLI argv
// (cli/dispatch.ts, the wiring slices) AND MCP tool-call args (the same
// wiring slices' MCP handler bodies) — see core/util/numeric-flag.ts for
// the same CLI/MCP-shared framing.
//
// It also keeps the one copy of a few small pure helpers that three or
// more files need (requireArg, isRecord, messageOf, countBy). They are
// here, not in a new module, because every command already loads this
// one: a new module would be one more load on each path that uses them,
// and scripts/bench/perf-ceilings.json lets no module count go up.

import * as path from "node:path";

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

/** Require a value: `String(value)` unless that is empty (or the value is
 *  undefined/null), which throws `Missing <label>` with no tip. */
export function requireArg(value: unknown, label: string): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (!s) throw new Error(`Missing ${label}`);
  return s;
}

/** True for a non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A thrown value's text: an Error's message, else `String(error)`. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first `name` (plus each PATHEXT suffix on win32) in the PATH dirs, or
 *  undefined. The caller hands in the platform and the file test. */
export function findProgram(name: string, env: NodeJS.ProcessEnv, platform: string, isFile: (file: string) => boolean): string | undefined {
  const p = platform === "win32" ? path.win32 : path.posix;
  const exts = platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH || "").split(p.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = p.join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Count values by the key each one maps to, in first-seen key order. */
export function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const bucket = key(value);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
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
  const text = String(value).trim();
  if (text === "") return false;
  const parsed = boolWord(text);
  if (parsed !== undefined) return parsed;
  throw new Error(`Invalid boolean value for ${label}: "${String(value)}" (use true or false)`);
}

/** A real boolean as is; a string that is (trimmed, any case) true/1/yes/on
 *  or false/0/no/off as that boolean; anything else (numbers, "") undefined. */
export function boolWord(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
  if (text === "false" || text === "0" || text === "no" || text === "off") return false;
  return undefined;
}

/** True when a flag is on. With no `onValues`, any boolWord() true. With
 *  `onValues`, only `true` or an exact (===) member: a caller that has read
 *  only "true" (or "true"/"1") as on keeps that narrower set. */
export function flagOn(value: unknown, onValues?: readonly unknown[]): boolean {
  if (onValues) return value === true || onValues.includes(value);
  return boolWord(value) === true;
}

/** The folder named by the first set key of `args` (default `cwd`; e.g.
 *  `["cwd", "repo"]`), resolved untrimmed; with none set, the process cwd
 *  (`path.resolve()`). Set = a non-blank string, or with `anyTruthy` any
 *  truthy value, read as `String(v)`. */
export function cwdArg(args: Record<string, unknown>, keys: readonly string[] = ["cwd"], anyTruthy = false): string {
  for (const key of keys) {
    const v = args[key];
    if (anyTruthy ? v : typeof v === "string" && v.trim()) return path.resolve(String(v));
  }
  return path.resolve();
}

/** Coerce one top-level MCP tool-call argument to the form a CLI-shared
 *  handler reads. CLI argv is strings (or `true` for a bare flag), so a JSON
 *  number or `true` becomes its string form (`{"runId": 5}` is run "5", not
 *  a dropped arg). JSON `false` is the one exception: it stays the real
 *  boolean `false`. Its string form "false" is a non-empty string, and the
 *  handlers read flags with `Boolean(args.x)`, so `{"write": false}` would
 *  WRITE, and
 *  `{"allowUnverifiedCheckpoint": false}` would write an unverified checkpoint
 *  (fail-open). The CLI never makes a real `false`, so CLI bytes do not
 *  change; a tri-state reader (`parseBoolFlag`) still sees an explicit
 *  false, not "unset". Arrays, objects, null and undefined pass through. */
export function coerceMcpScalar(value: unknown): unknown {
  if (value === false) return false;
  return typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" ? String(value) : value;
}

/** Split one command line on white space into argv tokens. */
export function splitAgentCommandLine(line: string): string[] {
  return line.split(/\s+/).filter(Boolean);
}

/** Config-layer split: an explicit args array always wins and the command
 *  is kept whole; else a command with white space is split. */
export function splitAgentCommand(command: string | undefined, args: string[] | undefined): { command?: string; args?: string[] } {
  if (!command) return { command: undefined, args };
  if (args && args.length) return { command, args };
  if (/\s/.test(command)) {
    const parts = splitAgentCommandLine(command);
    return { command: parts[0], args: parts.slice(1) };
  }
  return { command, args };
}

/** Spawn argv from a resolved config: the command's inline tokens, then
 *  the explicit args after them. */
export function agentCommandArgv(command: string, args: string[] | undefined): { binary: string; args: string[] } {
  const parts = splitAgentCommandLine(command);
  return { binary: parts[0], args: [...parts.slice(1), ...(args || [])] };
}

/** Fill {{key}} placeholders; an unknown key is left as written. */
export function substituteAgentArg(arg: string, subst: Record<string, string>): string {
  return arg.replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key in subst ? subst[key] : `{{${key}}}`));
}

/** Proxy and CA env a child that uses the network needs; one list for the agent, local and container paths. */
export const NETWORK_ENV_NAMES: ReadonlySet<string> = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_USE_ENV_PROXY"]);

/** Copy NETWORK_ENV_NAMES from baseEnv into env, never over a name env already has or one deny names. */
export function addNetworkEnv(env: NodeJS.ProcessEnv, baseEnv: NodeJS.ProcessEnv, deny: readonly string[] = []): NodeJS.ProcessEnv {
  for (const name of NETWORK_ENV_NAMES) if (baseEnv[name] !== undefined && env[name] === undefined && !deny.includes(name)) env[name] = baseEnv[name];
  return env;
}

/** Node's own fetch reads HTTP(S)_PROXY only with NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24.5+).
 *  For a child CW starts to run fetch: turn it on when a proxy is set, never over the user's own value. */
export function fetchChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const proxied = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].some((name) => env[name]);
  return proxied && env.NODE_USE_ENV_PROXY === undefined ? { ...env, NODE_USE_ENV_PROXY: "1" } : env;
}

/** Node flags for such a child: keep Node's "experimental" proxy note out of its stderr (which CW shows as the reason on a failure). */
export const FETCH_CHILD_NODE_ARGS: readonly string[] = ["--disable-warning=UNDICI-EHPA"];
