"use strict";
// path-containment-smoke (v0.1.96). Proves the P3 audit fixes:
// initApp refuses outside appsDir, run export refuses output outside working
// directory, and extractReportTo is contained within cwd.
//
// v2 layout notes (external CLI behavior unchanged, internal modules moved):
//   - isContainedPath: old ../dist/state -> ../dist/shell/fs-atomic (same signature).
//   - initApp: old ../dist/orchestrator/app-operations.initApp(appsDir, id, opts,
//     resolveFromBase, validateApp) -> ../dist/shell/workflow-app-loader
//     .initWorkflowApp(appId, opts). v2 dropped the injected appsDir/resolveFromBase/
//     validateApp params (it discovers the apps root itself and validates the
//     generated app inline via validateWorkflowAppTarget). We steer the destination
//     with opts.output to keep the "writes within apps dir" and "refuses system dir"
//     checks. The system-dir guard message stayed "system directory".
//   - runExportArchive(runner, planId, {cwd,output}): the CoolWorkflowRunner facade is
//     gone in v2. Its export path is ../dist/shell/run-export-cli.runExportCli(runId,
//     {cwd,output}); loadRunFromCwd first, then the SAME system-directory guard
//     ("Refusing to write archive to a system directory"). We persist a run on disk
//     with ../dist/shell/run-store (createRunPaths/ensureRunDirs/saveCheckpoint) — the
//     committed report-verify-bundle-smoke pattern — instead of runner.plan().
//   - verifyReportBundle: old ../dist/run-export -> ../dist/shell/run-export. Same
//     extract-containment guard (extract outside cwd => ok:false / failedChecks).
//
// @cw-smoke: path-containment-smoke

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const pluginRoot = path.resolve(__dirname, "..");

function main() {
  const { isContainedPath } = require(path.join(pluginRoot, "dist", "shell", "fs-atomic.js"));

  // ---- 1. isContainedPath suite -----------------------------------------------
  {
    assert.ok(isContainedPath("/tmp/foo/bar", "/tmp"), "child within parent is contained");
    assert.ok(isContainedPath("/tmp", "/tmp"), "identical paths are contained");
    assert.ok(!isContainedPath("/tmp", "/var"), "different branches are not contained");
    assert.ok(!isContainedPath("/etc/passwd", "/tmp"), "system path not contained in tmp");
  }

  // ---- 2. initApp refuses directory outside appsDir ---------------------------
  {
    const { initWorkflowApp } = require(path.join(pluginRoot, "dist", "shell", "workflow-app-loader.js"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const appsDir = path.join(tmp, "apps");
    fs.mkdirSync(appsDir, { recursive: true });

    // v2 initWorkflowApp(appId, opts) — opts.output picks the destination and it
    // validates the generated app itself (no injected resolveFromBase/validateApp).
    const ok = initWorkflowApp("ok-app", { output: path.join(appsDir, "ok-app") });
    assert.ok(ok.manifestPath.startsWith(path.resolve(appsDir)), "initApp writes within apps dir");

    assert.throws(() => {
      initWorkflowApp("bad-app", { output: "/etc/cw-injected" });
    }, /system directory/, "initApp refuses write to system dir");

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 3. export + extract containment ----------------------------------------
  {
    const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));
    const { runExportCli } = require(path.join(pluginRoot, "dist", "shell", "run-export-cli.js"));
    const { verifyReportBundle } = require(path.join(pluginRoot, "dist", "shell", "run-export.js"));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const runId = "guarded-export";

    // Persist a minimal completed run on disk so runExportCli's loadRunFromCwd finds
    // it (v2 has no in-memory runner.plan(); this is the report-verify-bundle pattern).
    const runDir = path.join(tmp, ".cw", "runs", runId);
    const paths = createRunPaths(runDir);
    ensureRunDirs(paths);
    fs.writeFileSync(path.join(runDir, "report.md"), `# Report for ${runId}\n\nFinding: src/x.js:1 — example cited evidence.\n`, "utf8");
    const fullRun = {
      schemaVersion: 1,
      id: runId,
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      cwd: tmp,
      workflow: { id: "guarded-export", title: "guarded-export", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
      inputs: { question: "does path containment work?" },
      loopStage: "interpret",
      phases: [{ id: "work", name: "Work", status: "completed", taskIds: ["t1"] }],
      tasks: [{ id: "t1", kind: "analyze", phase: "work", status: "completed", requiresEvidence: false, prompt: "do", taskPath: path.join(paths.tasksDir, "t1.md"), resultPath: path.join(paths.resultsDir, "t1.md"), loopStage: "act" }],
      dispatches: [],
      commits: [],
      paths,
      nodes: [],
      contracts: []
    };
    saveCheckpoint(fullRun);

    // Export to cwd succeeds
    const goodOutput = path.join(tmp, `${runId}.cwrun.json`);
    runExportCli(runId, { cwd: tmp, output: goodOutput });
    assert.ok(fs.existsSync(goodOutput), "export to cwd succeeds");

    // Export to /etc is refused
    assert.throws(() => {
      runExportCli(runId, { cwd: tmp, output: "/etc/cw-export-injected" });
    }, /system directory/, "export to /etc is refused");

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
