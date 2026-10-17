// shell/workbench-text.ts — human text for `cw workbench view`.

import { WorkbenchRunView } from "./workbench.js";

export function formatWorkbenchView(view: WorkbenchRunView): string {
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
