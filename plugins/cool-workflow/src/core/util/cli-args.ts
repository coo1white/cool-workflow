// core/util/cli-args.ts — argv helpers (required, optionalArg, wantsJson,
// flagOn, cwdArg) and THE one agent-command parser (CW_AGENT_COMMAND,
// --agent-command, agent-config.json "command", builtin:<name>): split on
// white space, NEVER shell-interpreted. Pure.

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

/** True for a non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A thrown value's text: an Error's message, else `String(error)`. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** An env var by name; on win32 the name is matched in any case (a copied
 *  Windows env holds `Path`, not `PATH`). */
function envVar(env: NodeJS.ProcessEnv, name: string, platform: string): string | undefined {
  if (env[name] !== undefined || platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/** The names to try for `name` on win32: as given when it already ends in
 *  a PATHEXT suffix (npm.cmd), else with each suffix (npm -> npm.CMD). */
function winNames(name: string, env: NodeJS.ProcessEnv): string[] {
  const exts = (envVar(env, "PATHEXT", "win32") || ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  return exts.some((ext) => name.toUpperCase().endsWith(ext.toUpperCase())) ? [name] : exts.map((ext) => name + ext);
}

/** The first `name` (plus each PATHEXT suffix on win32) in the PATH dirs, or
 *  undefined. The caller hands in the platform and the file test. */
export function findProgram(name: string, env: NodeJS.ProcessEnv, platform: string, isFile: (file: string) => boolean): string | undefined {
  const p = platform === "win32" ? path.win32 : path.posix;
  const names = platform === "win32" ? winNames(name, env) : [name];
  for (const dir of (envVar(env, "PATH", platform) || "").split(p.delimiter).filter(Boolean)) {
    for (const each of names) {
      const candidate = p.join(dir, each);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The script an npm-style .cmd shim starts (npm.cmd, claude.cmd, codex.cmd):
 *  the last existing `%~dp0\...` / `%dp0%\...` path in it that is not
 *  node.exe. `node` is true when the shim runs it with node. Undefined for
 *  any other batch file. */
export function cmdShimTarget(text: string, shimPath: string, isFile: (file: string) => boolean): { script: string; node: boolean } | undefined {
  const dir = path.win32.dirname(shimPath);
  const targets = [...text.matchAll(/%~?dp0%?\\?([^"%\r\n]+)"/gi)]
    .map((m) => path.win32.resolve(dir, m[1]))
    .filter((file) => !/(^|\\)node\.exe$/i.test(file) && isFile(file));
  const script = targets[targets.length - 1];
  if (!script) return undefined;
  if (/\.(exe|com)$/i.test(script)) return { script, node: false };
  return /\bnode(\.exe)?\b/i.test(text) ? { script, node: true } : undefined;
}

/** Argv that Node can start with no shell. Off win32 it is given back as is.
 *  On win32 the program is looked up on PATH with PATHEXT, as cmd would;
 *  Node refuses to start a .cmd/.bat without a shell (CVE-2024-27980), and
 *  CW never uses one, so an npm-style shim is read and the script it starts
 *  is run with `nodePath` (npm -> node npm-cli.js), or the .exe it starts is
 *  run. Anything else comes back as found, to fail with its own error. */
export function spawnArgv(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: string,
  nodePath: string,
  io: { isFile: (file: string) => boolean; readText: (file: string) => string }
): { binary: string; args: string[] } {
  if (platform !== "win32" || !binary) return { binary, args };
  const found = /[\\/]/.test(binary) ? winNames(binary, env).find((file) => io.isFile(file)) : findProgram(binary, env, platform, io.isFile);
  if (!found) return { binary, args };
  if (!/\.(cmd|bat)$/i.test(found)) return { binary: found, args };
  let shim: { script: string; node: boolean } | undefined;
  try {
    shim = cmdShimTarget(io.readText(found), found, io.isFile);
  } catch {
    shim = undefined;
  }
  if (!shim) return { binary: found, args };
  return shim.node ? { binary: nodePath, args: [shim.script, ...args] } : { binary: shim.script, args };
}

/** True when the caller asked for JSON output (`--json` or `--format json`). */
export function wantsJson(options: Record<string, unknown>): boolean {
  return Boolean(options.json || options.format === "json");
}

/** True when a flag is on: `true`, or "true" / "1" / "yes" / "on". */
export function flagOn(value: unknown): boolean {
  return value === true || (typeof value === "string" && ["true", "1", "yes", "on"].includes(value.trim().toLowerCase()));
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
