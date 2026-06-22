// CLI render helpers extracted from command-surface.ts (the dispatcher should
// route, not render). Pure string formatters for `cw clones` and `cw workbench`
// human output — no I/O, no ANSI; the dispatcher prints the returned string.
import { gcClones, listClones } from "../capability-core";
import { buildWorkbenchRunView } from "../workbench";

export function humanBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const units = ["KiB", "MiB", "GiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)}${units[i]}`;
}

export function formatClonesList(result: ReturnType<typeof listClones>): string {
  if (result.count === 0) return `No cached remote checkouts in ${result.clonesDir}.`;
  const rows = result.entries.map((e) => {
    const when = e.fetchedAt ? e.fetchedAt.replace("T", " ").replace(/\..*$/, "Z") : "unknown";
    return `  ${e.kind.padEnd(7)} ${humanBytes(e.bytes).padStart(8)}  ${when}  ${e.url}${e.ref ? `@${e.ref}` : ""}`;
  });
  return [
    `${result.count} cached checkout${result.count === 1 ? "" : "s"} — ${humanBytes(result.totalBytes)} in ${result.clonesDir}`,
    "  KIND       SIZE  FETCHED               SOURCE",
    ...rows,
    `\nReclaim with: cw clones gc --older-than-days 30   (or --all)`
  ].join("\n");
}

export function formatClonesGc(result: ReturnType<typeof gcClones>): string {
  const scope = result.all ? "all entries" : `entries older than ${result.olderThanDays} day(s)`;
  if (result.removed.length === 0) return `Nothing to reclaim (${scope}); ${result.keptCount} kept in ${result.clonesDir}.`;
  const rows = result.removed.map((r) => `  ${humanBytes(r.bytes).padStart(8)}  ${r.url}`);
  return [
    `Reclaimed ${result.removed.length} checkout${result.removed.length === 1 ? "" : "s"} (${scope}) — freed ${humanBytes(result.freedBytes)}; ${result.keptCount} kept`,
    ...rows
  ].join("\n");
}

export function formatWorkbenchView(view: ReturnType<typeof buildWorkbenchRunView>): string {
  const lines = [
    `Workbench view ${view.runId} (${view.resolved ? "resolved" : "UNRESOLVED"})`,
    view.error ? `  error: ${view.error}` : ""
  ].filter(Boolean);
  for (const [group, panels] of Object.entries(view.panels)) {
    lines.push(`  ${group}:`);
    for (const [name, panel] of Object.entries(panels as Record<string, { status: string; capability: string; error?: string }>)) {
      const note = panel.status === "present" ? panel.capability : `absent (${panel.error || "unreadable"})`;
      lines.push(`    ${name}: ${panel.status} — ${note}`);
    }
  }
  return lines.join("\n");
}
