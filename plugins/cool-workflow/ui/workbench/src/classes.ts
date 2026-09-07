// Class strings used more than once, ported byte-for-byte from the old
// app.js. One word each for colour: green = done and checked, orange = the
// tool is working, amber = needs a person, red = broke.
export const C = {
  label: "font-mono text-[11px] uppercase tracking-[.08em] text-base-content/60",
  pill: "badge badge-outline badge-sm h-[22px] font-mono text-[11px] uppercase tracking-[.04em] text-base-content/60",
  cmd: "inline-block rounded-md border border-base-300 bg-base-300 px-2 font-mono text-[12px] leading-[1.6] text-base-content [overflow-wrap:anywhere]",
  card: "card card-sm card-border bg-base-200 text-[13px] [&>*]:gap-1.5",
  block: "border-t border-base-300 px-3.5 py-2.5 first:border-t-0",
  title: "mb-1.5 font-mono text-[11px] uppercase tracking-[.08em] text-base-content/60",
  items: "m-0 ps-[18px] font-mono text-[12px] leading-normal whitespace-pre-wrap [overflow-wrap:anywhere]",
} as const;

export const TONE: Record<string, string> = {
  present: "badge-success", valid: "badge-success", completed: "badge-success",
  running: "badge-accent",
  absent: "badge-warning", stale: "badge-warning", blocked: "badge-warning",
  missing: "badge-error", bad: "badge-error", failed: "badge-error",
};

export const DOT: Record<string, string> = {
  running: "bg-primary",
  completed: "bg-success",
  blocked: "bg-warning",
  failed: "bg-error",
};

// The stamp word comes from `view.lifecycle` alone; no key, no stamp.
export const STAMP: Record<string, [string, string]> = {
  completed: ["PASS", "border-accent text-accent"],
  blocked: ["BLOCKED", "border-warning text-warning"],
  failed: ["FAILED", "border-error text-error"],
  running: ["RUNNING", "border-accent text-accent"],
};

// One place for the pill class + tone lookup shared by the run list's
// freshness badge and the run panel's lifecycle/resolved/status badges.
export function badgeClass(value: string | undefined): string {
  const v = String(value || "").toLowerCase();
  return `${C.pill} ${TONE[v] || ""}`;
}
