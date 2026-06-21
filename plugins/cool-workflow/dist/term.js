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
exports.nextHint = nextHint;
exports.tryHint = tryHint;
exports.sectionHeader = sectionHeader;
exports.phaseProgressLine = phaseProgressLine;
exports.formatDuration = formatDuration;
exports.printSuccessSummary = printSuccessSummary;
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
/** A `Next: <cmd>` hint line (the command stays plain so it is copy-pasteable). */
function nextHint(cmd, stream) {
    return `${dim("Next:", stream)} ${cmd}`;
}
/** A `Try: <cmd>` recovery hint (brew-style; the command stays plain to copy). */
function tryHint(cmd, stream) {
    return `${dim("Try:", stream)} ${cmd}`;
}
/** A `==> Title` section header (brew-style). */
function sectionHeader(title, stream) {
    return `${bold("==>", stream)} ${title}`;
}
/** A phase-progress line: `==> Map ✓ (6/6)` / `==> Assess … (3/6)`. Parallel phases
 *  use ⇉, sequential use …; a finished phase uses a green ✓. */
function phaseProgressLine(name, done, total, mode, stream) {
    const complete = total > 0 && done >= total;
    const glyph = complete ? green("✓", stream) : (mode === "parallel" ? "⇉" : "…");
    const count = total > 0 ? ` (${done}/${total})` : "";
    return `${sectionHeader(name, stream)} ${glyph}${count}`;
}
/** Format a DURATION in ms as `850ms` / `5.2s` / `1m02s`. Pure (no clock) — the
 *  caller measures elapsed via process.hrtime, so this never reads wall-clock time. */
function formatDuration(ms) {
    if (ms < 1000)
        return `${Math.max(0, Math.round(ms))}ms`;
    const s = Math.round(ms / 100) / 10;
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return `${m}m${String(rem).padStart(2, "0")}s`;
}
/** Print a success summary to stderr (TTY-gated). Shows the report path, a one-line
 *  status (with N/N worker counts when known), and a copy-pasteable next/recovery
 *  command. Pipe-friendly: silent when stderr is not a TTY, so it never pollutes
 *  piped/`--json` stdout. A non-complete run with no agent configured gets a brew-style
 *  `Try: cw doctor` recovery line; otherwise `Next: cw status <id>` to inspect. */
function printSuccessSummary(fields, stream) {
    if (!isTTY(stream))
        return;
    const s = stream || process.stderr;
    const counts = (typeof fields.completedWorkers === "number" && typeof fields.plannedWorkers === "number")
        ? ` — ${fields.completedWorkers}/${fields.plannedWorkers}` : "";
    s.write(`\n${green("✓", s)} Report: ${fields.reportPath}\n`);
    if (fields.status === "complete") {
        s.write(`  ${green("✓", s)} Status: complete${counts}\n`);
        s.write(`  ${nextHint(`cw report ${fields.runId} --show`, s)}\n`);
    }
    else {
        s.write(`  ${yellow("!", s)} Status: ${fields.status}${counts}\n`);
        // No agent backend is the #1 first-run blocker — point at the one command that
        // diagnoses and prints the fix, brew-style. Otherwise inspect the run's state.
        if (fields.agentConfigured === false)
            s.write(`  ${tryHint("cw doctor", s)}\n`);
        else
            s.write(`  ${nextHint(`cw status ${fields.runId}`, s)}\n`);
    }
}
