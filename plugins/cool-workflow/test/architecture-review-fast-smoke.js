#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));

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
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const full = runner.plan("architecture-review", { repo: work, question: "Is the full app unchanged?" });
    const fast = runner.plan("architecture-review-fast", {
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
    assert.equal(byTask.get("verify:p0-p2-risks").resultCache, undefined, "Verify stays uncached");
    assert.equal(byTask.get("verdict:fast-synthesis").resultCache, undefined, "Verdict stays uncached");

    const once = drive(runner, fast.id, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(once.status, "in-progress");
    assert.equal(once.completedWorkers, 2, "one drive --once round fulfills the two-task parallel Map phase");
    assert.deepEqual(once.steps.map((step) => step.phase), ["Map", "Map"]);
    assert.ok(once.steps.every((step) => step.action === "accept" && step.status === "ok"), "parallel round accepts both Map workers");

    const finished = drive(runner, fast.id, { now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(finished.status, "complete", "fast app can still drive to verifier-gated completion");
    assert.equal(finished.completedWorkers, 6);
    assert.ok(finished.commitId, "fast drive commits after the verdict");
    assert.equal(spawnLines(spawnCount), 6, "first complete run spawns every fast worker once");

    const cached = runner.plan("architecture-review-fast", {
      repo: work,
      question: "Can a user get a fast architecture answer?",
      invariant: ["existing architecture-review behavior stays unchanged"],
      focus: "runtime speed",
      sourceContext,
      sourceContextDigest: "sha256:smoke"
    });
    const cachedOnce = drive(runner, cached.id, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(cachedOnce.status, "in-progress");
    assert.equal(cachedOnce.completedWorkers, 2, "cached run accepts the two Map workers in one round");
    assert.ok(cachedOnce.steps.every((step) => step.handleKind === "result-cache"), "cached Map workers come from the result cache");
    assert.equal(spawnLines(spawnCount), 6, "cache hit does not spawn map agents again");

    const cachedAssess = drive(runner, cached.id, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
    assert.equal(cachedAssess.status, "in-progress");
    assert.equal(cachedAssess.completedWorkers, 4, "cached run accepts the two Assess workers in the next round");
    assert.deepEqual(cachedAssess.steps.map((step) => step.taskId), ["assess:risks", "assess:runtime-speed"]);
    assert.ok(cachedAssess.steps.every((step) => step.handleKind === "result-cache"), "cached Assess workers include previous result digests in their cache key");
    assert.equal(spawnLines(spawnCount), 6, "cache hit does not spawn assess agents again");

    const noContext = runner.plan("architecture-review-fast", {
      repo: work,
      question: "Can a user run without a source context digest?"
    });
    const noContextOnce = drive(runner, noContext.id, { once: true, now: FIXED_NOW, agentConfig: agentConfig(stub, spawnCount) });
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
