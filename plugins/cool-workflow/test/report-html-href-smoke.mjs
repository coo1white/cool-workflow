#!/usr/bin/env node
// report-html-href-smoke — report.html never turns a link target taken
// from run data into a live javascript:/data:/vbscript: (or any other
// non-http) href. The real path: an agent's result file holds
// `[x](javascript:...)`, report.ts's renderResults drops that file into
// report.md as is, and `cw report --open` (ensureAndOpenReportHtml) turns
// report.md into report.html. Safe links stay byte-identical (POLA).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
import { reportToHtml } from "../dist/core/format/report-html.js";
import { ensureAndOpenReportHtml } from "../dist/shell/report-view-cli.js";
import { quickstartRun } from "../dist/shell/pipeline-cli.js";

const UNSAFE = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "java\u0001script:alert(1)",
];
const SAFE = ["http://e.co/p", "https://e.co/p?q=1#f", "mailto:a@e.co", "docs/a.md", "./b.md#L3", "#top", "/abs/path"];

async function main() {
  // 1. converter: unsafe targets are plain text, never an <a href>.
  for (const href of UNSAFE) {
    const html = reportToHtml(`# T\n\n- see [x](${href})\n`);
    assert.ok(!/<a\s/i.test(html.split("<body")[1] || html), `no link for ${JSON.stringify(href)}`);
    assert.ok(html.includes("[x]("), `label and target stay as text for ${JSON.stringify(href)}`);
    assert.ok(!html.includes("<script>"), "text stays escaped");
  }
  // 2. safe targets: byte-identical to the old renderer's output.
  for (const href of SAFE) {
    const html = reportToHtml(`# T\n\n- see [x](${href})\n`);
    const escaped = href.replace(/&/g, "&amp;");
    assert.ok(html.includes(`<li>see <a href="${escaped}">x</a></li>`), `link kept for ${href}`);
  }

  // 3. the real path: agent result file -> report.md -> report.html.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-report-href-")));
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  const stub = path.join(dir, "s.js");
  fs.writeFileSync(
    stub,
    'const fs=require("fs");fs.writeFileSync(process.argv[2],"# R\\n\\n- click [here](javascript:alert(document.domain))\\n- ok [site](https://e.co/x)\\n\\n```cw:result\\n"+JSON.stringify({summary:"s",findings:[],evidence:[process.cwd()+"/README.md:1"]})+"\\n```\\n");process.stdout.write("{}");',
    "utf8"
  );
  const run = await quickstartRun({ appId: "architecture-review-fast", repo: dir, question: "risks?", agentCommand: `${process.execPath} ${stub} {{result}}` });
  const md = fs.readFileSync(run.reportPath, "utf8");
  assert.ok(md.includes("[here](javascript:alert(document.domain))"), "agent text reaches report.md as is");
  const opener = path.join(dir, "opener.js");
  fs.writeFileSync(opener, "#!/usr/bin/env node\n", "utf8");
  fs.chmodSync(opener, 0o755);
  process.env.CW_OPENER = opener;
  let htmlPath;
  try {
    htmlPath = ensureAndOpenReportHtml(run.reportPath);
  } finally {
    delete process.env.CW_OPENER;
  }
  const page = fs.readFileSync(htmlPath, "utf8");
  assert.ok(!/href="\s*javascript:/i.test(page), "report.html carries no javascript: href");
  assert.ok(page.includes("[here](javascript:alert(document.domain))"), "the unsafe link shows as plain text");
  assert.ok(page.includes('<a href="https://e.co/x">site</a>'), "the safe link is still a link");

  process.stdout.write("report-html-href-smoke: ok\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
