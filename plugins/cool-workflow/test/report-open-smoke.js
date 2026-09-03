#!/usr/bin/env node
// report-open-smoke — "open the report in one step": the md->HTML
// converter, `cw report` finding the newest run (and its one line with
// no run at all), `cw report --open`, and quickstart's own auto-open —
// TTY-gated, off by default on a pipe (the safety rail).
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist/cli.js");
const { reportToHtml } = require(path.join(root, "dist/core/format/report-html.js"));
const { resolveReportRunId, ensureAndOpenReportHtml } = require(path.join(root, "dist/shell/report-view-cli.js"));
const { quickstartRun, formatQuickstartHuman } = require(path.join(root, "dist/shell/pipeline-cli.js"));

const tmpDir = (label) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cw-report-open-${label}-`)));
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  return dir;
};
const openerStub = (dir, logFile) => {
  const script = path.join(dir, "opener.js");
  fs.writeFileSync(script, `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(logFile)}, process.argv[2], "utf8");\n`, "utf8");
  fs.chmodSync(script, 0o755);
  return script;
};
const writeStub = (file) => {
  fs.writeFileSync(
    file,
    'const fs=require("fs");fs.writeFileSync(process.argv[2],"# R\\n\\n```cw:result\\n"+JSON.stringify({summary:"s",findings:[],evidence:[process.cwd()+"/README.md:1"]})+"\\n```\\n");process.stdout.write("{}");',
    "utf8"
  );
  return file;
};
const drive = (dir) =>
  quickstartRun({ appId: "architecture-review-fast", repo: dir, question: "risks?", agentCommand: `${process.execPath} ${writeStub(path.join(dir, "s.js"))} {{result}}` });

async function main() {
  // 1. converter: headings, table, code, link, bold present; text escaped.
  const html = reportToHtml("# T\n\n| A | B |\n| --- | ---: |\n| x <y> | **z** |\n\n```\nraw <code>\n```\n\n- one [link](http://e.co/p)\n");
  for (const n of ["<h1>", "<table>", "<pre><code>", '<a href="http://e.co/p">link</a>', "<strong>z</strong>", "&lt;y&gt;", "raw &lt;code&gt;"]) {
    assert.ok(html.includes(n), `converter output has ${n}`);
  }

  // 2. no id picks the newest of two fixture runs.
  const runsCwd = tmpDir("runs");
  const runsDir = path.join(runsCwd, ".cw", "runs");
  for (const id of ["review-20200101T000000Z-000001", "review-20260901T000000Z-000002"]) {
    fs.mkdirSync(path.join(runsDir, id), { recursive: true });
    fs.writeFileSync(path.join(runsDir, id, "state.json"), "{}", "utf8");
  }
  assert.equal(resolveReportRunId({ cwd: runsCwd }), "review-20260901T000000Z-000002", "newest run id wins");

  // 3. no run at all -> the one line, via the real CLI.
  const r = spawnSync(process.execPath, [cli, "report"], { cwd: tmpDir("bare"), encoding: "utf8" });
  assert.equal(r.stdout, 'No run yet. Try: cw -q "<question>"\n', "the one line, exact");

  // 4. --open's write+open step: report.html written, opener stub gets the path.
  const openDir = tmpDir("open");
  const mdPath = path.join(openDir, "report.md");
  fs.writeFileSync(mdPath, "# Report\n\n- a finding\n", "utf8");
  const log = path.join(openDir, "opener.log");
  process.env.CW_OPENER = openerStub(openDir, log);
  const htmlPath = ensureAndOpenReportHtml(mdPath);
  assert.ok(fs.existsSync(htmlPath), "report.html written");
  assert.equal(fs.readFileSync(log, "utf8"), htmlPath, "the opener stub got the exact path");
  delete process.env.CW_OPENER;

  // 5. quickstart off a TTY (the default here): no reportOpened, no html —
  //    the safety rail (--json/non-TTY output never changes).
  const quiet = await drive(tmpDir("quiet"));
  assert.equal(Object.prototype.hasOwnProperty.call(quiet, "reportOpened"), false, "no reportOpened off a TTY");
  assert.equal(fs.existsSync(quiet.reportPath.replace(/\.md$/, ".html")), false, "no report.html off a TTY");

  // 6. quickstart on a TTY stand-in: the auto-open runs through the stub,
  //    and the human summary carries the "Report opened" hint.
  const tty = tmpDir("tty");
  const openLog = path.join(tty, "opener.log");
  process.stdout.isTTY = true;
  process.env.CW_OPENER = openerStub(tty, openLog);
  let ttyResult;
  try {
    ttyResult = await drive(tty);
  } finally {
    process.stdout.isTTY = undefined;
    delete process.env.CW_OPENER;
  }
  assert.equal(ttyResult.reportOpened, true, "the foolproof step opened the report");
  assert.equal(fs.readFileSync(openLog, "utf8"), ttyResult.reportPath.replace(/\.md$/, ".html"), "opener stub got the report's html path");
  const summary = formatQuickstartHuman(ttyResult);
  assert.match(summary, /Report opened\. Again later: cw report --open/, "the end-of-run line");
  assert.match(summary, /cw report --show/, "the second hint");

  process.stdout.write("report-open-smoke: ok\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
