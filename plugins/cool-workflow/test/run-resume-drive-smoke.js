"use strict";
// run-resume-drive-smoke: `run resume <id> --drive/--once` welds the resume verb to
// the EXISTING agent-delegation drive loop — continuing the SAME run (re-planning
// nothing), augmenting the result with the drive outcome. Bare `run resume` stays
// read-only and byte-identical. Fail-closed: an unconfigured agent yields a blocked
// drive, never a fabricated completion.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { RunRegistry } = require(path.join(pluginRoot, "dist/run-registry.js"));
const { runDrive, runResume } = require(path.join(pluginRoot, "dist/capability-core.js"));

function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}
function tmpRepo() {
  const w = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-resume-drive-")));
  fs.writeFileSync(path.join(w, "README.md"), "# target\n", "utf8");
  return w;
}
function writeStub(file, model) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub section", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    `process.stdout.write(JSON.stringify({ model: ${JSON.stringify(model || "stub-resume-model")} }));`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}
function regFor(repo, runner) {
  new RunRegistry(repo, runner).refresh({ scope: "repo" });
  return new RunRegistry(repo, runner);
}

const cwd0 = process.cwd();

// (1)+(2): drive ONE step, then `resume --drive` continues the SAME run to completion.
{
  clearAgentEnv();
  const repo = tmpRepo();
  const stub = writeStub(path.join(repo, "stub.js"), "resume-drive-model");
  const agentCommand = `${process.execPath} ${stub} {{result}}`;
  process.chdir(repo);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const step1 = runDrive(runner, { appId: "architecture-review", repo, question: "risks?", once: true, agentCommand });
    assert.equal(step1.status, "in-progress", "one --once step leaves the run partway");
    assert.ok(step1.completedWorkers < step1.plannedWorkers, "pending work remains after one step");
    const runId = step1.runId;

    const resumed = runResume(regFor(repo, runner), runner, runId, { scope: "repo", repo, drive: true, agentCommand });
    assert.ok(resumed.drive, "resume --drive augments the result with a drive outcome");
    assert.equal(resumed.drive.runId, runId, "resume --drive CONTINUES the same run, not a new one");
    assert.equal(resumed.drive.status, "complete", "resume --drive reaches completion");
    assert.equal(resumed.drive.completedWorkers, resumed.drive.plannedWorkers, "all workers completed after resume --drive");
    assert.ok(resumed.drive.commitId, "the resumed-driven run is committed");
  } finally { process.chdir(cwd0); }
}

// (3): FAIL CLOSED — resume --drive on an unconfigured agent blocks, never fabricates.
{
  clearAgentEnv();
  const repo = tmpRepo();
  process.chdir(repo);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const planned = runDrive(runner, { appId: "architecture-review", repo, question: "risks?" }); // no agent -> blocked
    const runId = planned.runId;
    const resumed = runResume(regFor(repo, runner), runner, runId, { scope: "repo", repo, drive: true });
    assert.ok(resumed.drive, "fail-closed path still returns a drive outcome");
    assert.equal(resumed.drive.status, "blocked", "unconfigured agent -> drive blocked (fail-closed)");
    assert.equal(resumed.drive.completedWorkers, 0, "no fabricated completion");
    assert.ok(!resumed.drive.commitId, "no commit on a blocked resume");
  } finally { process.chdir(cwd0); }
}

// (4): POLA — bare `resume` (no --drive) is read-only and byte-identical.
{
  clearAgentEnv();
  const repo = tmpRepo();
  process.chdir(repo);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const runId = runDrive(runner, { appId: "architecture-review", repo, question: "risks?" }).runId;
    const reg = regFor(repo, runner);
    const before = runner.loadRun(runId).tasks.filter((t) => t.status === "pending").length;
    const base = reg.resume(runId, { scope: "repo" });
    const noFlag = runResume(reg, runner, runId, { scope: "repo" });
    assert.equal(Object.prototype.hasOwnProperty.call(noFlag, "drive"), false, "default resume has NO drive field");
    assert.deepEqual(noFlag.nextActions, base.nextActions, "default resume nextActions byte-identical to reg.resume");
    const after = runner.loadRun(runId).tasks.filter((t) => t.status === "pending").length;
    assert.equal(after, before, "default resume mutates no task status");
  } finally { process.chdir(cwd0); }
}

// (5) CLI ROUTING (the gap a real dogfood exposed): `cw run resume <id> --drive` must
// REACH the resume verb. The early `--drive` app-route must not misread the "resume"
// subcommand keyword as an app named "resume" ("Workflow app not found: resume").
// No agent needed — a blocked drive still proves the routing. Plus a regression guard
// that `run <app> --drive` still routes to the app drive.
{
  const { spawnSync } = require("node:child_process");
  const cli = path.join(pluginRoot, "dist", "cli.js");
  clearAgentEnv();
  const repo = tmpRepo();
  process.chdir(repo);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const runId = runDrive(runner, { appId: "architecture-review", repo, question: "risks?" }).runId; // planned/blocked, no agent
    new RunRegistry(repo, runner).refresh({ scope: "repo" });

    const r = spawnSync(process.execPath, [cli, "run", "resume", runId, "--drive", "--scope", "repo", "--json"], { cwd: repo, encoding: "utf8" });
    assert.doesNotMatch(r.stderr || "", /Workflow app not found/, "resume --drive is NOT misrouted as an app named 'resume'");
    const out = JSON.parse(r.stdout);
    assert.equal(out.runId, runId, "`run resume <id> --drive` reaches the resume verb (same run id)");
    assert.ok(Object.prototype.hasOwnProperty.call(out, "drive"), "CLI resume --drive carries the drive outcome");
    assert.equal(out.drive.status, "blocked", "no agent -> drive blocked (fail-closed), routing confirmed");

    // Regression: `run <app> --drive --once` still routes to the app drive.
    const a = spawnSync(process.execPath, [cli, "run", "architecture-review", "--drive", "--once", "--repo", repo, "--question", "q", "--json"], { cwd: repo, encoding: "utf8" });
    assert.doesNotMatch(a.stderr || "", /not found/i, "`run <app> --drive` still routes to the app drive");
    const aout = JSON.parse(a.stdout);
    assert.ok(aout.runId && aout.status, "`run <app> --drive` returns a drive result");
  } finally { process.chdir(cwd0); }
}

process.stdout.write("run-resume-drive-smoke: ok (resume --drive continues to completion; fail-closed blocked; default byte-identical; CLI routing not misread as app)\n");
