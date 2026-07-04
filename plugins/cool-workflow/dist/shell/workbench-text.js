"use strict";
// shell/workbench-text.ts — human text for `cw workbench view`. Byte-
// exact port of the old build's src/cli/format.ts's formatWorkbenchView.
//
// MILESTONE 11 (reporting/observability).
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatWorkbenchView = formatWorkbenchView;
function formatWorkbenchView(view) {
    const lines = [`Workbench view ${view.runId} (${view.resolved ? "resolved" : "UNRESOLVED"})`, view.error ? `  error: ${view.error}` : ""].filter(Boolean);
    for (const [group, panels] of Object.entries(view.panels)) {
        lines.push(`  ${group}:`);
        for (const [name, panel] of Object.entries(panels)) {
            const note = panel.status === "present" ? panel.capability : `absent (${panel.error || "unreadable"})`;
            lines.push(`    ${name}: ${panel.status} — ${note}`);
        }
    }
    return lines.join("\n");
}
