"use strict";
// Shared CLI input/output helpers, extracted from command-surface.ts so the
// dispatcher and per-command handler modules import ONE copy instead of carrying
// these in the god-object. Pure + zero-dep: arg coercion + JSON stdout.
Object.defineProperty(exports, "__esModule", { value: true });
exports.required = required;
exports.optionalArg = optionalArg;
exports.printJson = printJson;
exports.wantsJson = wantsJson;
/** Require a positional/option value or fail with a copy-pasteable recovery tip. */
function required(value, label) {
    if (!value)
        throw new Error(`Missing ${label}.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"`);
    return value;
}
/** Normalize an optional CLI arg to a trimmed non-empty string, else undefined. */
function optionalArg(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
/** Machine payload to stdout (stdout = data; never colored, never chrome). */
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
/** True when the caller asked for JSON output (`--json` or `--format json`). */
function wantsJson(options) {
    return Boolean(options.json || options.format === "json");
}
