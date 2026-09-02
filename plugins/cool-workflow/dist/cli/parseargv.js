"use strict";
// cli/parseargv.ts — parseArgv, KNOWN_COMMANDS, suggestCommand.
//
// Pure. Byte-exact port of the old build's orchestrator (now src/shell/orchestrator.ts).
// See plugins/cool-workflow/project/docs/rebuild/PLAN.md byte-compat item 15 and SPEC/cli-surface.md "Argument
// parsing (parseArgv)" / SPEC/orchestrator.md "Module-level exports".
//
// Rules (do not "clean up" — every one of these is pinned by a conformance
// case):
//   - first token is the command, taken as-is;
//   - "--" is the POSIX end-of-options mark: every later token is a
//     positional, even one that starts with "-" or "--";
//   - a token with no leading "-" is a positional;
//   - a single-dash token maps through the short-alias table below; a name
//     not in the table keeps its own name ("-dir" -> option "dir"); joined
//     short flags like "-qr" are NOT split apart, the key stays "qr";
//   - a flag's value is the NEXT token only when that token does not start
//     with "-" (single or double dash); otherwise the value is `true`;
//   - "--key=value" gives a value that may itself start with "-";
//   - a repeated option becomes an array of values.
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_COMMANDS = void 0;
exports.parseArgv = parseArgv;
exports.suggestCommand = suggestCommand;
/** src/shell/orchestrator.ts — single-dash short-flag table. */
const SHORT_FLAG_TABLE = {
    q: "question",
    r: "repo",
    d: "dir",
    l: "link",
    a: "agent-command",
    h: "help",
    v: "version",
};
function looksLikeFlagValue(token) {
    return token !== undefined && !token.startsWith("-");
}
/** src/shell/orchestrator.ts — appendOption: a repeated key becomes an
 *  array; a third+ occurrence pushes onto that same array. */
function appendOption(options, key, value) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
        const existing = options[key];
        if (Array.isArray(existing)) {
            existing.push(value);
        }
        else {
            options[key] = [existing, value];
        }
    }
    else {
        options[key] = value;
    }
}
function parseArgv(argv) {
    const command = argv.length > 0 ? argv[0] : "";
    const rest = argv.slice(1);
    const positionals = [];
    const options = {};
    let i = 0;
    let endOfOptions = false;
    while (i < rest.length) {
        const token = rest[i];
        if (endOfOptions) {
            positionals.push(token);
            i += 1;
            continue;
        }
        if (token === "--") {
            endOfOptions = true;
            i += 1;
            continue;
        }
        if (!token.startsWith("-")) {
            positionals.push(token);
            i += 1;
            continue;
        }
        // token starts with "-" (either "-x" or "--flag[=value]").
        const isLong = token.startsWith("--");
        const body = isLong ? token.slice(2) : token.slice(1);
        const eqIndex = body.indexOf("=");
        if (eqIndex !== -1) {
            const rawKey = body.slice(0, eqIndex);
            const value = body.slice(eqIndex + 1);
            const key = isLong ? rawKey : SHORT_FLAG_TABLE[rawKey] || rawKey;
            appendOption(options, key, value);
            i += 1;
            continue;
        }
        const key = isLong ? body : SHORT_FLAG_TABLE[body] || body;
        const next = rest[i + 1];
        if (looksLikeFlagValue(next)) {
            appendOption(options, key, next);
            i += 2;
        }
        else {
            appendOption(options, key, true);
            i += 1;
        }
    }
    return { command, positionals, options };
}
/** src/shell/orchestrator.ts — every top-level command name, used for
 *  "did you mean". NOTE: this deliberately does NOT include "ledger" even
 *  though the dispatcher handles it and formatHelp lists it — a known,
 *  intentionally-preserved wart (see plugins/cool-workflow/project/docs/rebuild/PLAN.md "Kept byte-for-byte").
 *  NOTE: "update" is gone from the old capture's list on purpose: no code
 *  was behind the verb in this build, so having it here made `cw update`
 *  say "Did you mean: update?" — a hint that points at itself. */
exports.KNOWN_COMMANDS = new Set([
    "help", "list", "doctor", "info", "search", "man", "init", "quickstart",
    "plan", "status", "next", "dispatch", "result", "state", "commit", "report",
    "app", "sandbox", "backend", "contract", "node", "feedback", "worker",
    "audit", "candidate", "review", "loop", "schedule", "routine", "registry",
    "run", "queue", "clones", "orphans", "history", "audit-run", "multi-agent",
    "topology", "summary", "blackboard", "coordinator", "metrics", "operator",
    "sched", "gc", "telemetry", "migration", "demo", "workbench", "approve",
    "reject", "comment", "handoff", "graph", "eval", "version", "fix",
    "completion",
]);
/** Levenshtein edit distance between two strings. */
function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j += 1)
        dp[j] = j;
    for (let i = 1; i <= m; i += 1) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j += 1) {
            const temp = dp[j];
            dp[j] = a[i - 1] === b[j - 1]
                ? prev
                : 1 + Math.min(prev, dp[j], dp[j - 1]);
            prev = temp;
        }
    }
    return dp[n];
}
/** src/shell/orchestrator.ts — nearest known command by edit distance.
 *  Gives `undefined` when the input is under 2 chars, or when the best
 *  distance is over 3 or over half the input length. Never gives back the
 *  input itself: a caller only asks for a suggestion when the input did
 *  NOT resolve, so a distance-0 self-match (an alias token like
 *  `audit-run` that IS in KNOWN_COMMANDS but has no help rows of its own)
 *  was a hint that pointed at the very thing the user just typed. */
function suggestCommand(input) {
    if (!input || input.length < 2)
        return undefined;
    let best;
    let bestDistance = Infinity;
    for (const candidate of exports.KNOWN_COMMANDS) {
        if (candidate === input)
            continue;
        const distance = levenshtein(input, candidate);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    if (best === undefined)
        return undefined;
    if (bestDistance > 3 || bestDistance > input.length / 2)
        return undefined;
    return best;
}
