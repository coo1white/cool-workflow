// shell/term.ts — zero-dependency terminal styling.
//
// MILESTONE 5 (project/docs/rebuild/PLAN.md build order, step 5, doctor/fix): TTY-gated
// ANSI formatting, so a piped run (every conformance case pipes with
// NO_COLOR=1) prints plain text. EXTENDED at MILESTONE 11 (reporting/
// observability) with the rest of the old build's term module: indent,
// sectionHeader, phaseProgressLine, printSuccessSummary, stripAnsi,
// visibleWidth, truncate, formatFindingsSummary, FindingRow — byte-exact
// port of the old build's term module.

export type TermSeverity = "ok" | "warn" | "fail";

function isTTY(stream: NodeJS.WriteStream = process.stderr): boolean {
  return Boolean(stream.isTTY);
}

function colorEnabled(stream?: NodeJS.WriteStream, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.NO_COLOR ?? "") !== "" || (env.CW_NO_COLOR ?? "") !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  return isTTY(stream);
}

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function style(code: string, text: string, stream?: NodeJS.WriteStream): string {
  if (!colorEnabled(stream)) return text;
  return `${code}${text}${ansi.reset}`;
}

export function bold(text: string, stream?: NodeJS.WriteStream): string {
  return style(ansi.bold, text, stream);
}

export function dim(text: string, stream?: NodeJS.WriteStream): string {
  return style(ansi.dim, text, stream);
}

export function green(text: string, stream?: NodeJS.WriteStream): string {
  return style(ansi.green, text, stream);
}

export function yellow(text: string, stream?: NodeJS.WriteStream): string {
  return style(ansi.yellow, text, stream);
}

export function red(text: string, stream?: NodeJS.WriteStream): string {
  return style(ansi.red, text, stream);
}

/** Returns the styled glyph + label for a doctor check severity. */
export function doctorGlyph(status: TermSeverity, stream?: NodeJS.WriteStream): string {
  const glyph: Record<TermSeverity, string> = { ok: "✓", warn: "!", fail: "✗" };
  const color: Record<TermSeverity, (t: string, s?: NodeJS.WriteStream) => string> = {
    ok: green,
    warn: yellow,
    fail: red,
  };
  return color[status](`${glyph[status]}`, stream);
}

/** A `Try: <cmd>` recovery hint (brew-style; the command stays plain to copy). */
export function tryHint(cmd: string, stream?: NodeJS.WriteStream): string {
  return `${dim("Try:", stream)} ${cmd}`;
}

/** A `Next: <cmd>` hint line (the command stays plain so it is copy-pasteable). */
export function nextHint(cmd: string, stream?: NodeJS.WriteStream): string {
  return `${dim("Next:", stream)} ${cmd}`;
}

/** Render a multi-line block with consistent 2-space indentation. */
export function indent(text: string, spaces = 2): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** A `==> Title` section header (brew-style). */
export function sectionHeader(title: string, stream?: NodeJS.WriteStream): string {
  return `${bold("==>", stream)} ${title}`;
}

/** A phase-progress line: `==> Map ✓ (6/6)` / `==> Assess … (3/6)`. Parallel
 *  phases use ⇉, sequential use …; a finished phase uses a green ✓. */
export function phaseProgressLine(name: string, done: number, total: number, mode?: string, stream?: NodeJS.WriteStream): string {
  const complete = total > 0 && done >= total;
  const glyph = complete ? green("✓", stream) : mode === "parallel" ? "⇉" : "…";
  const count = total > 0 ? ` (${done}/${total})` : "";
  return `${sectionHeader(name, stream)} ${glyph}${count}`;
}

/** Print a success summary to stderr (TTY-gated). Silent when stderr is
 *  not a TTY, so it never pollutes piped/`--json` stdout. */
export function printSuccessSummary(
  fields: { runId: string; reportPath: string; status: string; bundle?: boolean; completedWorkers?: number; plannedWorkers?: number; agentConfigured?: boolean },
  stream?: NodeJS.WriteStream
): void {
  if (!isTTY(stream)) return;
  const s = stream || process.stderr;
  const counts = typeof fields.completedWorkers === "number" && typeof fields.plannedWorkers === "number" ? ` — ${fields.completedWorkers}/${fields.plannedWorkers}` : "";
  s.write(`\n${green("✓", s)} Report: ${fields.reportPath}\n`);
  if (fields.status === "complete") {
    s.write(`  ${green("✓", s)} Status: complete${counts}\n`);
    s.write(`  ${nextHint(`cw report ${fields.runId} --show`, s)}\n`);
  } else {
    s.write(`  ${yellow("!", s)} Status: ${fields.status}${counts}\n`);
    if (fields.agentConfigured === false) s.write(`  ${tryHint("cw doctor", s)}\n`);
    else s.write(`  ${nextHint(`cw status ${fields.runId}`, s)}\n`);
  }
}

// ---- width-aware truncation (zero-dep) ----

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI SGR codes (for measuring visible width). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Visible width of a string, ignoring ANSI. Counts each code point as
 *  width 1 — a known minor caveat for wide (CJK/emoji) glyphs, acceptable
 *  for one-line status truncation. */
export function visibleWidth(text: string): number {
  return [...stripAnsi(text)].length;
}

/** Truncate a (possibly styled) string to `maxWidth` visible columns,
 *  appending `…` when cut. Operates on the PLAIN text (callers truncate
 *  before styling), so no ANSI is split. */
export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const chars = [...stripAnsi(text)];
  if (chars.length <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  return `${chars.slice(0, maxWidth - 1).join("")}…`;
}

// ---- findings summary table (end-of-run, compact) ----

const SEVERITY_ORDER = ["P0", "P1", "P2", "P3", "none"];

export interface FindingRow {
  id: string;
  severity: string;
  classification: string;
}

/** Render a compact findings summary assembled from the run's `cw:result`
 *  blocks: a one-line count headline plus a small id/severity/class
 *  table. Returns "" when there are no findings. */
export function formatFindingsSummary(findings: FindingRow[], stream?: NodeJS.WriteStream): string {
  if (!findings.length) return "";
  const bySev = new Map<string, number>();
  for (const f of findings) bySev.set(f.severity || "none", (bySev.get(f.severity || "none") || 0) + 1);
  const order = (s: string): number => {
    const i = SEVERITY_ORDER.indexOf(s);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  const counts = [...bySev.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([sev, n]) => `${n}×${sev}`)
    .join(", ");
  const rows = [...findings].sort((a, b) => order(a.severity) - order(b.severity));
  const sevW = Math.max(8, ...rows.map((r) => (r.severity || "none").length));
  const clsW = Math.max(5, ...rows.map((r) => (r.classification || "unknown").length));
  const lines = [`${bold("Findings:", stream)} ${findings.length} — ${counts}`, dim(`  ${"SEVERITY".padEnd(sevW)}  ${"CLASS".padEnd(clsW)}  ID`, stream)];
  for (const r of rows) {
    const sev = (r.severity || "none").padEnd(sevW);
    const cls = (r.classification || "unknown").padEnd(clsW);
    lines.push(`  ${sev}  ${cls}  ${truncate(r.id || "(unnamed)", 60)}`);
  }
  return lines.join("\n");
}
