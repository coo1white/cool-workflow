"use strict";
// shell/term.ts — zero-dependency terminal styling.
//
// MILESTONE 5 (project/docs/rebuild/PLAN.md build order, step 5, doctor/fix): TTY-gated
// ANSI formatting, so a piped run (every conformance case pipes with
// NO_COLOR=1) prints plain text. EXTENDED at MILESTONE 11 (reporting/
// observability) with the rest of the old build's term module: indent,
// sectionHeader, phaseProgressLine, stripAnsi, visibleWidth, truncate —
// byte-exact port of the old build's term module.
Object.defineProperty(exports, "__esModule", { value: true });
exports.bold = bold;
exports.dim = dim;
exports.green = green;
exports.yellow = yellow;
exports.red = red;
exports.doctorGlyph = doctorGlyph;
exports.tryHint = tryHint;
exports.nextHint = nextHint;
exports.indent = indent;
exports.sectionHeader = sectionHeader;
exports.phaseProgressLine = phaseProgressLine;
exports.stripAnsi = stripAnsi;
exports.visibleWidth = visibleWidth;
exports.truncate = truncate;
function isTTY(stream = process.stderr) {
    return Boolean(stream.isTTY);
}
function colorEnabled(stream, env = process.env) {
    if ((env.NO_COLOR ?? "") !== "" || (env.CW_NO_COLOR ?? "") !== "")
        return false;
    if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0")
        return true;
    // A terminal that says it cannot show escapes gets none.
    if (env.TERM === "dumb")
        return false;
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
function style(code, text, stream) {
    if (!colorEnabled(stream))
        return text;
    return `${code}${text}${ansi.reset}`;
}
function bold(text, stream) {
    return style(ansi.bold, text, stream);
}
function dim(text, stream) {
    return style(ansi.dim, text, stream);
}
function green(text, stream) {
    return style(ansi.green, text, stream);
}
function yellow(text, stream) {
    return style(ansi.yellow, text, stream);
}
function red(text, stream) {
    return style(ansi.red, text, stream);
}
/** Returns the styled glyph + label for a doctor check severity. */
function doctorGlyph(status, stream) {
    const glyph = { ok: "✓", warn: "!", fail: "✗" };
    const color = {
        ok: green,
        warn: yellow,
        fail: red,
    };
    return color[status](`${glyph[status]}`, stream);
}
/** A `Try: <cmd>` recovery hint (brew-style; the command stays plain to copy). */
function tryHint(cmd, stream) {
    return `${dim("Try:", stream)} ${cmd}`;
}
/** A `Next: <cmd>` hint line (the command stays plain so it is copy-pasteable). */
function nextHint(cmd, stream) {
    return `${dim("Next:", stream)} ${cmd}`;
}
/** Render a multi-line block with consistent 2-space indentation. */
function indent(text, spaces = 2) {
    const prefix = " ".repeat(spaces);
    return text
        .split("\n")
        .map((line) => `${prefix}${line}`)
        .join("\n");
}
/** A `==> Title` section header (brew-style). */
function sectionHeader(title, stream) {
    return `${bold("==>", stream)} ${title}`;
}
/** A phase-progress line: `==> Map ✓ (6/6)` / `==> Assess … (3/6)`. Parallel
 *  phases use ⇉, sequential use …; a finished phase uses a green ✓. */
function phaseProgressLine(name, done, total, mode, stream) {
    const complete = total > 0 && done >= total;
    const glyph = complete ? green("✓", stream) : mode === "parallel" ? "⇉" : "…";
    const count = total > 0 ? ` (${done}/${total})` : "";
    return `${sectionHeader(name, stream)} ${glyph}${count}`;
}
// ---- width-aware truncation (zero-dep) ----
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Strip ANSI SGR codes (for measuring visible width). */
function stripAnsi(text) {
    return text.replace(ANSI_RE, "");
}
/** Visible width of a string, ignoring ANSI. Counts each code point as
 *  width 1 — a known minor caveat for wide (CJK/emoji) glyphs, acceptable
 *  for one-line status truncation. */
function visibleWidth(text) {
    return [...stripAnsi(text)].length;
}
/** Truncate a (possibly styled) string to `maxWidth` visible columns,
 *  appending `…` when cut. Operates on the PLAIN text (callers truncate
 *  before styling), so no ANSI is split. */
function truncate(text, maxWidth) {
    if (maxWidth <= 0)
        return "";
    const chars = [...stripAnsi(text)];
    if (chars.length <= maxWidth)
        return text;
    if (maxWidth === 1)
        return "…";
    return `${chars.slice(0, maxWidth - 1).join("")}…`;
}
