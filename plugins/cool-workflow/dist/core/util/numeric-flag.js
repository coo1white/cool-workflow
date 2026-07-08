"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requiredNumberFlag = requiredNumberFlag;
// core/util/numeric-flag.ts — THE one strict numeric-CLI/MCP-flag parser
// (e.g. `--limit <n>`).
//
// Pure. No fs, no child_process, no net, no process.env, no Date.now(), no
// Math.random().
//
// Several shell/*.ts call sites each rolled their own
// `value === undefined ? undefined : Number(value)` — every one of them
// shares the SAME bug: a bare flag with no value (parseargv turns
// `--limit` alone into boolean `true`) silently becomes `Number(true) ===
// 1`, never an error. Other sites instead built the fallback with `||`
// (`limit || default`), which ALSO silently replaces a genuinely-given `0`
// (or a `NaN` from an unparseable string, since `NaN` is falsy too) with
// the default. Downstream, an accepted negative number reaching something
// like `.slice(0, limit)` silently drops trailing entries instead of
// erroring. `requiredNumberFlag` closes all three holes: absent stays
// absent (the caller's own default applies); a flag that WAS given but is
// unusable (bare, or non-finite) throws instead of guessing.
function requiredNumberFlag(value, flagLabel) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === "boolean") {
        throw new Error(`${flagLabel} requires a value (e.g. ${flagLabel} 4)`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new Error(`Invalid ${flagLabel} ${JSON.stringify(value)}: expected a number (e.g. ${flagLabel} 4)`);
    }
    return n;
}
