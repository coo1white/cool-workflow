#!/usr/bin/env node
"use strict";

// drive-concurrency-flag-smoke — `cw run --drive --concurrency N` must
// actually change real concurrency. Before this fix, `runDrive()` never
// forwarded `args.concurrency` into `drive()`'s options, so only a
// workflow's OWN `limits.maxConcurrentAgents` had any effect — the CLI/MCP
// flag was silently a no-op (verified: a workflow capped at
// maxConcurrentAgents=2, driven via `cw run --drive --concurrency 8`, still
// only ever ran 2 agents at once).
//
// Drives through the REAL `runDrive()` capability function (the exact
// function `cw run --drive` calls) — not the low-level `drive()` — so this
// pins the fix at the actual CLI/MCP entry point, not just the plumbing
// underneath it.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const lifecycle = require(path.join(pluginRoot, "dist/orchestrator/lifecycle-operations.js"));
const { runDrive } = require(path.join(pluginRoot, "dist/capability-core.js"));
const api = require(path.join(pluginRoot, "dist/workflow-api.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const cwd0 = process.cwd();

const N = 8;
const LOW_CAP = 2;
const STUB_MS = 300;

function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const timingLog = process.env.CW_TIMING_LOG || "";',
    "function mark(event) { if (timingLog) fs.appendFileSync(timingLog, JSON.stringify({ event, pid: process.pid, time: Date.now() }) + '\\n'); }",
    'mark("start");',
    "setTimeout(() => {",
    '  const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "ok", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "  fs.writeFileSync(rp, body);",
    '  mark("end");',
    '  process.stdout.write(JSON.stringify({ model: "stub-m", usage: { input_tokens: 4, output_tokens: 2 } }));',
    "  process.exit(0);",
    `}, ${STUB_MS});`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function planLowCapApp(work) {
  const tasks = [];
  for (let i = 1; i <= N; i++) tasks.push(api.agent(`fan:t${i}`, `Probe ${i}.`));
  const def = api.workflow({
    id: "drive-concurrency-flag",
    title: "drive-concurrency-flag",
    limits: { maxAgents: N, maxConcurrentAgents: LOW_CAP },
    inputs: [{ name: "repo", type: "path", required: true }],
    phases: [api.parallel("Fan", tasks)]
  });
  return lifecycle.plan(
    { app: { schemaVersion: 1, id: def.id, title: def.title, version: "0.0.1", workflow: def }, source: { kind: "manifest", path: path.join(work, "app.json"), manifestPath: path.join(work, "app.json") } },
    { repo: work }
  );
}

function readTimingLog(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function maxOverlap(events) {
  const starts = events.filter((e) => e.event === "start").map((e) => e.time);
  const ends = events.filter((e) => e.event === "end").map((e) => e.time);
  const points = [];
  for (const t of starts) points.push([t, 1]);
  for (const t of ends) points.push([t, -1]);
  points.sort((a, b) => a[0] - b[0]);
  let cur = 0, max = 0;
  for (const [, d] of points) { cur += d; if (cur > max) max = cur; }
  return max;
}

function driveOnce(runner, runId, agentCommand, concurrencyArg) {
  const timingLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cw-conc-flag-log-")), "timing.jsonl");
  process.env.CW_TIMING_LOG = timingLog;
  const args = { run: runId, now: FIXED_NOW, "agent-command": agentCommand };
  if (concurrencyArg !== undefined) args.concurrency = concurrencyArg;
  const result = runDrive(runner, args);
  delete process.env.CW_TIMING_LOG;
  return { result, overlap: maxOverlap(readTimingLog(timingLog)) };
}

function main() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-conc-flag-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  const agentCommand = `${process.execPath} ${stub} {{result}}`;
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });

    // ---- (a) numeric override beats a low limits.maxConcurrentAgents -------
    {
      const run = planLowCapApp(work);
      const { result, overlap } = driveOnce(runner, run.id, agentCommand, 8);
      assert.equal(result.status, "complete", "run completes with the override");
      assert.equal(result.completedWorkers, N, "every task fulfilled");
      assert.equal(overlap, N, `numeric --concurrency 8 overrides maxConcurrentAgents=${LOW_CAP}, got overlap ${overlap}`);
      console.log(`drive-concurrency-flag: numeric override achieves overlap ${overlap} (workflow cap was ${LOW_CAP}) ok`);
    }

    // ---- (b) string override (exactly what real CLI argv produces) ---------
    {
      const run = planLowCapApp(work);
      const { result, overlap } = driveOnce(runner, run.id, agentCommand, "8");
      assert.equal(result.status, "complete", "run completes with a string override");
      assert.equal(overlap, N, `string --concurrency "8" overrides maxConcurrentAgents=${LOW_CAP}, got overlap ${overlap}`);
      console.log("drive-concurrency-flag: string override (real CLI argv shape) ok");
    }

    // ---- (c) no flag: default behavior is unchanged (bounded by the cap) ---
    {
      const run = planLowCapApp(work);
      const { result, overlap } = driveOnce(runner, run.id, agentCommand, undefined);
      assert.equal(result.status, "complete", "run completes with no override");
      assert.equal(overlap, LOW_CAP, `no --concurrency flag: overlap stays bounded by maxConcurrentAgents=${LOW_CAP}, got ${overlap}`);
      console.log(`drive-concurrency-flag: no flag leaves default behavior unchanged (overlap ${overlap}) ok`);
    }
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log("drive-concurrency-flag-smoke: ok (--concurrency now reaches drive() through the real runDrive() surface)");
}

main();
