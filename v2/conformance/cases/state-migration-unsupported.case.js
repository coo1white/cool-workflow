#!/usr/bin/env node
"use strict";

// Fail-closed bounds of migrateRunState, through `cw state check` and
// `cw migration check|prove`:
//   - non-object run state -> unsupported, single exact error string
//   - schemaVersion above current -> unsupported, "newer" error, no write
//   - a non-integer schemaVersion detects as "infinity" -> also "newer"
//   - exit code 1 on an unsupported verdict for both state check and
//     migration check/prove
//   - `cw migration list` prints the exact declared registry shape
//   - `cw migration check <missing file>` throws "Migration target not found"

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

function writeRun(repo, runId, stateValue) {
  const runDir = path.join(repo, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const statePath = path.join(runDir, "state.json");
  fs.writeFileSync(statePath, typeof stateValue === "string" ? stateValue : JSON.stringify(stateValue));
  return statePath;
}

caseMain(() => {
  const repo = freshDir("repo");

  // 1. non-object run state (a bare JSON string)
  writeRun(repo, "string-run", '"just a string"');
  const stringResult = run(["state", "check", "string-run"], { cwd: repo });
  assert.equal(stringResult.status, 1);
  const stringReport = JSON.parse(stringResult.stdout);
  assert.equal(stringReport.status, "unsupported");
  assert.deepEqual(stringReport.errors, ["Run state must be a JSON object."]);
  assert.equal(stringReport.writeRequired, false);

  // 2. schemaVersion newer than current runtime (1)
  writeRun(repo, "future-run", { schemaVersion: 99 });
  const futureResult = run(["state", "check", "future-run"], { cwd: repo });
  assert.equal(futureResult.status, 1);
  const futureReport = JSON.parse(futureResult.stdout);
  assert.equal(futureReport.status, "unsupported");
  assert.equal(futureReport.detectedSchemaVersion, 99);
  assert.deepEqual(futureReport.errors, [
    "Run state schemaVersion 99 is newer than this CW runtime (1).",
  ]);

  // 3. non-integer schemaVersion detects as +Infinity -> also "newer", with
  // the exact "invalid (number: 1.5)" description embedded in the message.
  writeRun(repo, "fractional-run", { schemaVersion: 1.5 });
  const fractionalResult = run(["state", "check", "fractional-run"], { cwd: repo });
  assert.equal(fractionalResult.status, 1);
  const fractionalReport = JSON.parse(fractionalResult.stdout);
  assert.equal(fractionalReport.status, "unsupported");
  assert.match(fractionalReport.errors[0], /invalid \(number: 1\.5\)/);

  // 4. a clean, already-current run reports "current" and exit 0. Every
  // required top-level key AND every paths.* subfield must be present, or
  // normalizeRunState fills the gaps and the status drops to "normalized".
  const cleanRunDir = path.join(repo, ".cw", "runs", "clean-run");
  writeRun(repo, "clean-run", {
    schemaVersion: 1,
    id: "clean-run",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    cwd: repo,
    workflow: { id: "x", title: "X", summary: "", limits: { maxAgents: 8, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths: {
      runDir: cleanRunDir,
      state: path.join(cleanRunDir, "state.json"),
      report: path.join(cleanRunDir, "report.md"),
      tasksDir: path.join(cleanRunDir, "tasks"),
      resultsDir: path.join(cleanRunDir, "results"),
      dispatchesDir: path.join(cleanRunDir, "dispatches"),
      artifactsDir: path.join(cleanRunDir, "artifacts"),
      commitsDir: path.join(cleanRunDir, "commits"),
      stateNodesDir: path.join(cleanRunDir, "nodes"),
      feedbackDir: path.join(cleanRunDir, "feedback"),
      auditDir: path.join(cleanRunDir, "audit"),
      workersDir: path.join(cleanRunDir, "workers"),
      candidatesDir: path.join(cleanRunDir, "candidates"),
      multiAgentDir: path.join(cleanRunDir, "multi-agent"),
      blackboardDir: path.join(cleanRunDir, "blackboard"),
      topologiesDir: path.join(cleanRunDir, "topologies"),
    },
    nodes: [],
    contracts: [],
    feedback: [],
    audit: {
      schemaVersion: 1,
      eventLogPath: path.join(cleanRunDir, "audit", "events.jsonl"),
      summaryPath: path.join(cleanRunDir, "audit", "summary.json"),
      indexPath: path.join(cleanRunDir, "audit", "index.json"),
    },
    workers: [],
    sandboxProfiles: [],
    candidates: [],
    candidateSelections: [],
    multiAgent: { schemaVersion: 1, runs: [], roles: [], groups: [], memberships: [], fanouts: [], fanins: [] },
    blackboard: {
      schemaVersion: 1,
      boards: [],
      topics: [],
      messages: [],
      contexts: [],
      artifacts: [],
      snapshots: [],
      decisions: [],
    },
    topologies: { schemaVersion: 1, runs: [] },
  });
  const cleanResult = run(["migration", "check", path.join(repo, ".cw", "runs", "clean-run", "state.json")], {
    cwd: repo,
  });
  assert.equal(cleanResult.status, 0);
  const cleanVerdict = JSON.parse(cleanResult.stdout);
  assert.equal(cleanVerdict.status, "current");
  assert.equal(cleanVerdict.reachable, true);
  assert.deepEqual(cleanVerdict.chain, [1]);

  // 5. `cw migration check` on an unsupported target exits 1
  const futureCheck = run(
    ["migration", "check", path.join(repo, ".cw", "runs", "future-run", "state.json")],
    { cwd: repo }
  );
  assert.equal(futureCheck.status, 1);
  assert.equal(JSON.parse(futureCheck.stdout).status, "unsupported");

  // 6. `cw migration prove` on an unsupported target exits 1 (pass:false)
  const futureProve = run(
    ["migration", "prove", path.join(repo, ".cw", "runs", "future-run", "state.json")],
    { cwd: repo }
  );
  assert.equal(futureProve.status, 1);
  const proveResult = JSON.parse(futureProve.stdout);
  assert.equal(proveResult.pass, false);
  assert.equal(proveResult.verdict.status, "unsupported");

  // 7. a missing migration target throws the exact message
  const missing = run(["migration", "check", "does-not-exist-run"], { cwd: repo });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "cw: Migration target not found: does-not-exist-run\n");

  // 8. `cw migration list` prints the exact declared contract registry
  const listResult = run(["migration", "list"], { cwd: repo });
  assert.equal(listResult.status, 0);
  const registry = JSON.parse(listResult.stdout);
  assert.equal(registry.contracts.length, 2);
  const runStateContract = registry.contracts.find((c) => c.contract === "run-state");
  assert.equal(runStateContract.currentVersion, 1);
  assert.equal(runStateContract.minVersion, 0);
  assert.equal(runStateContract.edges.length, 1);
  assert.equal(runStateContract.edges[0].from, 0);
  assert.equal(runStateContract.edges[0].to, 1);
  assert.equal(
    runStateContract.edges[0].description,
    "Mark legacy run state without schemaVersion as run-state schema 1."
  );
  assert.deepEqual(runStateContract.edges[0].proof, {
    invariant: "run-state 0 -> 1: adds defaults only, drops no existing key",
    addsDefaulted: ["schemaVersion"],
    dropsNothing: true,
  });
  const workflowAppContract = registry.contracts.find((c) => c.contract === "workflow-app");
  assert.equal(workflowAppContract.currentVersion, 1);
  assert.equal(workflowAppContract.minVersion, 1);
  assert.deepEqual(workflowAppContract.edges, []);
});
