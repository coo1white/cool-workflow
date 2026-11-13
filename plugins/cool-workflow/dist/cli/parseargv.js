// cli/parseargv.ts — parseArgv, KNOWN_COMMANDS, suggestCommand. Pure.
//
// Each rule is pinned by a conformance case: the first token is the
// command; after "--" every token is positional; "-x" maps through the
// alias table, else keeps its name ("-qr" stays "qr", not split); a flag
// takes the next token only if it does not start with "-"; "--k=v" may
// start with "-"; a repeated option becomes an array.
/** The single-dash short-flag table. */
const SHORT_FLAG_TABLE = {
    q: "question",
    r: "repo",
    d: "dir",
    a: "agent-command",
    h: "help",
    v: "version",
};
function looksLikeFlagValue(token) {
    return token !== undefined && !token.startsWith("-");
}
/** A repeated key becomes an array. */
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
export function parseArgv(argv) {
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
/** Every top-level command name, for "did you mean". */
export const KNOWN_COMMANDS = new Set(["help", "report", "check", "version"]);
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
/** Nearest known command, or undefined when none is close (input under
 *  2 chars, distance over 3 or over half the input). */
export function suggestCommand(input) {
    if (!input || input.length < 2)
        return undefined;
    let best;
    let bestDistance = Infinity;
    for (const candidate of KNOWN_COMMANDS) {
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
