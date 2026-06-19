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

/** Print a success summary to stderr (TTY-gated). Shows the report path and a
 *  suggested next command. Pipe-friendly: silent when stderr is not a TTY. */
export function printSuccessSummary(fields: { runId: string; reportPath: string; status: string; bundle?: boolean }, stream?: NodeJS.WriteStream): void {
  if (!isTTY(stream)) return;
  const s = stream || process.stderr;
  s.write(`\n${green("✓")} Report: ${fields.reportPath}\n`);
  if (fields.status === "complete") {
    s.write(`  Next: cw status ${fields.runId} --brief\n`);
    if (fields.bundle !== false) {
      s.write(`  Bundle: cw report bundle ${fields.runId}\n`);
    }
  } else {
    s.write(`  ${yellow("!")} Status: ${fields.status}. Next: cw status ${fields.runId}\n`);
  }
}
