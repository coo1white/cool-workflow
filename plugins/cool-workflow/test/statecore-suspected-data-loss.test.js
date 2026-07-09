#!/usr/bin/env node
// statecore-suspected-data-loss (robustness) — migrateRunState's
// suspectedDataLoss signal, and loadRunFromCwd's fail-closed refusal to
// silently load a wiped state.json as a fresh empty run when the run dir
// already has real content on disk.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { migrateRunState, reverseRunState } = require("../dist/core/state/migrations");
const { loadRunFromCwd } = require("../dist/shell/run-store");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

// A bare {} has neither workflow nor paths: suspectedDataLoss is true, even
// though it normalizes clean with no errors.
{
  const { report } = migrateRunState({});
  assert.equal(report.suspectedDataLoss, true, "{} must be flagged as suspected data loss");
  assert.equal(report.errors.length, 0, "a bare {} still normalizes with zero errors");
}

// A real run always has workflow AND paths together from creation onward:
// missing EITHER one (not just both) is a data-loss signal — a lone
// surviving key is not proof the rest of the file wasn't lost.
{
  assert.equal(migrateRunState({ workflow: {} }).report.suspectedDataLoss, true, "workflow alone (paths missing) must still be flagged");
  assert.equal(migrateRunState({ paths: {} }).report.suspectedDataLoss, true, "paths alone (workflow missing) must still be flagged");
  assert.equal(
    migrateRunState({ workflow: {}, paths: {}, tasks: [] }).report.suspectedDataLoss,
    false,
    "a normally-shaped run (both present) must not be flagged"
  );
}

// reverseRunState computes the same signal as migrateRunState, not a
// hardcoded false — it shares the same StateMigrationReport contract.
{
  assert.equal(reverseRunState({}, 1).report.suspectedDataLoss, true, "reverseRunState must flag {} same as migrateRunState");
  assert.equal(
    reverseRunState({ schemaVersion: 1, workflow: {}, paths: {} }, 1).report.suspectedDataLoss,
    false,
    "reverseRunState must clear the flag when both are present"
  );
}

// loadRunFromCwd: a wiped state.json next to real task content on disk is
// refused, not silently returned as a fresh run.
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-"));
  const runId = "demo-run";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const tasksDir = path.join(runDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "task-0001.json"), JSON.stringify({ id: "task-0001" }));
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({}));

  assert.throws(
    () => loadRunFromCwd(runId, cwd),
    /Refusing to load run demo-run.*state\.json is missing its core fields/s,
    "a wiped state.json next to real task content must be refused, not silently loaded"
  );

  fs.rmSync(cwd, { recursive: true, force: true });
}

// loadRunFromCwd: a bare {} state.json in an otherwise-EMPTY run dir (no
// content anywhere) is NOT refused — this is what a run whose creation
// crashed before writing anything else looks like, and it is
// indistinguishable from "nothing happened yet".
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-"));
  const runId = "fresh-run";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({}));

  const run = loadRunFromCwd(runId, cwd);
  assert.equal(run.id, runId, "an empty run dir with no other content must still load");

  fs.rmSync(cwd, { recursive: true, force: true });
}

// loadRunFromCwd: a run dir where every content sub-directory (including
// ones NOT in hasPreexistingRunContent's checked set, e.g. blackboard/
// candidates/topologies — deliberately excluded since a plain read
// populates those with cache/derived files, see hasPreexistingRunContent's
// own comment) EXISTS but is EMPTY (exactly what ensureRunDirs pre-creates
// for every real run at creation time) is also NOT refused — the "directory
// exists but is empty" branch, distinct from the ENOENT (missing dir)
// branch the "fresh-run" case above covers.
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-"));
  const runId = "just-created-run";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  for (const sub of ["tasks", "results", "dispatches", "artifacts", "commits", "nodes", "feedback", "audit", "workers", "candidates", "multi-agent", "blackboard", "topologies"]) {
    fs.mkdirSync(path.join(runDir, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({}));

  const run = loadRunFromCwd(runId, cwd);
  assert.equal(run.id, runId, "pre-created but still-empty content directories must not count as real content");

  fs.rmSync(cwd, { recursive: true, force: true });
}

// loadRunFromCwd: a wiped state.json next to a non-empty audit event log is
// also refused (commits/tasks dirs both absent this time).
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-"));
  const runId = "demo-run-audit";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const auditDir = path.join(runDir, "audit");
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, "events.jsonl"), `${JSON.stringify({ type: "demo" })}\n`);
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({}));

  assert.throws(
    () => loadRunFromCwd(runId, cwd),
    /Refusing to load run demo-run-audit/,
    "a wiped state.json next to a non-empty audit log must be refused"
  );

  fs.rmSync(cwd, { recursive: true, force: true });
}

