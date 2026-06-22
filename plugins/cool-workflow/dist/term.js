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
exports.indent = indent;
exports.nextHint = nextHint;
exports.tryHint = tryHint;
exports.sectionHeader = sectionHeader;
exports.phaseProgressLine = phaseProgressLine;
exports.printSuccessSummary = printSuccessSummary;
exports.stripAnsi = stripAnsi;
exports.visibleWidth = visibleWidth;
exports.truncate = truncate;
exports.formatFindingsSummary = formatFindingsSummary;
function isTTY(stream = process.stderr) {
    return Boolean(stream.isTTY);
}
/** Whether to emit ANSI color on a stream, honoring the de-facto env standards:
 *  NO_COLOR / CW_NO_COLOR (any non-empty value) disable; FORCE_COLOR (non-"0") forces on
 *  even when piped; otherwise fall back to isTTY. The `--no-color` flag sets CW_NO_COLOR. */
function colorEnabled(stream, env = process.env) {
    if ((env.NO_COLOR ?? "") !== "" || (env.CW_NO_COLOR ?? "") !== "")
        return false;
    if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0")
        return true;
    return isTTY(stream);
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
// ---- width-aware truncation (zero-dep) ----
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Strip ANSI SGR codes (for measuring visible width). */
function stripAnsi(text) {
    return text.replace(ANSI_RE, "");
}
/** Visible width of a string, ignoring ANSI. Counts each code point as width 1 — a known
 *  minor caveat for wide (CJK/emoji) glyphs, acceptable for one-line status truncation. */
function visibleWidth(text) {
    return [...stripAnsi(text)].length;
}
/** Truncate a (possibly styled) string to `maxWidth` visible columns, appending `…` when cut.
 *  Operates on the PLAIN text (callers truncate before styling), so no ANSI is split. */
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
// ---- findings summary table (end-of-run, compact) ----
/** Severity order for sorting + counting (most severe first). */
const SEVERITY_ORDER = ["P0", "P1", "P2", "P3", "none"];
/** Render a compact findings summary assembled from the run's `cw:result` blocks: a one-line
 *  count headline (e.g. `Findings: 3 — 2×P1, 1×P2`) plus a small id/severity/class table. This
 *  is the end-of-run summary — NOT the full prose (that stays in report.md + the transcript).
 *  Returns "" when there are no findings (caller prints nothing). */
function formatFindingsSummary(findings, stream) {
    if (!findings.length)
        return "";
    const bySev = new Map();
    for (const f of findings)
        bySev.set(f.severity || "none", (bySev.get(f.severity || "none") || 0) + 1);
    const order = (s) => {
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
    const lines = [
        `${bold("Findings:", stream)} ${findings.length} — ${counts}`,
        dim(`  ${"SEVERITY".padEnd(sevW)}  ${"CLASS".padEnd(clsW)}  ID`, stream)
    ];
    for (const r of rows) {
        const sev = (r.severity || "none").padEnd(sevW);
        const cls = (r.classification || "unknown").padEnd(clsW);
        lines.push(`  ${sev}  ${cls}  ${truncate(r.id || "(unnamed)", 60)}`);
    }
    return lines.join("\n");
}
