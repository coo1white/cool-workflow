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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Bold and links, over already-escaped text (escaping never touches
 *  `*`, `[`, `]`, `(`, `)`, so this is safe to run second). */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((\S+?)\)/g, '<a href="$2">$1</a>');
}

const isTableRule = (line: string): boolean => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());
const tableCells = (line: string): string[] => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function renderTable(rows: string[]): string {
  const [head, ...rest] = rows.filter((row) => !isTableRule(row)).map(tableCells);
  const th = (head || []).map((c) => `<th>${inline(c)}</th>`).join("");
  const trs = rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** Turn one report.md's text into a full HTML page. Text is always
 *  escaped — nothing from the run or an agent's result is ever raw HTML. */
export function reportToHtml(markdown: string, title = "Report"): string {
  const lines = markdown.split("\n");
  // The "- Verdict: WORD" line report.ts writes becomes the round stamp
  // by the title, not a bullet. No line, no stamp (older reports).
  const verdict = (markdown.match(/^- Verdict: (\S+)$/m) || [])[1];
  const body: string[] = [];
  let inCode = false;
  let listDepth = 0;
  const closeLists = (): void => {
    while (listDepth > 0) { body.push("</ul>"); listDepth--; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      body.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { body.push(escapeHtml(line)); continue; }
    if (line.trim().startsWith("|")) {
      const table: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) table.push(lines[i++]);
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
      if (bullet[2].startsWith("Verdict: ")) continue;
      const depth = bullet[1].length > 0 ? 2 : 1;
      while (listDepth < depth) { body.push("<ul>"); listDepth++; }
      while (listDepth > depth) { body.push("</ul>"); listDepth--; }
      body.push(`<li>${inline(bullet[2])}</li>`);
      continue;
    }
    if (!line.trim()) { closeLists(); continue; }
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
  // Light token set from the workbench-face spec (2026-09-06); the band
  // below is fixed dark brand colour, never the page's light theme.
  const style =
    'body{margin:0;background:#f7f4ee;color:#1e1b17;font:15px/1.55 -apple-system,system-ui,"Segoe UI",sans-serif}' +
    "a{color:#c9540f}h1{font-size:34px;font-weight:800;letter-spacing:-.01em}" +
    'h2{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#7a7368;padding-bottom:6px;border-bottom:1px solid #e2dcd0}' +
    'table{width:100%;border-collapse:collapse;font:13px/1.5 ui-monospace,"SF Mono",Menlo,monospace}' +
    "th{text-align:left;font-weight:400;color:#7a7368;padding:6px 10px;border-bottom:1px solid #e2dcd0;font-size:11px;letter-spacing:.06em;text-transform:uppercase}" +
    "td{padding:6px 10px;border-bottom:1px solid #ece7dc}tbody tr:nth-child(even){background:#efeae0}" +
    'pre{background:#14120f;color:#f2ede4;padding:12px 14px;border-radius:8px;overflow:auto;font:13px/1.5 ui-monospace,"SF Mono",Menlo,monospace}' +
    'code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:13px;background:#efeae0;border-radius:4px;padding:1px 5px}pre code{background:none;padding:0}' +
    '.stamp{float:right;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:112px;height:112px;margin:0 0 12px 16px;border-radius:50%;border:3px solid #7a7368;color:#7a7368;box-shadow:inset 0 0 0 5px #f7f4ee,inset 0 0 0 6px currentColor;transform:rotate(-8deg);font:8px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.2em;text-transform:uppercase}' +
    ".stamp b{font-size:22px;font-weight:800;letter-spacing:.06em}.stamp.pass{border-color:#ef6c1f;color:#ef6c1f}.stamp.warn{border-color:#9a6700;color:#9a6700}.stamp.bad{border-color:#c8321f;color:#c8321f}";
  const tone = { PASS: "pass", BLOCKED: "warn", FAILED: "bad" }[verdict || ""] || "";
  const stamp = verdict ? `<div class="stamp ${tone}"><span>verifier-gated</span><b>${escapeHtml(verdict)}</b><span>.cw/runs</span></div>` : "";
  // Fixed brand band, same on every report; no run text ever goes in it.
  const band =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;height:52px;padding:0 32px;background:#14120f;color:#f2ede4;font-size:12px">' +
    '<span style="display:flex;align-items:center;gap:10px">' +
    '<span style="display:inline-flex;width:22px;height:22px;border-radius:6px;background:#ef6c1f;align-items:center;justify-content:center">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#14120f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 7h9"/><path d="M4 12h6"/><path d="M12 15l3 3 6-7"/></svg></span>' +
    '<span style="font-weight:800;letter-spacing:.12em">COOL WORKFLOW</span><span style="color:#9a938a">report</span></span>' +
    '<span style="font-family:ui-monospace,\'SF Mono\',Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9a938a">static &middot; offline &middot; no network</span></div>';
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${style}</style></head>` +
    `<body>${band}<div style="max-width:820px;margin:0 auto;padding:32px 24px 56px">${stamp}${body.join("\n")}</div></body></html>`
  );
}
