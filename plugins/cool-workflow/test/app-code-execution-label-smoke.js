#!/usr/bin/env node
"use strict";

// app-code-execution-label-smoke — the app-code honesty label.
// `workflow.js` app code runs in-process with full host privileges
// (workflow-app-loader.ts admits this in its untrusted-source error); the
// run record must say so too, in the same unsoftened words. Proves:
//   1. planning a real workflow app stamps run.appCode with the exact,
//      unsoftened "in-process-unsandboxed" mode, the real entrypoint path
//      CW require()'d, and trustedRoot=true for a bundled app;
//   2. report.md's Trust Audit section renders one line naming that mode;
//   3. with appCode absent (no workflow app ran), that line is gone and
//      no OTHER report byte moves.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { writeReport } = require(path.join(pluginRoot, "dist/shell/report.js"));

function main() {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-app-code-label-")));
  const run = plan(loadWorkflowApp("workflow-app-framework-demo"), {
    cwd: workspace,
    question: "prove the app-code honesty label",
    now: "2026-09-01T00:00:00.000Z",
  });

  // ---- 1. state.json: the exact, unsoftened wording -----------------------
  const state = JSON.parse(fs.readFileSync(run.paths.state, "utf8"));
  assert.ok(state.appCode, "planning a workflow app must record appCode");
  assert.equal(state.appCode.execution, "in-process-unsandboxed", "the wording must be exact, never softened");
  assert.match(state.appCode.path, /workflow-app-framework-demo[\\/]workflow\.js$/, "path is the real workflow.js CW ran");
  assert.equal(state.appCode.trustedRoot, true, "a bundled app sits under a root CW already trusts");

  // ---- 2. report.md's Trust Audit line, same unsoftened word --------------
  // Re-render onto the CURRENT run (plan() commits after its own internal
  // writeReport call) so this file and the "absent" render below start from
  // one identical, settled run snapshot — isolating the diff to appCode alone.
  writeReport(run);
  const reportWithAppCode = fs.readFileSync(run.paths.report, "utf8");
  assert.match(
    reportWithAppCode,
    /^- App code execution: in-process-unsandboxed \(trustedRoot=true, .*workflow\.js\)$/m,
    "the Trust Audit section must name the execution mode, unsoftened"
  );

  // ---- 3. appCode absent -> no label at all, no other line moves ----------
  const withoutAppCode = JSON.parse(JSON.stringify(run));
  delete withoutAppCode.appCode;
  withoutAppCode.paths.report = path.join(workspace, ".cw", "runs", run.id, "report-no-appcode.md");
  writeReport(withoutAppCode);
  const reportWithoutAppCode = fs.readFileSync(withoutAppCode.paths.report, "utf8");
  assert.ok(!reportWithoutAppCode.includes("in-process-unsandboxed"), "no appCode -> the honesty label is fully absent");
  assert.ok(!reportWithoutAppCode.includes("App code execution"), "the whole line is gone, not softened");

  const linesWith = reportWithAppCode.split("\n").filter((line) => !line.startsWith("- App code execution:"));
  const linesWithout = reportWithoutAppCode.split("\n");
  assert.deepEqual(linesWith, linesWithout, "removing appCode changes ONLY that one line — every other report byte stays put");

  process.stdout.write("app-code-execution-label-smoke: ok\n");
}

main();
