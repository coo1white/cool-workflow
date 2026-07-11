"use strict";
// core/util/cli-args.ts — shared CLI argv / MCP tool-call arg-coercion
// helpers: required(), optionalArg(), wantsJson().
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.required = required;
exports.optionalArg = optionalArg;
exports.wantsJson = wantsJson;
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
