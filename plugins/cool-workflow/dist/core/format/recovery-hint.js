"use strict";
// core/format/recovery-hint.ts — recoveryHint, a pure content-based lookup
// from a thrown error's message to ONE copy-pasteable follow-up command.
//
// src/cli.ts in the old build. Moved here (out of cli/entry.ts) so
// mcp/server.ts can use the same lookup for its own error text without
// crossing the mcp/-may-never-import-cli/ layer rule that
// scripts/purity-gate.js enforces — core/ may be read by both cli/ and
// mcp/. cli/entry.ts now just re-exports this function; its own call
// site and behavior are unchanged.
//
// Content-based (reads the message text, not the call site), so it stays
// correct no matter which command or tool threw. Returns `undefined`
// rather than a wrong guess when no pattern matches.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoveryHint = recoveryHint;
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
    if (m.includes("missing required input") && m.includes("question"))
        return 'cw -q "<question>"';
    return undefined;
}
