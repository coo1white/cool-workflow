#!/usr/bin/env node
"use strict";

// registry-corrupt-state-distinct-error-smoke (robustness) — the run-registry
// single-run lookup path (RunRegistry.locate, backing `cw run show`/`archive`/
// `rerun`/`resume`) used to swallow EVERY reason a run's state.json failed to
// load (invalid JSON, an unsupported/future schemaVersion, or a wiped state.json
// still carrying real content) into the same "not found" outcome as a genuinely
// absent run — the exact repro this whole batch's original audit flagged.
// Asserts:
//   1. Genuinely missing state.json => still "not found" (unchanged, POLA).
//   2. Invalid JSON => a distinct error naming the JSON problem, not "not found".
//   3. An unsupported (future) schemaVersion => a distinct "corrupt" error.
//   4. A wiped state.json next to real task content => the suspected-data-loss
//      refusal (not a fabricated healthy record).
//   5. Bulk scans (search/list) stay tolerant: one corrupt run among several
//      healthy ones is silently excluded, the others still list fine.
//   6. End-to-end through the real CLI: `cw run show`/`cw run resume` surface
//      the distinct reason instead of "not found".

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const { RunRegistry } = require(path.join(pluginRoot, "dist", "shell", "run-registry-io.js"));
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-registry-corrupt-")));

function makeRun(runId) {
  const runDir = path.join(repo, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);
  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cwd: repo,
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
  return { run, runDir, statePath: paths.state };
}

// ---- 1. genuinely missing: still "not found", unchanged (POLA) ------------
{
  const reg = new RunRegistry(repo);
  const located = reg.locate("never-existed-run", "repo");
  assert.equal(located, undefined, "a run id that never existed must resolve to undefined, same as before");
  const show = reg.showRun("never-existed-run");
  assert.equal(show.found, false, "cw run show of a never-existed run must report found:false");
}

// ---- 2. invalid JSON: a distinct error, not "not found" -------------------
{
  const { statePath } = makeRun("corrupt-json-run");
  fs.writeFileSync(statePath, "{ not valid json truncated");
  const reg = new RunRegistry(repo);
  assert.throws(
    () => reg.locate("corrupt-json-run", "repo"),
    /Invalid JSON in .*state\.json/,
    "invalid JSON must surface the real parse error, not swallow to not-found"
  );
}

// ---- 3. unsupported (future) schemaVersion: a distinct "corrupt" error -----
{
  const { run, statePath } = makeRun("future-schema-run");
  const future = { ...run, schemaVersion: 99 };
  fs.writeFileSync(statePath, JSON.stringify(future));
  const reg = new RunRegistry(repo);
  assert.throws(
    () => reg.locate("future-schema-run", "repo"),
    /Run state for future-schema-run is corrupt \(fail closed\).*newer than this CW runtime/s,
    "a future schemaVersion must surface as a distinct corrupt-state error"
  );
}

// ---- 4. wiped state.json next to real task content: suspected-data-loss ---
{
  const { runDir, statePath } = makeRun("wiped-run");
  fs.writeFileSync(path.join(runDir, "tasks", "task-0001.json"), JSON.stringify({ id: "task-0001" }));
  fs.writeFileSync(statePath, JSON.stringify({}));
  const reg = new RunRegistry(repo);
  assert.throws(
    () => reg.locate("wiped-run", "repo"),
    /Refusing to load run wiped-run/,
    "a wiped state.json next to real task content must be refused, not silently shown as a fresh run"
  );
}

// ---- 5. bulk scans stay tolerant: one bad run doesn't break the listing ---
{
  makeRun("healthy-run-1");
  makeRun("healthy-run-2");
  const reg = new RunRegistry(repo);
  const results = reg.search({ scope: "repo" });
  const ids = results.records.map((r) => r.runId);
  assert.ok(ids.includes("healthy-run-1"), "a healthy run must still be listed");
  assert.ok(ids.includes("healthy-run-2"), "a second healthy run must still be listed");
  assert.ok(!ids.includes("corrupt-json-run"), "the corrupt-JSON run must be silently excluded from bulk listings, not throw");
  assert.ok(!ids.includes("future-schema-run"), "the unsupported-schema run must be silently excluded from bulk listings");
  assert.ok(!ids.includes("wiped-run"), "the suspected-data-loss run must be silently excluded from bulk listings");
}