// loadRunFromCwd: real content in commitsDir ALONE (tasksDir/auditDir both
// absent) is also enough to trigger the refusal — proves the commitsDir
// signal fires on its own, not just piggy-backing on the tasksDir check.
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-"));
  const runId = "demo-run-commits";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const commitsDir = path.join(runDir, "commits");
  fs.mkdirSync(commitsDir, { recursive: true });
  fs.writeFileSync(path.join(commitsDir, "commit-0001.json"), JSON.stringify({ id: "commit-0001" }));
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({}));

  assert.throws(
    () => loadRunFromCwd(runId, cwd),
    /Refusing to load run demo-run-commits/,
    "real content in commitsDir alone must trigger the refusal"
  );

  fs.rmSync(cwd, { recursive: true, force: true });
}

// loadRunFromCwd: incidental filesystem debris (a dot-prefixed file cw never
// writes, e.g. a stray .DS_Store) in an otherwise-empty content directory
// must NOT by itself make a genuinely fresh run look corrupted.
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-"));
  const runId = "demo-run-debris";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const tasksDir = path.join(runDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, ".DS_Store"), "");
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({}));

  const run = loadRunFromCwd(runId, cwd);
  assert.equal(run.id, runId, "dot-prefixed filesystem debris alone must not trigger the refusal");

  fs.rmSync(cwd, { recursive: true, force: true });
}

// End-to-end through the real CLI (cli/entry.ts's dispatch + top-level error
// formatting), not just a direct loadRunFromCwd call — proves the fix
// actually reaches `cw status <run-id>`, the exact surface named in the
// original repro story.
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-cli-"));
  const runId = "cli-demo-run";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const tasksDir = path.join(runDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "task-0001.json"), JSON.stringify({ id: "task-0001" }));
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({}));

  const result = spawnSync(process.execPath, [cli, "status", runId], { cwd, encoding: "utf8" });
  assert.equal(result.status, 1, "cw status on a wiped-but-content-bearing run must exit 1, not print a clean empty status");
  assert.match(result.stderr, /^cw: /, "the CLI's top-level error format must be used");
  assert.match(result.stderr, /Refusing to load run cli-demo-run/, "the specific data-loss refusal must reach the terminal, not a generic error");

  fs.rmSync(cwd, { recursive: true, force: true });
}

// Regression pin: a plain `cw status`/`cw graph` READ on a legitimate
// (not suspected-data-loss) run writes cache/derived files into audit/ and
// creates empty blackboard/candidates/topologies directories as a side
// effect (summarizeTrustAudit's audit/summary.json + index.json, in
// particular) — a SECOND read on that same run must not then start
// refusing to load it just because those caches now exist. Missing
// `paths` alone (real-world: an old/legacy state predating that field,
// exactly like this repo's own run-fixture-compat-smoke.js fixtures) must
// stay loadable across repeated reads.
{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-data-loss-cache-"));
  const runId = "legacy-no-paths-run";
  const runDir = path.join(cwd, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ workflow: {} })); // paths absent, like a real pre-`paths` legacy run

  const first = spawnSync(process.execPath, [cli, "status", runId], { cwd, encoding: "utf8" });
  assert.equal(first.status, 0, `first read of a legacy no-paths run must succeed: ${first.stderr}`);
  assert.ok(fs.existsSync(path.join(runDir, "audit", "summary.json")), "the read must really have written the audit cache (proves this test exercises the real hazard)");

  const second = spawnSync(process.execPath, [cli, "status", runId], { cwd, encoding: "utf8" });
  assert.equal(second.status, 0, `a second read, now with cache files present, must still succeed, not start refusing: ${second.stderr}`);

  fs.rmSync(cwd, { recursive: true, force: true });
}

process.stdout.write("statecore-suspected-data-loss: ok\n");
