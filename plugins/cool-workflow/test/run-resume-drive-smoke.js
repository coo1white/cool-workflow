"use strict";
// run-resume-drive-smoke: `run resume <id> --drive/--once` welds the resume verb to
// the EXISTING agent-delegation drive loop — continuing the SAME run (re-planning
// nothing), augmenting the result with the drive outcome. Bare `run resume` stays
// read-only and byte-identical. Fail-closed: an unconfigured agent yields a blocked
// drive, never a fabricated completion.
//
// v2 API map (the old orchestrator/run-registry/capability-core facades are gone):
//   - runner.<plan+drive>  -> plan(loadWorkflowApp(appId), {repo,cwd,question})
//                             + drive(run.id, run.cwd, {once, agentConfig})
//   - runner.loadRun(id)   -> loadRunFromCwd(id, cwd)
//   - new RunRegistry(repo, runner) -> new RunRegistry(cwd)  (2nd arg is a
//     RunPlanner, only used by .rerun — unused here, so no shim needed)
//   - runResume(reg, runner, id, {..drive}) -> runResumeCli(id, {..cwd, drive})
//     (registry-cli.ts's runResumeCli IS the in-process resume+drive weld:
//      registry.resume(id) for the base, then runDriveStep for the --drive weld,
//      returning {...base, drive}; bare resume returns base with NO drive field.)

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store.js"));
const { RunRegistry } = require(path.join(pluginRoot, "dist/shell/run-registry-io.js"));
const { runResumeCli } = require(path.join(pluginRoot, "dist/shell/registry-cli.js"));

function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
  // v2's resolveAgentConfig auto-detects claude/codex/gemini/opencode on PATH
  // (agent-config.ts detectAgentFromPath). All four are commonly installed on a
  // dev box, which would silently CONFIGURE an agent and defeat the fail-closed
  // "no agent -> blocked" assertions below. CW_NO_AUTO_AGENT=1 is the documented
  // lever that skips PATH auto-detect, preserving the original "unconfigured
  // agent" intent regardless of what CLIs happen to be installed.
  process.env.CW_NO_AUTO_AGENT = "1";
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
// The old smoke's `agentCommand` was a whitespace-joined command string like
// "node stub.js {{result}}"; v2's agent-config splitCommand() splits exactly that
// on whitespace into command+args, so the string form is still accepted through
// runResumeCli's `agentCommand` option (which flows into runDriveStep ->
// resolveAgentConfig). Build the resolved agentConfig object directly for the
// in-process plan+drive first step.
function agentConfigFor(command) {
  const parts = String(command).split(/\s+/).filter(Boolean);
  return { schemaVersion: 1, command: parts[0], args: parts.slice(1), source: "flag" };
}
// v2 replacement for `runDrive(runner, {appId, repo, question, once, agentCommand})`:
// plan a fresh run then drive it. Returns the same DriveResult shape
// ({ runId, status, completedWorkers, plannedWorkers, commitId, ... }).
function planAndDrive({ appId, repo, question, once, agentCommand }) {
  const run = plan(loadWorkflowApp(appId), { repo, cwd: repo, question });
  const options = { once: Boolean(once) };
  if (agentCommand) options.agentConfig = agentConfigFor(agentCommand);
  return drive(run.id, run.cwd, options);
}
// v2 replacement for `regFor(repo, runner)`: refresh the repo-scoped index once,
// then hand back a fresh registry (no runner planner needed — .refresh/.resume
// re-derive from durable source state, and this smoke never calls .rerun).
function regFor(repo) {
  new RunRegistry(repo).refresh({ scope: "repo" });
  return new RunRegistry(repo);
}

