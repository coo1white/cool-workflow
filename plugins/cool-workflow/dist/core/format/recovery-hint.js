// core/format/recovery-hint.ts — recoveryHint, a pure content-based lookup
// from a thrown error's message to ONE copy-pasteable follow-up command.
//
// It lives in core/ so mcp/server.ts can use the same lookup for its own
// error text without crossing the mcp/-may-never-import-cli/ layer rule
// that scripts/purity-gate.mjs enforces — core/ may be read by both cli/
// and mcp/. cli/entry.ts re-exports this function.
//
// Content-based (reads the message text, not the call site), so it stays
// correct no matter which command or tool threw. Returns `undefined`
// rather than a wrong guess when no pattern matches.
export function recoveryHint(message) {
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
/** The fixed next step when no run is selected (`cw status` with no id).
 *  Kept here, in a module every command already loads, so that answer
 *  does not pull in the run-reading modules. */
export function adviseNoRun() {
    return [
        {
            command: "cw plan <workflow-id> --repo <path>",
            reason: "No run id is available yet; create a workflow run before dispatching or recording evidence.",
            priority: "high",
        },
    ];
}
