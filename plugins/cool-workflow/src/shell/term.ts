// shell/term.ts — zero-dependency terminal styling.
//
// MILESTONE 5 (project/docs/rebuild/PLAN.md build order, step 5, doctor/fix): TTY-gated
// ANSI formatting, so a piped run (every conformance case pipes with
// NO_COLOR=1) prints plain text. EXTENDED at MILESTONE 11 (reporting/
// observability) with the rest of the old build's term module: indent,
// sectionHeader, phaseProgressLine, stripAnsi, visibleWidth, truncate —
// byte-exact port of the old build's term module.

export type TermSeverity = "ok" | "warn" | "fail";

function isTTY(stream: NodeJS.WriteStream = process.stderr): boolean {
  return Boolean(stream.isTTY);
}

function colorEnabled(stream?: NodeJS.WriteStream, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.NO_COLOR ?? "") !== "" || (env.CW_NO_COLOR ?? "") !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  // A terminal that says it cannot show escapes gets none.
  if (env.TERM === "dumb") return false;
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
