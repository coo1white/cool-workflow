// site-snapshot — report.html as a static file for GitHub Pages:
// `node scripts/site-snapshot.mjs <outDir> [<repoRoot>]` (cwd
// plugins/cool-workflow). The newest run under <repoRoot>/.cw/runs/ (the
// same run `cw report` picks) has its report.md turned into report.html,
// written both as index.html and as report.html. Nothing here is a new
// view: the site is one saved copy of the report a run already wrote,
// rebuilt on every push to main. No run, or a run with no report.md, is a
// refusal (exit 1), not an empty site.
import fs from "node:fs";
import path from "node:path";
import { resolveReportRunId } from "../dist/shell/commands/report-view-cli.js";
import { reportToHtml } from "../dist/core/format/report-html.js";

const out = path.resolve(process.argv[2] || "site");
const pluginRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(process.argv[3] || path.resolve(pluginRoot, "..", ".."));

const runId = resolveReportRunId(undefined, { cwd: repoRoot });
const md = runId ? path.join(repoRoot, ".cw", "runs", runId, "report.md") : undefined;
if (!md || !fs.existsSync(md)) {
  process.stderr.write(`site-snapshot: no run with a report.md under ${path.join(repoRoot, ".cw", "runs")}\n`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, ".nojekyll"), "");
const html = reportToHtml(fs.readFileSync(md, "utf8"), "Report");
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(path.join(out, "report.html"), html);
process.stdout.write(`site-snapshot: report ${runId} -> ${out}\n`);
