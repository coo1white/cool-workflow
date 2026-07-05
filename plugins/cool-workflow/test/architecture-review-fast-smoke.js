#!/usr/bin/env node
"use strict";

// ===================================================================================
// AUDIT STATUS: REAL-GAP (imports repointed to v2; behavior itself is missing).
// -----------------------------------------------------------------------------------
// Imports below are the correct v2 locations and the plan + drive flow runs cleanly,
// so the failure is NOT an import crash. Plan shape (14 full tasks, 6 fast tasks,
// Map/Assess parallel + Verify/Verdict sequential), model routing (fast-map-model /
// strong-verify-model), source-context/digest in prompts, and drive-to-completion
// (2 Map workers per --once round, 6 workers total, commitId set) all still hold.
//
// The gap: v2 DROPS the per-phase resultCache policy at run materialization. The app
// DSL apps/architecture-review-fast/workflow.js:62-128 still attaches
//   resultCache: { mode:"read-write", keyInput:"sourceContextDigest",
//                  includeCompletedResults:"previous-phases" }  (Assess/Verify/Verdict)
// to every task, but v2's flattenTasks (src/shell/pipeline.ts:57-71) copies only
// id/kind/phase/prompt/label/model/agentType onto each RunTask and NEVER copies
// task.resultCache. So the materialized task has resultCache === undefined (confirmed
// live: every byTask.get(...).resultCache is undefined), failing the plan-level
// resultCache assertions. Downstream, src/shell/drive.ts:157 resultCachePath() reads
// task.resultCache, finds none, and short-circuits — so warm re-runs never produce
// handleKind === "result-cache" hits, failing the cache-hit assertions too.
// (Same gap fails the sibling architecture-review-fast-phase-cache-smoke.)
// Phase B fix belongs in v2 src: flattenTasks must carry task.resultCache onto the
// RunTask. Left failing on purpose — do NOT weaken the assertions to force green.
// ===================================================================================

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
// v2 dismantled the CoolWorkflowRunner facade. The old build's
// runner.plan(appId, inputs) + drive(runner, runId, opts) split into free
// functions: shell/workflow-app-loader.loadWorkflowApp(appId) resolves the
// built-in app, shell/pipeline.plan(loadedApp, inputs) makes the run, and
// shell/drive.drive(runId, cwd, opts) drives it.
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));

// v2 helper: runner.plan(appId, inputs) -> plan(loadWorkflowApp(appId), inputs).
function planApp(appId, inputs) {
  return plan(loadWorkflowApp(appId), inputs);
}

const FIXED_NOW = "2026-06-13T00:00:00.000Z";
const cleanups = [];

function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-arch-fast-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  fs.writeFileSync(path.join(work, "server.js"), "module.exports = function server() { return 'ok'; };\n", "utf8");
  cleanups.push(work);
  return work;
}

function writeStub(file, model) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    "const countPath = process.argv[3];",
    "if (countPath) fs.appendFileSync(countPath, 'spawn\\n');",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    `process.stdout.write(JSON.stringify({ model: ${JSON.stringify(model)}, usage: { input_tokens: 4, output_tokens: 2 } }));`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function agentConfig(stub, countFile) {
  return { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}", countFile], model: "operator-default", source: "flag" };
}

