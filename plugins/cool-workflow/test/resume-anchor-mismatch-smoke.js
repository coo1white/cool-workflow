"use strict";
// resume-anchor-mismatch-smoke: a resume names WHERE the run lives with
// --repo/--cwd (docs/agent-delegation-drive.7.md: the run is looked up under
// `.cw/runs/<run-id>/` from there). The state found there also stores the
// folder the run was made for (`state.cwd`). When those two name different
// real folders (a copied repo, a moved repo), the drive used to follow the
// STORED cwd silently: `cw --resume --run <id> --repo <copy>` drove the
// original repo's run. Now it is refused, fail-closed, before any write.
// The agreeing case (same real folder, also through a symlink, as with
// macOS /var vs /private/var) keeps working as before.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));

for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
process.env.CW_NO_AUTO_AGENT = "1";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-resume-anchor-")));
const home = path.join(root, "home");
fs.mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, CW_HOME: path.join(home, ".cw") };

function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub section", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub-anchor-model" }));',
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}
const stub = writeStub(path.join(root, "stub.js"));
const agentCommand = `${process.execPath} ${stub} {{result}}`;

/** A repo with a run driven ONE step, so pending work remains. */
function repoWithPartialRun(name) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# target\n", "utf8");
  const run = plan(loadWorkflowApp("architecture-review"), { repo, cwd: repo, question: "risks?" });
  const parts = agentCommand.split(/\s+/);
  const step = drive(run.id, run.cwd, { once: true, agentConfig: { schemaVersion: 1, command: parts[0], args: parts.slice(1), source: "flag" } });
  assert.equal(step.status, "in-progress", "one --once step leaves the run partway");
  return { repo, runId: run.id };
}
function stateText(repo, runId) {
  return fs.readFileSync(path.join(repo, ".cw", "runs", runId, "state.json"), "utf8");
}
function cw(args) {
  return spawnSync(process.execPath, [cli, ...args, "--agent-command", agentCommand], { cwd: root, env, encoding: "utf8" });
}

// (1) `cw --resume --run <id> --repo <copy>`: refused; neither run is touched.
{
  const { repo: original, runId } = repoWithPartialRun("original");
  const copy = path.join(root, "copy");
  fs.cpSync(original, copy, { recursive: true });
  const beforeOriginal = stateText(original, runId);
  const beforeCopy = stateText(copy, runId);
  const r = cw(["--resume", "--run", runId, "--repo", copy]);
  assert.notEqual(r.status, 0, `resume of a copied run must be refused; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stderr, /was made for .*original.*not .*copy/, `the refusal names both folders; stderr=${r.stderr}`);
  assert.equal(stateText(original, runId), beforeOriginal, "the original run is NOT driven through the copy's --repo");
  assert.equal(stateText(copy, runId), beforeCopy, "the copy's run is not changed either");

  // (2) `cw run resume <id> --drive --repo <copy>`: the same refusal.
  const r2 = cw(["run", "resume", runId, "--drive", "--repo", copy]);
  assert.notEqual(r2.status, 0, `run resume --drive of a copied run must be refused; stdout=${r2.stdout} stderr=${r2.stderr}`);
  assert.match(r2.stderr, /was made for .*original.*not .*copy/, `the refusal names both folders; stderr=${r2.stderr}`);
  assert.equal(stateText(original, runId), beforeOriginal, "run resume --drive does not drive the original run");
  assert.equal(stateText(copy, runId), beforeCopy, "run resume --drive does not change the copy");

  // (3) `--cwd` in place of `--repo`: the same refusal.
  const r3 = cw(["--resume", "--run", runId, "--cwd", copy]);
  assert.notEqual(r3.status, 0, `resume --cwd of a copied run must be refused; stderr=${r3.stderr}`);
  assert.equal(stateText(original, runId), beforeOriginal, "--cwd does not drive the original run");
}

// (4) Agreeing case through a symlink (same real folder): works as before.
{
  const { repo, runId } = repoWithPartialRun("real");
  const link = path.join(root, "link");
  fs.symlinkSync(repo, link, "dir");
  const r = cw(["--resume", "--run", runId, "--repo", link, "--json"]);
  assert.equal(r.status, 0, `resume through a symlink to the same folder still works; stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.runId, runId, "the same run is continued");
  assert.equal(out.status, "complete", "resume drives the run to the end");
}

// (5) Agreeing case for `run resume --drive --repo <same>`: works as before.
{
  const { repo, runId } = repoWithPartialRun("plain");
  const r = cw(["run", "resume", runId, "--drive", "--repo", repo, "--json"]);
  assert.equal(r.status, 0, `run resume --drive on the run's own repo still works; stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.drive.runId, runId);
  assert.equal(out.drive.status, "complete");
}

fs.rmSync(root, { recursive: true, force: true });
console.log("resume-anchor-mismatch-smoke: ok");
