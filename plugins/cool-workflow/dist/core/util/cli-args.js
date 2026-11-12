// core/util/cli-args.ts — argv helpers (required, optionalArg, wantsJson,
// flagOn, cwdArg) and THE one agent-command parser (CW_AGENT_COMMAND,
// --agent-command, agent-config.json "command", builtin:<name>): split on
// white space, NEVER shell-interpreted. Pure.
import * as path from "node:path";
/** Require a positional/option value or fail with a copy-pasteable recovery tip. */
export function required(value, label) {
    if (!value) {
        throw new Error(`Missing ${label}.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"`);
    }
    return value;
}
/** Normalize an optional CLI arg to a trimmed non-empty string, else undefined. */
export function optionalArg(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
/** True for a non-null object that is not an array. */
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** A thrown value's text: an Error's message, else `String(error)`. */
export function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** The first `name` (plus each PATHEXT suffix on win32) in the PATH dirs, or
 *  undefined. The caller hands in the platform and the file test. */
export function findProgram(name, env, platform, isFile) {
    const p = platform === "win32" ? path.win32 : path.posix;
    const exts = platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
    for (const dir of (env.PATH || "").split(p.delimiter).filter(Boolean)) {
        for (const ext of exts) {
            const candidate = p.join(dir, name + ext);
            if (isFile(candidate))
                return candidate;
        }
    }
    return undefined;
}
/** True when the caller asked for JSON output (`--json` or `--format json`). */
export function wantsJson(options) {
    return Boolean(options.json || options.format === "json");
}
/** True when a flag is on: `true`, or "true" / "1" / "yes" / "on". */
export function flagOn(value) {
    return value === true || (typeof value === "string" && ["true", "1", "yes", "on"].includes(value.trim().toLowerCase()));
}
/** The folder named by the first set key of `args` (default `cwd`; e.g.
 *  `["cwd", "repo"]`), resolved untrimmed; with none set, the process cwd
 *  (`path.resolve()`). Set = a non-blank string, or with `anyTruthy` any
 *  truthy value, read as `String(v)`. */
export function cwdArg(args, keys = ["cwd"], anyTruthy = false) {
    for (const key of keys) {
        const v = args[key];
        if (anyTruthy ? v : typeof v === "string" && v.trim())
            return path.resolve(String(v));
    }
    return path.resolve();
}
/** Split one command line on white space into argv tokens. */
export function splitAgentCommandLine(line) {
    return line.split(/\s+/).filter(Boolean);
}
/** Config-layer split: an explicit args array always wins and the command
 *  is kept whole; else a command with white space is split. */
export function splitAgentCommand(command, args) {
    if (!command)
        return { command: undefined, args };
    if (args && args.length)
        return { command, args };
    if (/\s/.test(command)) {
        const parts = splitAgentCommandLine(command);
        return { command: parts[0], args: parts.slice(1) };
    }
    return { command, args };
}
/** Spawn argv from a resolved config: the command's inline tokens, then
 *  the explicit args after them. */
export function agentCommandArgv(command, args) {
    const parts = splitAgentCommandLine(command);
    return { binary: parts[0], args: [...parts.slice(1), ...(args || [])] };
}
/** Fill {{key}} placeholders; an unknown key is left as written. */
export function substituteAgentArg(arg, subst) {
    return arg.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in subst ? subst[key] : `{{${key}}}`));
}
/** Proxy and CA env a child that uses the network needs; one list for the agent, local and container paths. */
export const NETWORK_ENV_NAMES = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_USE_ENV_PROXY"]);
