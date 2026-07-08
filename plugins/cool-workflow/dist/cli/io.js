"use strict";
// cli/io.ts — shared CLI input/output helpers.
//
// Byte-exact port of src/cli/io.ts in the old build. Pure + zero-dep: arg
// coercion + JSON stdout. See SPEC/cli-surface.md "Shared io helpers".
//
// MILESTONE 11 (reporting/observability) adds `styledHelp` — the one
// place `formatHelp()`'s plain text gets its "Cool Workflow" header
// bolded, TTY/env-gated via shell/term.ts's `bold()`. Kept here (not in
// core/format/help.ts, which stays a pure text generator) since it needs
// shell/term.ts's env/TTY read.
Object.defineProperty(exports, "__esModule", { value: true });
exports.styledHelp = styledHelp;
exports.required = required;
exports.optionalArg = optionalArg;
exports.printJson = printJson;
exports.wantsJson = wantsJson;
const help_1 = require("../core/format/help");
const safe_json_1 = require("../core/format/safe-json");
const term_1 = require("../shell/term");
/** Bold ONLY the fixed "Cool Workflow" header line of `formatHelp()`'s
 *  plain text. */
function styledHelp() {
    const text = (0, help_1.formatHelp)();
    return text.replace(/^Cool Workflow\n/, `${(0, term_1.bold)("Cool Workflow")}\n`);
}
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
/** Machine payload to stdout (stdout = data; never colored, never chrome).
 *  Byte-capped via safeJsonStringify — an aggregate result too large to be
 *  useful (or large enough to blow V8's string limit) prints a small
 *  overflow notice instead of hundreds of MB. */
function printJson(value) {
    process.stdout.write(`${(0, safe_json_1.safeJsonStringify)(value)}\n`);
}
/** True when the caller asked for JSON output (`--json` or `--format json`). */
function wantsJson(options) {
    return Boolean(options.json || options.format === "json");
}
