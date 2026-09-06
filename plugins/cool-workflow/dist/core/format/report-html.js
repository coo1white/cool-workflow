"use strict";
// core/format/report-html.ts — pure markdown -> HTML for report.md.
//
// `cw report --open` and the quickstart auto-open (shell/report-view-
// cli.ts, shell/pipeline-cli.ts) turn report.md into one small HTML page,
// readable in any browser with no path and no id typed. Pure, no disk,
// no network, no dependency. Handles ONLY the forms report.ts's writer
// emits — headings, bullet lists (with a two-space continuation line),
// the one "## Phase Status" table shape — plus fenced code, links, and
// bold, the two forms an embedded agent result file can add (report.ts's
// renderResults drops that file in as is). Never ordered lists.
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportToHtml = reportToHtml;
const report_css_1 = require("./report-css");
function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Bold and links, over already-escaped text (escaping never touches
 *  `*`, `[`, `]`, `(`, `)`, so this is safe to run second). */
function inline(text) {
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]\((\S+?)\)/g, '<a href="$2">$1</a>');
}
const isTableRule = (line) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());
const tableCells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
function renderTable(rows) {
    const [head, ...rest] = rows.filter((row) => !isTableRule(row)).map(tableCells);
    const th = (head || []).map((c) => `<th>${inline(c)}</th>`).join("");
    const trs = rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}
/** Turn one report.md's text into a full HTML page. Text is always
 *  escaped — nothing from the run or an agent's result is ever raw HTML. */
function reportToHtml(markdown, title = "Report") {
    const lines = markdown.split("\n");
    // The "- Verdict: WORD" line report.ts writes becomes the round stamp
    // by the title, not a bullet. No line, no stamp (older reports).
    const verdict = (markdown.match(/^- Verdict: (\S+)$/m) || [])[1];
    const body = [];
    let inCode = false;
    let listDepth = 0;
    const closeLists = () => {
        while (listDepth > 0) {
            body.push("</ul>");
            listDepth--;
        }
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith("```")) {
            body.push(inCode ? "</code></pre>" : "<pre><code>");
            inCode = !inCode;
            continue;
        }
        if (inCode) {
            body.push(escapeHtml(line));
            continue;
        }
        if (line.trim().startsWith("|")) {
            const table = [];
            while (i < lines.length && lines[i].trim().startsWith("|"))
                table.push(lines[i++]);
            i--;
            closeLists();
            body.push(renderTable(table));
            continue;
        }
        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
            closeLists();
            const level = heading[1].length;
            body.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            continue;
        }
        const bullet = line.match(/^(\s*)-\s+(.*)$/);
        if (bullet) {
            if (bullet[2].startsWith("Verdict: "))
                continue;
            const depth = bullet[1].length > 0 ? 2 : 1;
            while (listDepth < depth) {
                body.push("<ul>");
                listDepth++;
            }
            while (listDepth > depth) {
                body.push("</ul>");
                listDepth--;
            }
            body.push(`<li>${inline(bullet[2])}</li>`);
            continue;
        }
        if (!line.trim()) {
            closeLists();
            continue;
        }
        // A two-space continuation line folds into the previous bullet.
        const last = body[body.length - 1];
        if (listDepth > 0 && line.startsWith("  ") && last && last.endsWith("</li>")) {
            body[body.length - 1] = `${last.slice(0, -5)} ${inline(line.trim())}</li>`;
            continue;
        }
        closeLists();
        body.push(`<p>${inline(line)}</p>`);
    }
    closeLists();
    // Every class here is a Tailwind class; REPORT_CSS is the sheet built
    // from them (npm run build:css). Bare tags (h1, table, pre) are styled by
    // the typography plugin's prose class on the wrapper, so the test's tag
    // checks hold. The band is fixed brand text; no run text goes in it.
    const tones = { pass: "border-accent text-accent", warn: "border-warning text-warning", bad: "border-error text-error" };
    const toneName = { PASS: "pass", BLOCKED: "warn", FAILED: "bad" }[verdict || ""];
    const stamp = verdict
        ? `<div class="stamp ${toneName || "dim"} float-right mb-3 ml-4 flex h-28 w-28 -rotate-[8deg] flex-col items-center justify-center gap-0.5 rounded-full border-[3px] font-mono text-[8px] uppercase tracking-[.2em] [box-shadow:inset_0_0_0_5px_var(--color-base-100),inset_0_0_0_6px_currentColor] ${toneName ? tones[toneName] : "border-base-content/40 text-base-content/60"}"><span>verifier-gated</span><b class="text-[22px] font-extrabold tracking-[.06em]">${escapeHtml(verdict)}</b><span>.cw/runs</span></div>`
        : "";
    const band = '<div class="flex h-[52px] items-center justify-between gap-5 bg-neutral px-8 text-[12px] text-neutral-content">' +
        '<span class="flex items-center gap-2.5">' +
        '<span class="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md bg-primary text-primary-content">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 7h9"/><path d="M4 12h6"/><path d="M12 15l3 3 6-7"/></svg></span>' +
        '<span class="font-display font-extrabold tracking-[.12em]">COOL WORKFLOW</span><span class="text-base-content/60">report</span></span>' +
        '<span class="font-mono text-[11px] uppercase tracking-[.08em] text-base-content/60">static &middot; offline &middot; no network</span></div>';
    const prose = "prose dark:prose-invert mx-auto max-w-[820px] px-6 pb-14 pt-8 " +
        "prose-h1:text-[34px] prose-h1:font-extrabold prose-h1:tracking-[-.01em] " +
        "prose-h2:border-b prose-h2:border-base-300 prose-h2:pb-1.5 prose-h2:font-mono prose-h2:text-[11px] prose-h2:font-semibold prose-h2:uppercase prose-h2:tracking-[.1em] prose-h2:text-base-content/60 " +
        "prose-table:font-mono prose-table:text-[13px] prose-th:font-normal prose-th:uppercase prose-th:text-[11px] prose-th:tracking-[.06em] prose-th:text-base-content/60 [&_tbody_tr:nth-child(even)]:bg-base-200 " +
        "prose-pre:rounded-lg prose-pre:bg-base-200 prose-code:rounded prose-code:bg-base-300 prose-code:px-1 prose-code:before:content-none prose-code:after:content-none prose-a:text-primary";
    return (`<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#161b22"><title>${escapeHtml(title)}</title><style>${report_css_1.REPORT_CSS}</style></head>` +
        `<body class="bg-base-100 font-sans text-base-content">${band}<div class="${prose}">${stamp}${body.join("\n")}</div></body></html>`);
}
