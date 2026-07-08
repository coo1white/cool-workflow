#!/usr/bin/env node
"use strict";

// status-run-flag-smoke (robustness) — `cw status --run <id>` used to be
// silently ignored: the CLI binding only ever read `args.positionals[0]`,
// so `cw status --run <real-id>` and `cw status --run <bogus-id>` produced
// the IDENTICAL "No run selected" output regardless of which id was given
// (the flag's value never reached statusCli at all). Asserts:
//   1. `--run <real-id>` resolves the real run, same payload as positional.
//   2. `--run <bogus-id>` errors distinctly (the id really was looked up),
//      not silently "No run selected".
//   3. The positional form is unchanged.
//   4. `--run` wins if somehow both a positional and `--run` are given
//      (positional takes precedence, matching this codebase's established
//      "positional first, then --run/--runId" convention elsewhere).

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-status-run-flag-"));

function makeRun(runId) {
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);
  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cwd,
    workflow: { id: runId, title: "Demo", summary: "", limits: { maxAgents: 2, maxConcurrentAgents: 1 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: [],
    sandboxProfiles: [],
    candidates: [],
    candidateSelections: []
  };
  saveCheckpoint(run);
  return run;
}

makeRun("flag-demo-run");
makeRun("other-run");

// ---- 1. --run <real-id> resolves the same as the positional form ---------
{
  const viaFlag = JSON.parse(execFileSync(node, [cli, "status", "--run", "flag-demo-run", "--json"], { cwd, encoding: "utf8" }));
  const viaPositional = JSON.parse(execFileSync(node, [cli, "status", "flag-demo-run", "--json"], { cwd, encoding: "utf8" }));
  assert.equal(viaFlag.runId, "flag-demo-run", "--run must resolve the real run");
  assert.deepEqual(viaFlag, viaPositional, "--run and positional must produce byte-identical payloads for the same run");
}

// ---- 2. --run <bogus-id> errors distinctly, not "No run selected" --------
{
  const bogus = spawnSync(node, [cli, "status", "--run", "does-not-exist"], { cwd, encoding: "utf8" });
  assert.equal(bogus.status, 1, "a bogus --run id must be a real error, not a clean no-run-selected exit");
  assert.doesNotMatch(bogus.stderr + bogus.stdout, /No run selected/, "a bogus --run id must not be indistinguishable from no id at all");
}

// ---- 3. no id at all is unchanged: the fixed "No run selected" advice -----
{
  const none = execFileSync(node, [cli, "status"], { cwd, encoding: "utf8" });
  assert.match(none, /No run selected/, "no run id at all must still show the fixed advice");
}

// ---- 4. positional takes precedence when both are given -------------------
{
  const both = JSON.parse(execFileSync(node, [cli, "status", "flag-demo-run", "--run", "other-run", "--json"], { cwd, encoding: "utf8" }));
  assert.equal(both.runId, "flag-demo-run", "a positional id must win over --run when both are given (matches this codebase's established precedence)");
}

fs.rmSync(cwd, { recursive: true, force: true });
process.stdout.write("status-run-flag-smoke: ok\n");
