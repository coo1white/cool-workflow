#!/usr/bin/env node
// reclamationio-log-failclosed — pins the fail-closed reading of a corrupt
// reclaimed.json (fix feeb1b15): loadReclamationLog marks it corrupted,
// buildTombstone/runReclamation refuse to write over it, verifyReclamation
// reports it as its own state (not "not-reclaimed"), reclaimEligibility
// checks the corrupted mark FIRST, and gcPlan/gcRun turn every refusal into
// a listed reason — never a delete.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  loadReclamationLog,
  reclaimedLogPath,
  extractSkeleton,
  planReclamation,
  buildTombstone,
  runReclamation,
  verifyReclamation,
  reclaimEligibility,
  reclamationPolicy,
  gcPlan,
  gcRun,
  ReclamationError,
} = require("../dist/shell/reclamation-io");
const { DEFAULT_RUN_REGISTRY_POLICY } = require("../dist/shell/run-registry-io");
const { writeJson } = require("../dist/shell/fs-atomic");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-reclaim-fc-"));

// A minimal run on disk: one completed task whose result is kept in the
// run dir, one worker scratch dir with bytes to free, one node pointing at
// the kept result.
function makeRun(name) {
  const runDir = path.join(tmp, name);
  const workerDir = path.join(runDir, "workers", "w1");
  const resultPath = path.join(runDir, "results", "t1.md");
  fs.mkdirSync(workerDir, { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(path.join(workerDir, "scratch.txt"), "scratch bytes to free\n");
  fs.writeFileSync(resultPath, "the kept result\n");
  const run = {
    schemaVersion: 1,
    id: name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    loopStage: "act",
    workflow: { id: "wf-demo", title: "demo" },
    inputs: {},
    paths: { runDir, state: path.join(runDir, "state.json") },
    tasks: [{ id: "t1", phase: "p1", status: "completed", resultPath, resultNodeId: "n1" }],
    phases: [],
    nodes: [{ id: "n1", artifacts: [{ id: "result", path: resultPath }], evidence: [] }],
    commits: [],
    dispatches: [],
    workers: [{ workerDir, taskId: "t1", resultNodeId: "n1" }],
    feedback: [],
  };
  writeJson(run.paths.state, run, { durable: true });
  return run;
}

// --- loadReclamationLog: absent is "never reclaimed" (no corrupted mark);
// bad bytes/shapes are corrupted=true with zero tombstones.
{
  const run = makeRun("log-read");
  const clean = loadReclamationLog(run);
  assert.deepEqual(clean, { schemaVersion: 1, runId: "log-read", tombstones: [] });
  assert.ok(!("corrupted" in clean), "absent must not carry the corrupted mark");

  for (const bad of ['{"schemaVersion":1,"tomb', "[]", "null", JSON.stringify({ schemaVersion: 2, tombstones: [] })]) {
    fs.writeFileSync(reclaimedLogPath(run), bad, "utf8");
    const overlay = loadReclamationLog(run);
    assert.equal(overlay.corrupted, true, `corrupted for: ${bad.slice(0, 20)}`);
    assert.deepEqual(overlay.tombstones, [], "never invent tombstones");
  }
}

// --- buildTombstone over a corrupt log: refuse with the exact code, and
// leave the broken bytes AND the run's files exactly as they were.
{
  const run = makeRun("build-refuse");
  const logFile = reclaimedLogPath(run);
  fs.writeFileSync(logFile, '{"half":', "utf8");
  const skeleton = extractSkeleton(run);
  const plan = planReclamation(run);
  assert.ok(plan.freeable.length > 0, "the plan does find scratch to free (the refusal is not vacuous)");

  let thrown;
  try {
    buildTombstone(run, skeleton, plan);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ReclamationError, "a ReclamationError, not a plain Error");
  assert.equal(thrown.code, "reclamation-log-corrupted");
  assert.ok(thrown.message.includes(logFile), "the message names the log file");
  assert.equal(fs.readFileSync(logFile, "utf8"), '{"half":', "the broken log is NOT overwritten");

  // The full transaction refuses the same way, and frees nothing.
  assert.throws(
    () => runReclamation(run),
    (error) => error instanceof ReclamationError && error.code === "reclamation-log-corrupted"
  );
  assert.ok(fs.existsSync(path.join(run.paths.runDir, "workers", "w1", "scratch.txt")), "no byte was freed");
  assert.equal(fs.readFileSync(logFile, "utf8"), '{"half":', "the broken log is still untouched");
}

// --- verifyReclamation: a corrupt log is its OWN verify state — never the
// same reading as an honest empty log.
{
  const run = makeRun("verify-corrupt");
  const empty = verifyReclamation(run);
  assert.equal(empty.reclaimed, false);
  assert.equal(empty.checks[0].code, "not-reclaimed", "an absent log reads as not reclaimed");

  fs.writeFileSync(reclaimedLogPath(run), "{ bad", "utf8");
  const corrupt = verifyReclamation(run);
  assert.equal(corrupt.reclaimed, false);
  assert.equal(corrupt.verified, false);
  assert.equal(corrupt.checks[0].code, "reclamation-log-corrupted", "a corrupt log is reported as corrupt, not as not-reclaimed");
}

// --- reclaimEligibility: the refusal ladder, in order. The corrupted mark
// comes FIRST — ahead even of already-reclaimed, because a corrupt log
// makes tier itself unreliable.
{
  const policy = reclamationPolicy();
  assert.equal(policy.reclaimAfterArchiveDays, DEFAULT_RUN_REGISTRY_POLICY.reclaimAfterArchiveDays);
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  const good = {
    runId: "r",
    derivedLifecycle: "completed",
    openFeedbackCount: 0,
    archived: true,
    archivedAt: "2026-01-01T00:00:00.000Z",
    tier: "live",
  };
  assert.equal(reclaimEligibility(good, policy, now), null, "the base record is eligible");
  assert.equal(
    reclaimEligibility({ ...good, reclamationLogCorrupted: true, tier: "reclaimed" }, policy, now),
    "reclamation-log-corrupted",
    "the corrupted mark wins over every other reading, tier included"
  );
  assert.equal(reclaimEligibility({ ...good, tier: "reclaimed" }, policy, now), "already-reclaimed");
  assert.equal(reclaimEligibility({ ...good, derivedLifecycle: "running" }, policy, now), "non-terminal");
  assert.equal(
    reclaimEligibility({ ...good, derivedLifecycle: "failed" }, reclamationPolicy({ reclaimStates: ["completed"] }), now),
    "non-terminal",
    "a terminal state outside reclaimStates is refused"
  );
  assert.equal(reclaimEligibility({ ...good, openFeedbackCount: 1 }, policy, now), "open-feedback");
  assert.equal(reclaimEligibility({ ...good, archived: false }, policy, now), "not-archived");

  const retention = reclamationPolicy({ reclaimAfterArchiveDays: 30 });
  assert.equal(
    reclaimEligibility({ ...good, archivedAt: "2026-05-30T00:00:00.000Z" }, retention, now),
    "within-retention",
    "archived too recently"
  );
  assert.equal(
    reclaimEligibility({ ...good, archivedAt: undefined }, retention, now),
    "within-retention",
    "no archive time reads as within retention (the safe side)"
  );
  assert.equal(reclaimEligibility({ ...good, archivedAt: "not-a-date" }, retention, now), "within-retention");
  assert.equal(
    reclaimEligibility({ ...good, archivedAt: "2026-01-01T00:00:00.000Z" }, retention, now),
    null,
    "old enough: eligible"
  );
}

// --- gcPlan/gcRun through a fake GcHost: every refusal becomes a listed
// reason with zero freeable bytes; an unreadable run is "unreadable"; and
// gcRun deletes nothing when everything is refused.
{
  const run = makeRun("gc-host");
  const record = (runId, extra) => ({
    runId,
    repo: tmp,
    derivedLifecycle: "completed",
    openFeedbackCount: 0,
    archived: true,
    archivedAt: "2026-01-01T00:00:00.000Z",
    tier: "live",
    ...extra,
  });
  const records = [
    record("gc-host", { reclamationLogCorrupted: true }),
    record("not-archived-run", { archived: false }),
    record("unreadable-run"),
  ];
  const host = {
    buildIndex: () => ({ records }),
    locate: () => undefined,
    loadRun: (repo, runId) => {
      if (runId === "unreadable-run") throw new Error("cannot read this run");
      return run;
    },
  };

  const plan = gcPlan(host, { now: "2026-06-01T00:00:00.000Z" });
  assert.equal(plan.total, 3);
  assert.equal(plan.eligibleCount, 0);
  assert.equal(plan.bytesToFree, 0);
  const reasons = Object.fromEntries(plan.entries.map((e) => [e.runId, e.reason]));
  assert.equal(reasons["gc-host"], "reclamation-log-corrupted");
  assert.equal(reasons["not-archived-run"], "not-archived");
  assert.equal(reasons["unreadable-run"], "unreadable");
  for (const entry of plan.entries) {
    assert.equal(entry.eligible, false);
    assert.deepEqual(entry.freeable, [], "a refused run lists no freeable paths");
  }
  assert.equal(plan.nextAction, "cw run search", "nothing eligible: no gc run suggested");

  const result = gcRun(host, { now: "2026-06-01T00:00:00.000Z" });
  assert.deepEqual(result.reclaimed, [], "nothing reclaimed");
  assert.equal(result.totalBytesFreed, 0);
  assert.deepEqual(
    result.refused.map((r) => `${r.runId}:${r.code}`).sort(),
    ["gc-host:reclamation-log-corrupted", "not-archived-run:not-archived", "unreadable-run:unreadable"].sort()
  );
  assert.ok(fs.existsSync(path.join(run.paths.runDir, "workers", "w1", "scratch.txt")), "gcRun freed nothing");
}

process.stdout.write("reclamationio-log-failclosed: ok\n");
