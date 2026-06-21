// src/term.ts — zero-dependency terminal styling.
//
// Provides TTY-gated ANSI formatting for human-readable output. When output is
// piped (non-TTY), styled calls return plain text. This keeps data channels
// (stdout) and diagnostics (stderr) clean — never adds escape codes to pipes.
//
// Used by: doctor, help, error messages, status summaries.

/** The three severity levels used by cw doctor and other diagnostics. */
export type TermSeverity = "ok" | "warn" | "fail";

function isTTY(stream: NodeJS.WriteStream = process.stderr): boolean {
  return Boolean(stream.isTTY);
}

// ---- ansi codes ----

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

// ---- styled text ----

function style(code: string, text: string, stream?: NodeJS.WriteStream): string {
  if (!isTTY(stream)) return text;
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

export function cyan(text: string, stream?: NodeJS.WriteStream): string {
  return style(ansi.cyan, text, stream);
}

// ---- semantic helpers ----

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

/** "cw:" prefix with bold and optional color. */
export function cwLabel(stream?: NodeJS.WriteStream): string {
  return bold("cw:", stream);
}

/** Render a multi-line block with consistent 2-space indentation. */
export function indent(text: string, spaces = 2): string {
  const prefix = " ".repeat(spaces);
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

/** A `Next: <cmd>` hint line (the command stays plain so it is copy-pasteable). */
export function nextHint(cmd: string, stream?: NodeJS.WriteStream): string {
  return `${dim("Next:", stream)} ${cmd}`;
}

/** A `Try: <cmd>` recovery hint (brew-style; the command stays plain to copy). */
export function tryHint(cmd: string, stream?: NodeJS.WriteStream): string {
  return `${dim("Try:", stream)} ${cmd}`;
}

/** A `==> Title` section header (brew-style). */
export function sectionHeader(title: string, stream?: NodeJS.WriteStream): string {
  return `${bold("==>", stream)} ${title}`;
}

/** A phase-progress line: `==> Map ✓ (6/6)` / `==> Assess … (3/6)`. Parallel phases
 *  use ⇉, sequential use …; a finished phase uses a green ✓. */
export function phaseProgressLine(name: string, done: number, total: number, mode?: string, stream?: NodeJS.WriteStream): string {
  const complete = total > 0 && done >= total;
  const glyph = complete ? green("✓", stream) : (mode === "parallel" ? "⇉" : "…");
  const count = total > 0 ? ` (${done}/${total})` : "";
  return `${sectionHeader(name, stream)} ${glyph}${count}`;
}

/** Format a DURATION in ms as `850ms` / `5.2s` / `1m02s`. Pure (no clock) — the
 *  caller measures elapsed via process.hrtime, so this never reads wall-clock time. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m${String(rem).padStart(2, "0")}s`;
}

/** Print a success summary to stderr (TTY-gated). Shows the report path, a one-line
 *  status (with N/N worker counts when known), and a copy-pasteable next/recovery
 *  command. Pipe-friendly: silent when stderr is not a TTY, so it never pollutes
 *  piped/`--json` stdout. A non-complete run with no agent configured gets a brew-style
 *  `Try: cw doctor` recovery line; otherwise `Next: cw status <id>` to inspect. */
export function printSuccessSummary(
  fields: {
    runId: string;
    reportPath: string;
    status: string;
    bundle?: boolean;
    completedWorkers?: number;
    plannedWorkers?: number;
    agentConfigured?: boolean;
  },
  stream?: NodeJS.WriteStream
): void {
  if (!isTTY(stream)) return;
  const s = stream || process.stderr;
  const counts = (typeof fields.completedWorkers === "number" && typeof fields.plannedWorkers === "number")
    ? ` — ${fields.completedWorkers}/${fields.plannedWorkers}` : "";
  s.write(`\n${green("✓", s)} Report: ${fields.reportPath}\n`);
  if (fields.status === "complete") {
    s.write(`  ${green("✓", s)} Status: complete${counts}\n`);
    s.write(`  ${nextHint(`cw report ${fields.runId} --show`, s)}\n`);
  } else {
    s.write(`  ${yellow("!", s)} Status: ${fields.status}${counts}\n`);
    // No agent backend is the #1 first-run blocker — point at the one command that
    // diagnoses and prints the fix, brew-style. Otherwise inspect the run's state.
    if (fields.agentConfigured === false) s.write(`  ${tryHint("cw doctor", s)}\n`);
    else s.write(`  ${nextHint(`cw status ${fields.runId}`, s)}\n`);
  }
}
