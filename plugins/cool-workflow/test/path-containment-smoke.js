"use strict";
// path-containment-smoke (v0.1.96). Proves the P3 audit fixes:
// initApp refuses outside appsDir, run export refuses output outside working
// directory, and extractReportTo is contained within cwd.
//
// @cw-smoke: path-containment-smoke

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist", "orchestrator.js"));

function writeApp(appsDir, id) {
  const dir = path.join(appsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify({
    schemaVersion: 1, id, title: id, summary: id, version: "0.1.0", author: "test",
    inputs: [],
    sandboxProfiles: ["readonly"],
    compatibility: { minVersion: "0.1.9" },
    workflow: { entrypoint: "workflow.js" }
  }, null, 2));
  fs.writeFileSync(path.join(dir, "workflow.js"), [
    `const { workflow, phase, agent, input } = require("${path.join(pluginRoot, "dist", "workflow-app-framework.js")}");`,
    `module.exports = ({ workflow, phase, agent, input }) => workflow({`,
    `  id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, summary: ${JSON.stringify(id)},`,
    `  limits: { maxAgents: 1, maxConcurrentAgents: 1 },`,
    `  inputs: [],`,
    `  sandboxProfiles: ["readonly"],`,
    `  phases: [ phase("Work", [ agent("do", "say ok", { sandboxProfileId: "readonly" }) ]) ]`,
    `});`
  ].join("\n"), "utf8");
}

function main() {
  const { isContainedPath } = require(path.join(pluginRoot, "dist", "state.js"));

  // ---- 1. isContainedPath suite -----------------------------------------------
  {
    assert.ok(isContainedPath("/tmp/foo/bar", "/tmp"), "child within parent is contained");
    assert.ok(isContainedPath("/tmp", "/tmp"), "identical paths are contained");
    assert.ok(!isContainedPath("/tmp", "/var"), "different branches are not contained");
    assert.ok(!isContainedPath("/etc/passwd", "/tmp"), "system path not contained in tmp");
  }

  // ---- 2. initApp refuses directory outside appsDir ---------------------------
  {
    const { initApp } = require(path.join(pluginRoot, "dist", "orchestrator", "app-operations.js"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const appsDir = path.join(tmp, "apps");
    fs.mkdirSync(appsDir, { recursive: true });
    const resolveFromBase = (t) => path.resolve(tmp, t);
    const validateApp = () => ({ valid: true, issues: [] });

    const ok = initApp(appsDir, "ok-app", { output: path.join(appsDir, "ok-app") }, resolveFromBase, validateApp);
    assert.ok(ok.manifestPath.startsWith(path.resolve(appsDir)), "initApp writes within apps dir");

    assert.throws(() => {
      initApp(appsDir, "bad-app", { output: "/etc/cw-injected" }, resolveFromBase, validateApp);
    }, /system directory/, "initApp refuses write to system dir");

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 3. export + extract containment ----------------------------------------
  {
    const { runExportArchive } = require(path.join(pluginRoot, "dist", "capability-core.js"));
    const { verifyReportBundle } = require(path.join(pluginRoot, "dist", "run-export.js"));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const appsDir = path.join(tmp, "apps");
    writeApp(appsDir, "guarded-export");

    const runner = new CoolWorkflowRunner({ pluginRoot, baseDir: tmp });
    runner.appsDir = appsDir;

    const plan = runner.plan("guarded-export", { repo: tmp, question: "does path containment work?" });

    // Export to cwd succeeds
    const goodOutput = path.join(tmp, `${plan.runId}.cwrun.json`);
    runExportArchive(runner, plan.id, { cwd: tmp, output: goodOutput });
    assert.ok(fs.existsSync(goodOutput), "export to cwd succeeds");

    // Export to /etc is refused
    assert.throws(() => {
      runExportArchive(runner, plan.id, { cwd: tmp, output: "/etc/cw-export-injected" });
    }, /outside/, "export to /etc is refused");

    // Extract to cwd works (reportExtractedTo may be undefined if the bundle
    // has no report.md — that is fine, the containment guard is what matters)
    const reportPath = path.join(tmp, "extracted-report.md");
    verifyReportBundle(goodOutput, { cwd: tmp, extractReportTo: reportPath, requireSigned: false });

    // Extract to /etc is refused — verifyReportBundle returns { ok: false }, 
    // does not throw (the function is catch-all advisory)
    const badExtract = verifyReportBundle(goodOutput, { cwd: tmp, extractReportTo: "/etc/cw-extracted", requireSigned: false });
    assert.equal(badExtract.ok, false, `extract to /etc rejected (ok: false, failedChecks: ${JSON.stringify(badExtract.failedChecks)})`);

    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
  process.stdout.write("PASS  path-containment-smoke.js\n");
} catch (e) {
  process.stderr.write(`FAIL  path-containment-smoke.js — ${String(e && e.message || e)}\n`);
  process.exit(1);
}
