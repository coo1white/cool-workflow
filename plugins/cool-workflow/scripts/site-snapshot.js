// site-snapshot — the Workbench and report.html as static files for GitHub
// Pages: `node scripts/site-snapshot.js <outDir>` (cwd plugins/cool-workflow).
// The two JSON routes the live host serves become files (api/index and
// api/run/<id>), built by the SAME core entries the host calls, over the
// runs under <repo>/.cw; the UI files are copied as they are (their paths
// are relative). report.html is the newest run's report. Nothing here is a
// new view: the site is one saved snapshot of what `cw workbench serve`
// shows, rebuilt on every push to main.
const fs = require("node:fs");
const path = require("node:path");
const { buildWorkbenchIndex, buildWorkbenchRunView } = require("../dist/shell/workbench.js");
const { reportToHtml } = require("../dist/core/format/report-html.js");

const out = path.resolve(process.argv[2] || "site");
const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const args = { cwd: repoRoot, scope: "repo" };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "api", "run"), { recursive: true });
fs.mkdirSync(path.join(out, "ui"), { recursive: true });
const ui = path.join(pluginRoot, "ui", "workbench");
fs.copyFileSync(path.join(ui, "index.html"), path.join(out, "index.html"));
for (const f of ["app.css", "app.js", "navigation.js", "inspection.js"]) fs.copyFileSync(path.join(ui, f), path.join(out, "ui", f));
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