function main() {
  const priorFast = process.env.CW_ARCHITECTURE_REVIEW_FAST_MODEL;
  const priorStrong = process.env.CW_ARCHITECTURE_REVIEW_STRONG_MODEL;
  process.env.CW_ARCHITECTURE_REVIEW_FAST_MODEL = "fast-map-model";
  process.env.CW_ARCHITECTURE_REVIEW_STRONG_MODEL = "strong-verify-model";

  const cwd0 = process.cwd();
  const work = tmpWorkspace();
  const sourceContext = path.join(work, "core-source.jsonl");
  fs.writeFileSync(
    sourceContext,
    `${JSON.stringify({ schemaVersion: 1, profile: "core", path: "README.md", included: true, content: "# target\n" })}\n`,
    "utf8"
  );
  const stub = writeStub(path.join(work, "stub.js"), "stub-agent/fast-review");
  const spawnCount = path.join(work, "spawn-count.txt");
  process.chdir(work);

  try {
    const full = planApp("architecture-review", { repo: work, question: "Is the full app unchanged?" });
    const fast = planApp("architecture-review-fast", {
      repo: work,
      question: "Can a user get a fast architecture answer?",
      invariant: ["existing architecture-review behavior stays unchanged"],
      focus: "runtime speed",
      sourceContext,
      sourceContextDigest: "sha256:smoke"
    });

    assert.equal(full.tasks.length, 14, "the full architecture-review app keeps its existing task count");
    assert.equal(fast.workflow.id, "architecture-review-fast");
    assert.equal(fast.workflow.app.id, "architecture-review-fast");
    assert.equal(fast.tasks.length, 6, "fast mode is intentionally shorter than the full 14-worker review");
    assert.deepEqual(
      fast.phases.map((phase) => [phase.name, phase.mode || "sequential", phase.taskIds.length]),
      [
        ["Map", "parallel", 2],
        ["Assess", "parallel", 2],
        ["Verify", "sequential", 1],
        ["Verdict", "sequential", 1]
      ],
      "fast mode exposes parallel Map/Assess with sequential Verify/Verdict"
    );

    const byTask = new Map(fast.tasks.map((task) => [task.id, task]));
    assert.equal(byTask.get("map:runtime-surface").model, "fast-map-model");
    assert.deepEqual(byTask.get("map:runtime-surface").resultCache, { mode: "read-write", keyInput: "sourceContextDigest" });
    assert.deepEqual(byTask.get("map:operator-surface").resultCache, { mode: "read-write", keyInput: "sourceContextDigest" });
    assert.equal(byTask.get("assess:runtime-speed").model, "fast-map-model");
    assert.deepEqual(byTask.get("assess:risks").resultCache, {
      mode: "read-write",
      keyInput: "sourceContextDigest",
      includeCompletedResults: "previous-phases"
    });
    assert.deepEqual(byTask.get("assess:runtime-speed").resultCache, {
      mode: "read-write",
      keyInput: "sourceContextDigest",
      includeCompletedResults: "previous-phases"
    });
    assert.equal(byTask.get("verify:p0-p2-risks").model, "strong-verify-model");
    assert.equal(byTask.get("verdict:fast-synthesis").model, "strong-verify-model");
    assert.match(byTask.get("map:runtime-surface").prompt, new RegExp(escapeRegExp(sourceContext)), "map prompt carries sourceContext");
    assert.match(byTask.get("map:runtime-surface").prompt, /sha256:smoke/, "map prompt carries sourceContextDigest");
    assert.match(byTask.get("verify:p0-p2-risks").prompt, new RegExp(escapeRegExp(sourceContext)), "verify prompt carries sourceContext");
    assert.match(byTask.get("verdict:fast-synthesis").prompt, new RegExp(escapeRegExp(sourceContext)), "verdict prompt carries sourceContext");
    assert.deepEqual(byTask.get("verify:p0-p2-risks").resultCache, {
      mode: "read-write",
      keyInput: "sourceContextDigest",
      includeCompletedResults: "previous-phases"
    }, "Verify caches by source + all upstream result digests");
    assert.deepEqual(byTask.get("verdict:fast-synthesis").resultCache, {
      mode: "read-write",
      keyInput: "sourceContextDigest",
      includeCompletedResults: "previous-phases"
    }, "Verdict caches by source + all upstream result digests");

    const once = drive(fast.id, work, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(once.status, "in-progress");
    assert.equal(once.completedWorkers, 2, "one drive --once round fulfills the two-task parallel Map phase");
    assert.deepEqual(once.steps.map((step) => step.phase), ["Map", "Map"]);
    assert.ok(once.steps.every((step) => step.action === "accept" && step.status === "ok"), "parallel round accepts both Map workers");

    const finished = drive(fast.id, work, { now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(finished.status, "complete", "fast app can still drive to verifier-gated completion");
    assert.equal(finished.completedWorkers, 6);
    assert.ok(finished.commitId, "fast drive commits after the verdict");
    assert.equal(spawnLines(spawnCount), 6, "first complete run spawns every fast worker once");

    const cached = planApp("architecture-review-fast", {
      repo: work,
      question: "Can a user get a fast architecture answer?",
      invariant: ["existing architecture-review behavior stays unchanged"],
      focus: "runtime speed",
      sourceContext,
      sourceContextDigest: "sha256:smoke"
    });
    const cachedOnce = drive(cached.id, work, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(cachedOnce.status, "in-progress");
    assert.equal(cachedOnce.completedWorkers, 2, "cached run accepts the two Map workers in one round");
    assert.ok(cachedOnce.steps.every((step) => step.handleKind === "result-cache"), "cached Map workers come from the result cache");
    assert.equal(spawnLines(spawnCount), 6, "cache hit does not spawn map agents again");

    const cachedAssess = drive(cached.id, work, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(cachedAssess.status, "in-progress");
    assert.equal(cachedAssess.completedWorkers, 4, "cached run accepts the two Assess workers in the next round");
    assert.deepEqual(cachedAssess.steps.map((step) => step.taskId), ["assess:risks", "assess:runtime-speed"]);
    assert.ok(cachedAssess.steps.every((step) => step.handleKind === "result-cache"), "cached Assess workers include previous result digests in their cache key");
    assert.equal(spawnLines(spawnCount), 6, "cache hit does not spawn assess agents again");

    const noContext = planApp("architecture-review-fast", {
      repo: work,
      question: "Can a user run without a source context digest?"
    });
    const noContextOnce = drive(noContext.id, work, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(noContextOnce.completedWorkers, 2, "no-context run still advances the Map round");
    assert.ok(noContextOnce.steps.every((step) => step.handleKind !== "result-cache"), "missing sourceContextDigest never fabricates result-cache hits");
  } finally {
    process.chdir(cwd0);
    if (priorFast === undefined) delete process.env.CW_ARCHITECTURE_REVIEW_FAST_MODEL;
    else process.env.CW_ARCHITECTURE_REVIEW_FAST_MODEL = priorFast;
    if (priorStrong === undefined) delete process.env.CW_ARCHITECTURE_REVIEW_STRONG_MODEL;
    else process.env.CW_ARCHITECTURE_REVIEW_STRONG_MODEL = priorStrong;
    for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  }

  process.stdout.write("architecture-review-fast-smoke: ok (opt-in fast app, parallel once round, source context, model routing)\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function spawnLines(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean).length : 0;
}

main();
