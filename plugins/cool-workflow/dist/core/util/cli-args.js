"use strict";
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
// Moved out of cli/io.ts (architecture-review P2): a cli/-layer file may
// not be imported by wiring/ (see scripts/purity-gate.js's layer rule),
// but every wiring/capability-table/*.ts slice called these three pure
// functions directly to coerce its own handler's args. Shared by CLI argv
// (cli/dispatch.ts, the wiring slices) AND MCP tool-call args (the same
// wiring slices' MCP handler bodies) — see core/util/numeric-flag.ts for
// the same CLI/MCP-shared framing.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.required = required;
exports.optionalArg = optionalArg;
exports.wantsJson = wantsJson;
exports.parseBoolFlag = parseBoolFlag;
exports.boolWord = boolWord;
exports.flagOn = flagOn;
exports.cwdArg = cwdArg;
exports.coerceMcpScalar = coerceMcpScalar;
exports.splitAgentCommandLine = splitAgentCommandLine;
exports.splitAgentCommand = splitAgentCommand;
exports.agentCommandArgv = agentCommandArgv;
exports.substituteAgentArg = substituteAgentArg;
const path = __importStar(require("node:path"));
/** Require a positional/option value or fail with a copy-pasteable recovery tip. */
function required(value, label) {
    if (!value) {
        throw new Error(`Missing ${label}.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"`);
    }
    return value;
}
/** Normalize an optional CLI arg to a trimmed non-empty string, else undefined. */
function optionalArg(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
/** True when the caller asked for JSON output (`--json` or `--format json`). */
function wantsJson(options) {
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
function parseBoolFlag(value, label) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === "boolean")
        return value;
    const text = String(value).trim();
    if (text === "")
        return false;
    const parsed = boolWord(text);
    if (parsed !== undefined)
        return parsed;
    throw new Error(`Invalid boolean value for ${label}: "${String(value)}" (use true or false)`);
}
/** A real boolean as is; a string that is (trimmed, any case) true/1/yes/on
 *  or false/0/no/off as that boolean; anything else (numbers, "") undefined. */
function boolWord(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value !== "string")
        return undefined;
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1" || text === "yes" || text === "on")
        return true;
    if (text === "false" || text === "0" || text === "no" || text === "off")
        return false;
    return undefined;
}
/** True when a flag is on. With no `onValues`, any boolWord() true. With
 *  `onValues`, only `true` or an exact (===) member: a caller that has read
 *  only "true" (or "true"/"1") as on keeps that narrower set. */
function flagOn(value, onValues) {
    if (onValues)
        return value === true || onValues.includes(value);
    return boolWord(value) === true;
}
/** The folder named by the first set key of `args` (default `cwd`; e.g.
 *  `["cwd", "repo"]`), resolved untrimmed; with none set, the process cwd
 *  (`path.resolve()`). Set = a non-blank string, or with `anyTruthy` any
 *  truthy value, read as `String(v)` (the old `String(o.cwd || ...)` form). */
function cwdArg(args, keys = ["cwd"], anyTruthy = false) {
    for (const key of keys) {
        const v = args[key];
        if (anyTruthy ? v : typeof v === "string" && v.trim())
            return path.resolve(String(v));
    }
    return path.resolve();
}
/** Coerce one top-level MCP tool-call argument to the form a CLI-shared
 *  handler reads. CLI argv is strings (or `true` for a bare flag), so a JSON
 *  number or `true` becomes its string form (`{"runId": 5}` is run "5", not
 *  a dropped arg). JSON `false` is the one exception: it stays the real
 *  boolean `false`. Its string form "false" is a non-empty string, and the
 *  handlers read flags with `Boolean(args.x)`, so `{"write": false}` used to
 *  WRITE, `{"all": false}` swept orphans of every age, and
 *  `{"allowUnverifiedCheckpoint": false}` wrote an unverified checkpoint
 *  (fail-open). The CLI never makes a real `false`, so CLI bytes do not
 *  change; a tri-state reader (`parseBoolFlag`) still sees an explicit
 *  false, not "unset". Arrays, objects, null and undefined pass through. */
function coerceMcpScalar(value) {
    if (value === false)
        return false;
    return typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" ? String(value) : value;
}
/** Split one command line on white space into argv tokens. */
function splitAgentCommandLine(line) {
    return line.split(/\s+/).filter(Boolean);
}
/** Config-layer split: an explicit args array always wins and the command
 *  is kept whole; else a command with white space is split. */
function splitAgentCommand(command, args) {
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
function agentCommandArgv(command, args) {
    const parts = splitAgentCommandLine(command);
    return { binary: parts[0], args: [...parts.slice(1), ...(args || [])] };
}
/** Fill {{key}} placeholders; an unknown key is left as written. */
function substituteAgentArg(arg, subst) {
    return arg.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in subst ? subst[key] : `{{${key}}}`));
}