// runResumeCli awaits the now-async runDriveStep (driveAsync keeps a live
// drive loop interruptible by a real SIGINT/SIGTERM -- shell/drive.ts), so
// the whole body below (previously top-level) is wrapped in an async main().
async function main() {
const cwd0 = process.cwd();

// (1)+(2): drive ONE step, then `resume --drive` continues the SAME run to completion.
{
  clearAgentEnv();
  const repo = tmpRepo();
  const stub = writeStub(path.join(repo, "stub.js"), "resume-drive-model");
  const agentCommand = `${process.execPath} ${stub} {{result}}`;
  process.chdir(repo);
  try {
    const step1 = planAndDrive({ appId: "architecture-review", repo, question: "risks?", once: true, agentCommand });
    assert.equal(step1.status, "in-progress", "one --once step leaves the run partway");
    assert.ok(step1.completedWorkers < step1.plannedWorkers, "pending work remains after one step");
    const runId = step1.runId;

    const resumed = await runResumeCli(runId, { scope: "repo", cwd: repo, drive: true, agentCommand });
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
    const planned = planAndDrive({ appId: "architecture-review", repo, question: "risks?" }); // no agent -> blocked
    const runId = planned.runId;
    const resumed = await runResumeCli(runId, { scope: "repo", cwd: repo, drive: true });
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
    const runId = planAndDrive({ appId: "architecture-review", repo, question: "risks?" }).runId;
    const reg = regFor(repo);
    const before = loadRunFromCwd(runId, repo).tasks.filter((t) => t.status === "pending").length;
    const base = reg.resume(runId, { scope: "repo" });
    const noFlag = await runResumeCli(runId, { scope: "repo", cwd: repo });
    assert.equal(Object.prototype.hasOwnProperty.call(noFlag, "drive"), false, "default resume has NO drive field");
    assert.deepEqual(noFlag.nextActions, base.nextActions, "default resume nextActions byte-identical to reg.resume");
    const after = loadRunFromCwd(runId, repo).tasks.filter((t) => t.status === "pending").length;
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
  // Propagate the no-auto-agent lever to the spawned CLI so its own
  // resolveAgentConfig also fails closed (matching the in-process sections).
  const childEnv = { ...process.env, CW_NO_AUTO_AGENT: "1" };
  const repo = tmpRepo();
  process.chdir(repo);
  try {
    const runId = planAndDrive({ appId: "architecture-review", repo, question: "risks?" }).runId; // planned/blocked, no agent
    new RunRegistry(repo).refresh({ scope: "repo" });

    const r = spawnSync(process.execPath, [cli, "run", "resume", runId, "--drive", "--scope", "repo", "--json"], { cwd: repo, encoding: "utf8", env: childEnv });
    assert.doesNotMatch(r.stderr || "", /Workflow app not found/, "resume --drive is NOT misrouted as an app named 'resume'");
    const out = JSON.parse(r.stdout);
    assert.equal(out.runId, runId, "`run resume <id> --drive` reaches the resume verb (same run id)");
    assert.ok(Object.prototype.hasOwnProperty.call(out, "drive"), "CLI resume --drive carries the drive outcome");
    assert.equal(out.drive.status, "blocked", "no agent -> drive blocked (fail-closed), routing confirmed");

    const human = spawnSync(process.execPath, [cli, "run", "resume", runId, "--drive", "--scope", "repo"], { cwd: repo, encoding: "utf8", env: childEnv });
    assert.equal(human.status, 0, "a blocked drive is a saved result, not a CLI fault");
    assert.match(human.stdout, /  drive=blocked workers=0\/14 parked=0\n/, "human resume shows the drive result");
    assert.match(human.stdout, /  step blocked \[blocked\].*reason=agent backend not configured.*\n/, "human resume shows why drive stopped");

    // Regression: `run <app> --drive --once` still routes to the app drive.
    const a = spawnSync(process.execPath, [cli, "run", "architecture-review", "--drive", "--once", "--repo", repo, "--question", "q", "--json"], { cwd: repo, encoding: "utf8", env: childEnv });
    assert.doesNotMatch(a.stderr || "", /not found/i, "`run <app> --drive` still routes to the app drive");
    const aout = JSON.parse(a.stdout);
    assert.ok(aout.runId && aout.status, "`run <app> --drive` returns a drive result");
  } finally { process.chdir(cwd0); }
}

// (6) architecture-review-driven fix: `cw run resume <id> --drive` must
// find the run when invoked from a DIFFERENT directory than the run's own
// repo -- the realistic case for a copy-pasted resume command (typed from
// wherever the terminal happens to be, not necessarily back in --repo).
// --scope home so the lookup doesn't depend on the repo-local index; no
// --repo/--cwd passed to the resume call itself -- it must find its own
// way back via the registry record's OWN repo field.
{
  const { spawnSync } = require("node:child_process");
  const cli = path.join(pluginRoot, "dist", "cli.js");
  clearAgentEnv();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-resume-drive-home-"));
  const childEnv = { ...process.env, CW_NO_AUTO_AGENT: "1", CW_HOME: homeDir };
  const repo = tmpRepo();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "cw-resume-drive-elsewhere-"));
  process.chdir(repo);
  try {
    process.env.CW_HOME = homeDir;
    const runId = planAndDrive({ appId: "architecture-review", repo, question: "risks?" }).runId; // planned/blocked, no agent
    new RunRegistry(repo).refresh({ scope: "repo" }); // also populates the home index (refresh's own side effect)

    process.chdir(elsewhere);
    const r = spawnSync(process.execPath, [cli, "run", "resume", runId, "--drive", "--scope", "home", "--json"], { cwd: elsewhere, encoding: "utf8", env: childEnv });
    assert.doesNotMatch(r.stderr || "", /Run not found/, `resume --drive from a different cwd must still find the run (stderr: ${r.stderr})`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.runId, runId, "resume --drive from elsewhere still reaches the SAME run");
    assert.ok(Object.prototype.hasOwnProperty.call(out, "drive"), "resume --drive from elsewhere still carries a drive outcome");
    assert.equal(out.drive.status, "blocked", "no agent -> drive blocked (fail-closed), cwd-independent lookup confirmed");
  } finally {
    delete process.env.CW_HOME;
    process.chdir(cwd0);
  }
}

process.stdout.write("run-resume-drive-smoke: ok (resume --drive continues to completion; fail-closed blocked; default byte-identical; CLI routing not misread as app; cwd-independent lookup)\n");
}

main().catch((e) => {
  process.stderr.write(`FAIL  run-resume-drive-smoke.js — ${String((e && e.message) || e)}\n`);
  process.exit(1);
});
