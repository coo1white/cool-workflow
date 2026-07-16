#!/usr/bin/env node
"use strict";

// worker-off-target-smoke: a repo-review worker (a task with reviewsRepo) must
// cite the repository's own source, not CW's run workspace. recordWorkerOutput
// fails closed (worker-off-target) when at least half of its ON-DISK file
// evidence resolves under CW's own run workspace (.cw/runs, .cw/context,
// .cw/cache), excluding the handed source-context bundle. The guard is opt-in,
// counts only files that exist (no fabricated-path padding), and matches CW's
// specific workspace dirs so a target repo that versions its own .cw/ as source
// is not mistaken for run state.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/shell/run-store");
const { allocateWorkerScope, recordWorkerOutput } = require("../dist/shell/worker-isolation");

function makeRun(tmp, paths, taskId, reviewsRepo) {
  return {
    schemaVersion: 1, id: "offtarget-smoke", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    cwd: tmp, workflow: { id: "offtarget-smoke", title: "", summary: "", limits: { maxAgents: 4, maxConcurrentAgents: 4 } },
    inputs: {}, loopStage: "interpret",
    phases: [{ id: "assess", name: "Assess", status: "pending", taskIds: [taskId] }],
    tasks: [{
      id: taskId, kind: "agent", phase: "Assess", status: "pending", requiresEvidence: true,
      prompt: "assess the repo", taskPath: "", resultPath: "", loopStage: "interpret",
      stateNodeId: `offtarget-smoke:task:${taskId}`, ...(reviewsRepo ? { reviewsRepo: true } : {})
    }],
    dispatches: [], commits: [], paths, nodes: [], contracts: [], feedback: [], workers: []
  };
}

function resultMd(evidence) {
  return ["# Assessment", "", "Findings.", "", "```cw:result", JSON.stringify({ summary: "assessed", findings: [], evidence }), "```", ""].join("\n");
}

// Create every cited file under the run cwd so resolve-on-disk sees it; leave a
// locator out of `create` to simulate a fabricated (non-resolving) path.
function record(evidence, workerId, { reviewsRepo = true, create = evidence } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-offtarget-")));
  const paths = createRunPaths(path.join(tmp, ".cw", "runs", "offtarget-smoke"));
  ensureRunDirs(paths);
  for (const loc of create) {
    const rel = String(loc).replace(/^file:(\/\/)?/, "").split(/[:#]/)[0];
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x\n", "utf8");
  }
  const run = makeRun(tmp, paths, "assess:speed", reviewsRepo);
  saveCheckpoint(run);
  const scope = allocateWorkerScope(run, run.tasks[0], { workerId, persist: false });
  fs.writeFileSync(scope.resultPath, resultMd(evidence), "utf8");
  return { run, workerId, resultPath: scope.resultPath, tmp };
}

function expectReject(ctx) {
  let err;
  try { recordWorkerOutput(ctx.run, ctx.workerId, ctx.resultPath, { persist: false }); } catch (e) { err = e; }
  assert.ok(err, "expected worker-off-target rejection");
  assert.match(err.message, /run workspace under \.cw\/|off-target/i, "the failure names the off-target subject swap");
  assert.ok(ctx.run.feedback.length > 0, "the off-target failure is durable feedback (flagged, not silent)");
}
function expectAccept(ctx, why) {
  const out = recordWorkerOutput(ctx.run, ctx.workerId, ctx.resultPath, { persist: false });
  assert.equal(out.workerId, ctx.workerId, why);
  assert.equal(ctx.run.tasks[0].status, "completed", why);
}

const CW_STATE = [
  ".cw/runs/r/state.json:44", ".cw/runs/r/results/map.md:5",
  ".cw/runs/r/dispatches/d.json:12", ".cw/context/repo-source-profile.json:6"
];

// --- Off-target: a reviewsRepo task, majority CW run-state evidence, rejected ---
expectReject(record([...CW_STATE, "src/one.ts:3"], "w-off", { reviewsRepo: true }));

// --- Opt-in: the SAME evidence on a NON-review task (no reviewsRepo) is accepted ---
expectAccept(record([...CW_STATE, "src/one.ts:3"], "w-preflight", { reviewsRepo: false }),
  "a non-repo-review task may legitimately cite .cw/ run state");

// --- On-target: repository source dominates; a lone bundle citation is neutral ---
expectAccept(record(["src/a.ts:1", "src/b.ts:2", "lib/c.js:3", ".cw/context/repo-source.jsonl:1"], "w-on"),
  "a worker citing the repository's own source is accepted");

// --- False positive fixed: a target that versions its OWN .cw/ as source (not
//     runs/context/cache) is NOT mistaken for run state ---
expectAccept(record([".cw/config.json:1", ".cw/profiles/default.json:3", ".cw/templates/review.md:10"], "w-target-cw"),
  "a target repo's own tracked .cw/ source is not off-target");

// --- Padding fixed: fabricated (non-resolving) repo paths cannot dilute; only
//     the real .cw/ files resolve, so the swap is still caught ---
expectReject(record([...CW_STATE, "src/ghost1.ts:1", "src/ghost2.ts:1", "src/ghost3.ts:1", "src/ghost4.ts:1"],
  "w-pad", { reviewsRepo: true, create: CW_STATE }));

// --- Bundle laundering fixed: many bundle citations are neutral, not dilutive ---
expectReject(record([
  ".cw/runs/r/state.json:1", ".cw/runs/r/state.json:2",
  ".cw/context/repo-source.jsonl:1", ".cw/context/repo-source.jsonl:2", ".cw/context/repo-source.jsonl:3"
], "w-launder", { reviewsRepo: true, create: [".cw/runs/r/state.json", ".cw/context/repo-source.jsonl"] }));

process.stdout.write("worker-off-target-smoke: ok\n");
