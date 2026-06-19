"use strict";
// src/term.ts — zero-dependency terminal styling.
//
// Provides TTY-gated ANSI formatting for human-readable output. When output is
// piped (non-TTY), styled calls return plain text. This keeps data channels
// (stdout) and diagnostics (stderr) clean — never adds escape codes to pipes.
//
// Used by: doctor, help, error messages, status summaries.
Object.defineProperty(exports, "__esModule", { value: true });
exports.bold = bold;
exports.dim = dim;
exports.green = green;
exports.yellow = yellow;
exports.red = red;
exports.cyan = cyan;
exports.doctorGlyph = doctorGlyph;
exports.cwLabel = cwLabel;
exports.indent = indent;
function isTTY(stream = process.stderr) {
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
function style(code, text, stream) {
    if (!isTTY(stream))
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
function cyan(text, stream) {
    return style(ansi.cyan, text, stream);
}
// ---- semantic helpers ----
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
/** "cw:" prefix with bold and optional color. */
function cwLabel(stream) {
    return bold("cw:", stream);
}
/** Render a multi-line block with consistent 2-space indentation. */
function indent(text, spaces = 2) {
    const prefix = " ".repeat(spaces);
    return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}