// ---- 6. end-to-end through the real CLI ------------------------------------
{
  const showResult = spawnSync(node, [cli, "run", "show", "corrupt-json-run"], { cwd: repo, encoding: "utf8" });
  assert.equal(showResult.status, 1, "cw run show on a corrupt run must exit 1, not report a clean not-found");
  assert.match(showResult.stderr, /Invalid JSON in .*state\.json/, "the CLI must surface the real corruption reason");

  const resumeResult = spawnSync(node, [cli, "run", "resume", "future-schema-run"], { cwd: repo, encoding: "utf8" });
  assert.equal(resumeResult.status, 1, "cw run resume on an unsupported-schema run must exit 1");
  assert.match(resumeResult.stderr, /Run state for future-schema-run is corrupt/, "the CLI must surface the distinct corrupt-state reason for resume too");

  // A genuinely healthy run's show/resume are unaffected.
  const healthyShow = JSON.parse(execFileSync(node, [cli, "run", "show", "healthy-run-1", "--json"], { cwd: repo, encoding: "utf8" }));
  assert.equal(healthyShow.found, true, "a healthy run must still show found:true end to end");
}

// ---- 7. regression: state.json deleted between the two internal reads -----
// (adversarial review finding) deriveRecordForRun's fallback re-read must
// not let a genuine "File not found" race surface as a raw, scary
// exception — a run that disappears mid-lookup is genuinely missing, same
// as everywhere else, not a corruption to report.
{
  const { statePath } = makeRun("race-deleted-run");
  const reg = new RunRegistry(repo);
  const origDeriveRecord = RunRegistry.prototype["deriveRecord"];
  let first = true;
  RunRegistry.prototype["deriveRecord"] = function (...callArgs) {
    if (first) {
      first = false;
      // Simulate deriveRecord's own internal read racing with a concurrent
      // delete: return null as if it failed, then remove the file before
      // the fallback re-read runs.
      fs.rmSync(statePath, { force: true });
      return null;
    }
    return origDeriveRecord.apply(this, callArgs);
  };
  try {
    const located = reg.locate("race-deleted-run", "repo");
    assert.equal(located, undefined, "a state.json deleted mid-lookup must resolve to not-found, not throw");
  } finally {
    RunRegistry.prototype["deriveRecord"] = origDeriveRecord;
  }
}

// ---- 8. regression: archive() no longer crashes on a race-widened null ----
// (adversarial review finding) archive()'s re-fetch after locate() used a
// bare non-null assertion; suspected-data-loss corroboration (added in the
// previous cycle) gave deriveRecord a NEW way to return null, widening that
// crash surface. Must now throw a clear message, never a raw TypeError.
{
  const runId = "archive-race-run";
  const { run } = makeRun(runId);
  fs.writeFileSync(path.join(run.paths.tasksDir, "task-0001.json"), JSON.stringify({ id: "task-0001" }));
  const reg = new RunRegistry(repo);
  const origLocate = RunRegistry.prototype["locate"];
  RunRegistry.prototype["locate"] = function (...callArgs) {
    const result = origLocate.apply(this, callArgs);
    // Wipe state.json AFTER locate() already succeeded, real task content
    // still on disk -- exactly the narrow race window between locate()
    // and archive()'s own re-fetch.
    fs.writeFileSync(run.paths.state, JSON.stringify({}));
    return result;
  };
  try {
    assert.throws(
      () => reg.archive(runId, {}),
      /Refusing to load run archive-race-run/,
      "archive() racing with a concurrent wipe must throw a clear message, not a raw TypeError from a null record"
    );
  } finally {
    RunRegistry.prototype["locate"] = origLocate;
  }
}

fs.rmSync(repo, { recursive: true, force: true });
process.stdout.write("registry-corrupt-state-distinct-error-smoke: ok\n");
