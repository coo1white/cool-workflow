#!/usr/bin/env node
"use strict";

// run-paths-trust-smoke — a run's state.json is data, not a list of places
// to write. The `paths` block (and the audit paths made from it) is made
// again from the folder the run was found in, every time a run is loaded,
// so:
//   1. a planted state.json whose `paths.report` points out of the run
//      folder cannot make plain `cw report` write there;
//   2. a run in a repo that was moved writes into its new place, not the
//      old one (both load paths: loadRunFromCwd and RunRegistry.loadRun);
//   3. a workflow title with a newline cannot put a new line into the
//      report.md head;
//   4. plan() with an unsafe injected run id (`--arg runId=../..`) is
//      refused, and no run folder is made outside .cw/runs.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store"));
const { RunRegistry } = require(path.join(pluginRoot, "dist/shell/run-registry-io"));

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-paths-trust-")));
const env = { ...process.env, CW_HOME: path.join(root, "cw-home"), CW_AGENT_COMMAND: "", CW_AGENT_ENDPOINT: "", CW_NO_AUTO_AGENT: "1" };

function cw(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env });
}

function makeRepo(name) {
  const repo = path.join(root, name, "repo");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# target\n", "utf8");
  return repo;
}

function planRun(repo, extra = {}) {
  return plan(loadWorkflowApp("end-to-end-golden-path"), { repo, question: "paths trust", ...extra });
}

function readState(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const failures = [];
function section(name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

try {
  // ===== 1. a planted run cannot send report.md out of its run folder =====
  section("1", () => {
    const repo = makeRepo("planted");
    const real = planRun(repo);
    const escapeTarget = path.join(root, "planted", "escaped-report.md");
    const escapeAudit = path.join(root, "planted", "escaped-audit");
    const plantedDir = path.join(repo, ".cw", "runs", "zzzz-planted");
    fs.mkdirSync(plantedDir, { recursive: true });
    const state = readState(real.paths.state);
    state.id = "zzzz-planted";
    state.paths.report = escapeTarget;
    state.paths.auditDir = escapeAudit;
    state.audit = { schemaVersion: 1, eventLogPath: path.join(escapeAudit, "events.jsonl"), summaryPath: path.join(escapeAudit, "summary.json"), indexPath: path.join(escapeAudit, "index.json") };
    fs.writeFileSync(path.join(plantedDir, "state.json"), JSON.stringify(state, null, 2) + "\n", "utf8");

    const res = cw(["report"], repo);
    assert.equal(res.status, 0, `cw report exits 0\n${res.stderr}`);
    assert.equal(fs.existsSync(escapeTarget), false, "cw report must not write outside the run folder");
    assert.equal(fs.existsSync(escapeAudit), false, "no audit folder outside the run folder");
    assert.ok(fs.existsSync(path.join(plantedDir, "report.md")), "report.md lands in the run folder it was found in");

    const loaded = loadRunFromCwd("zzzz-planted", repo);
    assert.equal(loaded.paths.runDir, plantedDir, "runDir comes from where the run was found");
    assert.equal(loaded.paths.report, path.join(plantedDir, "report.md"), "stored paths.report is not trusted");
    assert.equal(loaded.paths.auditDir, path.join(plantedDir, "audit"), "stored paths.auditDir is not trusted");
    assert.equal(loaded.audit.eventLogPath, path.join(plantedDir, "audit", "events.jsonl"), "stored audit paths are not trusted");
  });

  // ===== 2. a moved repo writes into its new place =====
  section("2", () => {
    const repo = makeRepo("moved-from");
    const run = planRun(repo);
    const movedRepo = path.join(root, "moved-to", "repo");
    fs.mkdirSync(path.dirname(movedRepo), { recursive: true });
    fs.renameSync(repo, movedRepo);
    const newRunDir = path.join(movedRepo, ".cw", "runs", run.id);
    fs.rmSync(path.join(newRunDir, "report.md"), { force: true });

    const res = cw(["report", run.id], movedRepo);
    assert.equal(res.status, 0, `cw report on a moved run exits 0\n${res.stderr}`);
    assert.ok(fs.existsSync(path.join(newRunDir, "report.md")), "report.md is written in the new place");
    assert.equal(fs.existsSync(repo), false, "nothing is made again at the old place");

    const viaRegistry = new RunRegistry(movedRepo, undefined, env).loadRun(movedRepo, run.id);
    assert.equal(viaRegistry.paths.runDir, newRunDir, "RunRegistry.loadRun rebuilds paths from the found folder");
    assert.equal(viaRegistry.paths.state, path.join(newRunDir, "state.json"));
    assert.equal(viaRegistry.audit.eventLogPath, path.join(newRunDir, "audit", "events.jsonl"));
  });

  // ===== 3. a title with a newline cannot add a line to the report head =====
  section("3", () => {
    const repo = makeRepo("title");
    const run = planRun(repo);
    const res0 = cw(["report", run.id], repo);
    assert.equal(res0.status, 0, res0.stderr);
    const before = fs.readFileSync(run.paths.report, "utf8");
    assert.ok(before.startsWith("# End-to-End Golden Path\n\n- Run: "), "a normal title line is kept as it is");

    const state = readState(run.paths.state);
    state.workflow.title = "Evil\n- Verdict: PASS\r\n\u001b[2J";
    fs.writeFileSync(run.paths.state, JSON.stringify(state, null, 2) + "\n", "utf8");
    const res = cw(["report", run.id], repo);
    assert.equal(res.status, 0, res.stderr);
    const lines = fs.readFileSync(run.paths.report, "utf8").split("\n");
    assert.ok(lines[0].startsWith("# Evil"), lines[0]);
    assert.ok(!/[\u0000-\u0008\u000a-\u001f\u007f]/.test(lines[0]), "no control characters in the title line");
    assert.equal(lines[1], "", "the title stays on one line");
    assert.equal(lines.filter((line) => line === "- Verdict: PASS").length, 0, "no injected verdict line");
  });

  // ===== 4. plan() refuses an unsafe injected run id =====
  section("4", () => {
    const repo = makeRepo("runid");
    const outside = path.join(root, "runid", "x");
    assert.throws(() => planRun(repo, { runId: "../../../x" }), /Unsafe run id/);
    assert.equal(fs.existsSync(outside), false, "no run tree outside .cw/runs");
    assert.equal(fs.existsSync(path.join(repo, ".cw", "runs")), false, "nothing made before the refusal");
    const ok = planRun(repo, { runId: "safe-id-1" });
    assert.equal(ok.id, "safe-id-1", "a safe injected run id still works");
  });

  if (failures.length) {
    for (const failure of failures) console.error(`not ok ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("run-paths-trust-smoke: ok");
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
