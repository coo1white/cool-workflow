"use strict";
// eval-replay-stale-cache-smoke — regression guard for the self-audit's
// "eval-replay's staleness check is a path-equality comparison that is
// vacuously true on every rerun" P1 finding
// (examples/audits/self-audit-cool-workflow-v0.2.6.md).
//
// replay-run.json lives at a FIXED, deterministic path per suite
// (suiteDir/replay-run.json) — replaying twice always overwrites the same
// file. loadOrCompareForTarget/loadScoreForTarget (shell/eval-io.ts) used
// to decide a cached comparison/score was still fresh by checking
// comparison.paths.replayPath === replayPath, which is true for ANY two
// replays of the same suite regardless of content. So: score a suite once
// (pass), mutate the raw baseline so a rerun's replay reflects a real
// regression, replay again (overwrites replay-run.json in place), then
// score AGAIN *without* an explicit `eval compare` in between — the exact
// cache-hit path neither eval-replay-happy-path.case.js nor eval-replay-
// detects-drift.case.js exercises (both always call `eval compare`
// explicitly right before `eval score`). Before the fix this silently
// returned the OLD "pass" score/comparison; after it, the content
// fingerprint forces a fresh compare and the regression is caught.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const distDir = process.env.CW_TEST_DIST_DIR || path.join(pluginRoot, "dist");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(distDir, "shell", "run-store.js"));
const evalMod = require(path.join(distDir, "shell", "eval-io.js"));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-eval-stale-cache-")));

const paths = createRunPaths(path.join(tmp, ".cw", "runs", "stale-smoke"));
ensureRunDirs(paths);

const run = {
  schemaVersion: 1,
  id: "stale-smoke",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  cwd: tmp,
  workflow: { id: "stale-smoke", title: "Stale Cache Smoke", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: {},
  loopStage: "observe",
  phases: [],
  tasks: [],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  workers: [{ id: "w1", taskId: "t1", status: "completed" }]
};
saveCheckpoint(run); // writes state.json — the raw captured state replay re-derives from

// 1. Snapshot the healthy baseline, replay it (content X — matches
// baseline), and score it. No comparison.json exists yet, so this is a
// genuine first compare: pass.
const snapshot = evalMod.createMultiAgentReplaySnapshot(run, { id: "stale-suite" });
const firstReplay = evalMod.replayMultiAgentSnapshot(snapshot.paths.snapshotPath);
const firstScore = evalMod.scoreMultiAgentReplay(firstReplay.paths.replayRunPath);
assert.equal(firstScore.status, "pass", "sanity: an unmutated replay scores pass");

// 2. Mutate the RAW baseline state (a worker now fails) — the source the
// re-derivation reads, same technique as eval-replay-detects-drift.case.js
// / multi-agent-eval-determinism-regression-smoke.js.
const rawState = JSON.parse(fs.readFileSync(snapshot.paths.baselineStatePath, "utf8"));
rawState.workers[0].status = "failed";
fs.writeFileSync(snapshot.paths.baselineStatePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

// 3. Replay AGAIN on the SAME suite — this overwrites the SAME
// replay-run.json path with genuinely different content (content Y,
// reflecting the mutated baseline).
const secondReplay = evalMod.replayMultiAgentSnapshot(snapshot.paths.snapshotPath);
assert.equal(secondReplay.paths.replayRunPath, firstReplay.paths.replayRunPath, "sanity: both replays land at the SAME fixed path — this is the bug's precondition");
assert.notDeepEqual(secondReplay.replay.failures, firstReplay.replay.failures, "sanity: the second replay's re-derived projection really does differ from the first");

// 4. Score again *without* an explicit `eval compare` — this is the
// cache-hit path. The comparison.json written in step 1 still sits on
// disk with the SAME comparison.paths.replayPath (the path never
// changes); only its CONTENT is now stale.
const secondScore = evalMod.scoreMultiAgentReplay(secondReplay.paths.replayRunPath);
assert.equal(
  secondScore.status,
  "fail",
  "a rerun of `eval replay` that reflects a real regression must be re-scored, not served from a path-equal but content-stale cache"
);
assert.ok(secondScore.findings.length > 0, "the re-detected regression must produce at least one finding");
assert.ok(
  secondScore.findings.some((entry) => entry.category === "failures"),
  "the regression is attributed to the failures section (the mutated worker)"
);

// 5. The gate must agree: re-checking it after the second score must also
// hold, not ship on stale evidence.
evalMod.reportMultiAgentEval(secondReplay.paths.replayRunPath);
const gate = evalMod.gateMultiAgentEval(snapshot.paths.suiteDir);
assert.equal(gate.verdict, "hold", "the gate must hold once the re-detected regression is on record, not ship on a stale pass");

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("eval-replay-stale-cache-smoke: ok (rerun-without-explicit-compare correctly re-detects a real regression)\n");
