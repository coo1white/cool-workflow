#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoveryHint = recoveryHint;
const command_surface_1 = require("./cli/command-surface");
const term_1 = require("./term");
(0, command_surface_1.runCli)(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const err = process.stderr;
    // Errors go to stderr → color must key off stderr (not the term default).
    err.write(`${(0, term_1.bold)("cw:", err)} ${(0, term_1.red)(message, err)}\n`);
    // Brew-style recovery: a failed command should suggest a concrete next move. The hint
    // is TTY-gated (tryHint dims only on a TTY) and goes to stderr, so piped stdout stays
    // clean. It points at CW's OWN diagnose/discovery verbs (vendor-neutral) — never a model.
    const hint = recoveryHint(message);
    if (hint)
        err.write(`  ${(0, term_1.tryHint)(hint, err)}\n`);
    process.exitCode = 1;
});
/** Map a top-level error message to ONE copy-pasteable recovery command (brew's `Try:`).
 *  Content-based so it stays correct for any vendor; returns undefined rather than a
 *  wrong guess when nothing matches (no hint beats a misleading one). */
function recoveryHint(message) {
    const m = message.toLowerCase();
    if (m.startsWith("unknown command"))
        return "cw help";
    if (m.includes("not configured") || m.includes("agent backend"))
        return "cw doctor";
    if (m.includes("missing") && m.includes("repo"))
        return 'cw -q "<question>" -dir <project-folder>';
    if (m.includes("app") && (m.includes("not found") || m.includes("not available")))
        return "cw app list";
    if (m.includes("run id") || m.includes("run not found"))
        return "cw run list";
    return undefined;
}
