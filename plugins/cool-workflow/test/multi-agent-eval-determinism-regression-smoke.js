"use strict";
// multi-agent-eval-determinism-regression-smoke (F1).
//
// Guards the determinism MOAT against a false-green that used to live in
// replayMultiAgentSnapshot: it set `replay = snapshot.normalized`, i.e. it
// COPIED the baseline projection instead of RE-DERIVING it from the raw
// captured state. compareMultiAgentReplay then diffed the baseline against a
// byte-copy of itself, so a projection-determinism regression in normalizeRun
// could never surface — the eval would pass no matter what the projection did.
//
// The fix re-derives: replay re-loads the baseline run state file (the raw
// captured state) and re-runs the SAME normalizeRun pipeline, producing an
// INDEPENDENT re-projection. This smoke proves that independence two ways:
//   1. CLEAN: an untouched baseline replays + compares to a MATCH.
//   2. REGRESSION: deterministically mutating the captured raw state (the
//      source the projection reads) before replay makes the re-derived
//      projection diverge from the baseline, and compare reports a MISMATCH.
//      A pure copy of the baseline could NOT catch this — the mutation never
//      touches snapshot.normalized — so the mismatch is exactly the signal
//      that the projection is now re-derived, not copied.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const distDir = process.env.CW_TEST_DIST_DIR || path.join(pluginRoot, "dist");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(distDir, "state.js"));
const evalMod = require(path.join(distDir, "multi-agent-eval.js"));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-ma-eval-determinism-")));

// Build a real run with multi-agent role state that flows into the projection
// (normalizeRun projects run.multiAgent.roles into normalized.roles verbatim).
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "det-smoke"));
ensureRunDirs(paths);

function role(id, title) {
  return {
    schemaVersion: 1,
    id,
    runId: "det-smoke",
    multiAgentRunId: "det-ma",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    status: "active",
    title,
    responsibilities: [],
    requiredEvidence: [],
    sandboxProfileHints: [],
    expectedArtifacts: [],
    faninObligations: [],
    lifecycle: [],
    childRoleIds: []
  };
}

const run = {
  schemaVersion: 1,
  id: "det-smoke",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  cwd: tmp,
  workflow: { id: "det-smoke", title: "Determinism Smoke", summary: "", limits: { maxAgents: 2, maxConcurrentAgents: 1 } },
  inputs: {},
  loopStage: "observe",
  phases: [],
  tasks: [],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  multiAgent: {
    schemaVersion: 1,
    runs: [],
    roles: [role("det-role-1", "Reviewer One"), role("det-role-2", "Reviewer Two")],
    groups: [],
    memberships: [],
    fanouts: [],
    fanins: []
  }
};
saveCheckpoint(run); // writes state.json — the raw captured state replay re-derives from

// Capture the snapshot from the live run (mirrors `eval snapshot`).
const snapshot = evalMod.createMultiAgentReplaySnapshot(run, { id: "det-suite" });
assert.equal(snapshot.runId, "det-smoke", "snapshot captured the run");
assert.ok(snapshot.normalized.roles.length >= 2, "baseline projection carries the two roles");
assert.ok(snapshot.normalized.roles.some((line) => line.includes("Reviewer One")), "baseline roles projection is non-trivial");

// 1. CLEAN re-derivation matches the baseline.
const cleanReplay = evalMod.replayMultiAgentSnapshot(snapshot.paths.snapshotPath, { id: "det-suite-replay-clean" });
assert.equal(cleanReplay.status, "completed", "clean replay completes");
// Prove the replay is a genuine re-projection, not a frozen baseline copy: the
// roles section is structurally identical to the baseline yet computed afresh.
assert.deepEqual(cleanReplay.replay.roles, snapshot.normalized.roles, "clean re-derivation reproduces the baseline roles");
const cleanCompare = evalMod.compareMultiAgentReplay(snapshot.paths.snapshotPath, cleanReplay.paths.replayRunPath);
assert.equal(cleanCompare.status, "pass", "clean run compares to MATCH");
assert.equal(cleanCompare.findings.length, 0, "clean run has no regression findings");
assert.equal(cleanCompare.sections.roles.status, "pass", "clean run roles section matches");

// 2. INJECT a projection-determinism regression into the RAW captured state.
// Mutating the state file the re-derivation reads (NOT snapshot.normalized)
// must change the independent re-projection and therefore the comparison. A
// copy-the-baseline implementation would silently still pass here.
const statePath = snapshot.paths.baselineStatePath;
const rawState = JSON.parse(fs.readFileSync(statePath, "utf8"));
assert.ok(Array.isArray(rawState.multiAgent.roles) && rawState.multiAgent.roles.length >= 1, "raw state holds the captured roles");
rawState.multiAgent.roles[0].title = "Reviewer One MUTATED"; // deterministic projection-affecting drift
fs.writeFileSync(statePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

const regressedReplay = evalMod.replayMultiAgentSnapshot(snapshot.paths.snapshotPath, { id: "det-suite-replay-regressed" });
assert.equal(regressedReplay.status, "completed", "regressed replay still completes (it is a re-derivation, not a crash)");
assert.notDeepEqual(
  regressedReplay.replay.roles,
  snapshot.normalized.roles,
  "re-derivation diverges from the baseline once the captured projection source is mutated"
);
const regressedCompare = evalMod.compareMultiAgentReplay(snapshot.paths.snapshotPath, regressedReplay.paths.replayRunPath);
assert.equal(regressedCompare.status, "fail", "projection-determinism regression is CAUGHT (compare reports a MISMATCH)");
assert.ok(
  regressedCompare.findings.some((entry) => entry.category === "roles"),
  "the mismatch is attributed to the mutated roles projection section"
);
assert.equal(regressedCompare.sections.roles.status, "fail", "roles section reports fail under the injected determinism bug");

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("multi-agent-eval-determinism-regression-smoke: ok (replay re-derives the projection; clean=match, injected-determinism-bug=mismatch)\n");
