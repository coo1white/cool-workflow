// site-snapshot — the Workbench and report.html as static files for GitHub
// Pages: `node scripts/site-snapshot.mjs <outDir>` (cwd plugins/cool-workflow).
// The Workbench is a Next static export at ui/workbench/out/ (built by
// `node scripts/build-ui.mjs`, basePath "/ui"). Its own index.html goes to
// the site root; the whole out/ tree also goes under ui/, so the export's
// own "/ui/_next/..." and "/ui/icon.svg" URLs resolve. The two JSON routes
// the live host serves become files (api/index and api/run/<id>), built by
// the SAME core entries the host calls, over the runs under <repo>/.cw; the
// page fetches api/index with a path relative to "/", so those files stay
// where they are. report.html is the newest run's report. Nothing here is
// a new view: the site is one saved snapshot of what `cw workbench serve`
// shows, rebuilt on every push to main.
import fs from "node:fs";
import path from "node:path";
import { buildWorkbenchIndex, buildWorkbenchRunView } from "../dist/shell/workbench.js";
import { reportToHtml } from "../dist/core/format/report-html.js";

const out = path.resolve(process.argv[2] || "site");
const pluginRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const args = { cwd: repoRoot, scope: "repo" };

const nextOut = path.join(pluginRoot, "ui", "workbench", "out");
if (!fs.existsSync(path.join(nextOut, "index.html"))) {
  process.stderr.write("site-snapshot: ui/workbench/out/index.html is missing. Run: node scripts/build-ui.mjs\n");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "api", "run"), { recursive: true });
fs.cpSync(nextOut, path.join(out, "ui"), { recursive: true });
fs.copyFileSync(path.join(nextOut, "index.html"), path.join(out, "index.html"));
fs.writeFileSync(path.join(out, ".nojekyll"), "");

const index = buildWorkbenchIndex(args);
fs.writeFileSync(path.join(out, "api", "index"), JSON.stringify(index));
const records = (index.runs && index.runs.records) || [];
for (const r of records) {
  fs.writeFileSync(path.join(out, "api", "run", r.runId), JSON.stringify(buildWorkbenchRunView(r.runId, args)));
}
const newest = records[records.length - 1];
if (newest) {
  const md = path.join(repoRoot, ".cw", "runs", newest.runId, "report.md");
  if (fs.existsSync(md)) fs.writeFileSync(path.join(out, "report.html"), reportToHtml(fs.readFileSync(md, "utf8"), "Report"));
}
process.stdout.write(`site-snapshot: ${records.length} run(s), report ${newest ? newest.runId : "none"} -> ${out}\n`);
