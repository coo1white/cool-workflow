// shell/term.ts — terminal styling, TTY-gated so a piped run prints plain text.
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
export function bold(text, stream) {
    return style(ansi.bold, text, stream);
}
export function dim(text, stream) {
    return style(ansi.dim, text, stream);
}
export function green(text, stream) {
    return style(ansi.green, text, stream);
}
export function yellow(text, stream) {
    return style(ansi.yellow, text, stream);
}
export function red(text, stream) {
    return style(ansi.red, text, stream);
}
/** The styled ✓ / ! / ✗ for a check. */
export function checkGlyph(status, stream) {
    const glyph = { ok: "✓", warn: "!", fail: "✗" };
    const color = {
        ok: green,
        warn: yellow,
        fail: red,
    };
    return color[status](`${glyph[status]}`, stream);
}
/** A `Try: <cmd>` recovery hint (brew-style; the command stays plain to copy). */
export function tryHint(cmd, stream) {
    return `${dim("Try:", stream)} ${cmd}`;
}
/** A `Next: <cmd>` hint line (the command stays plain so it is copy-pasteable). */
export function nextHint(cmd, stream) {
    return `${dim("Next:", stream)} ${cmd}`;
}
/** Render a multi-line block with consistent 2-space indentation. */
export function indent(text, spaces = 2) {
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
/** A phase-progress line: `==> Map ✓ (6/6)` / `==> Assess » (3/6)`. One
 *  mark, », for a phase not yet done; a finished phase uses a green ✓. */
export function phaseProgressLine(name, done, total, stream) {
    const complete = total > 0 && done >= total;
    const glyph = complete ? green("✓", stream) : "»";
    const count = total > 0 ? ` (${done}/${total})` : "";
    return `${sectionHeader(name, stream)} ${glyph}${count}`;
}
// ---- width-aware truncation (zero-dep) ----
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Strip ANSI SGR codes (for measuring visible width). */
export function stripAnsi(text) {
    return text.replace(ANSI_RE, "");
}
/** Visible width, ignoring ANSI; one column per code point. */
export function visibleWidth(text) {
    return [...stripAnsi(text)].length;
}
/** Cut plain text to `maxWidth` columns, ending in `…`. Style after. */
export function truncate(text, maxWidth) {
    if (maxWidth <= 0)
        return "";
    const chars = [...stripAnsi(text)];
    if (chars.length <= maxWidth)
        return text;
    if (maxWidth === 1)
        return "…";
    return `${chars.slice(0, maxWidth - 1).join("")}…`;
}
