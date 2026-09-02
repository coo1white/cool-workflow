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
  const style =
    "body{font:15px/1.5 -apple-system,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}" +
    "table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.3rem .6rem;text-align:left}" +
    "pre{background:#f4f4f4;padding:.6rem;overflow:auto}code{font-family:ui-monospace,monospace}";
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${style}</style></head>` +
    `<body>${body.join("\n")}</body></html>`
  );
}
