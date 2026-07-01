#!/usr/bin/env node
"use strict";

// deferred-checkpoint-batching-smoke — a concurrent round must flush its
// durable state.json write O(1) times per round, not once per task. Before
// this fix, dispatch + accept each did their own full-run durable rewrite
// (fsync + atomic rename) PER TASK — measured (real stress test, not a
// guess): ~350ms/task at N=20 growing to ~1000ms+/task at N=300, over 99% of
// total wall time at scale, even though the actual agent work itself stayed
// genuinely concurrent and cheap. The fix batches a whole round's dispatch +
// accept mutations into ONE cached in-memory run object and flushes to disk
// exactly once at round end.
//
// This counts calls to state.ts's saveCheckpoint — the exact function this
// fix batches from once-per-task to once-per-round — across two round sizes
// and asserts the count stays FLAT, not proportional to task count. (A
// blanket fs.fsyncSync counter would also pick up unrelated per-task durable
// writes — worker scope files, trust-audit events, telemetry — that were
// never in scope for this fix; counting saveCheckpoint itself measures
// exactly what changed.)

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const stateModule = require(path.join(pluginRoot, "dist/state.js"));
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const lifecycle = require(path.join(pluginRoot, "dist/orchestrator/lifecycle-operations.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const api = require(path.join(pluginRoot, "dist/workflow-api.js"));

const FIXED_NOW = "2026-06-09T00:00:00.000Z";
const cwd0 = process.cwd();

function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    "setTimeout(() => {",
    '  const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "ok", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "  fs.writeFileSync(rp, body);",
    '  process.stdout.write(JSON.stringify({ model: "stub-m", usage: { input_tokens: 4, output_tokens: 2 } }));',
    "  process.exit(0);",
    "}, 50);"
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function planParallelApp(work, n) {
  const tasks = [];
  for (let i = 1; i <= n; i++) tasks.push(api.agent(`fan:t${i}`, `Probe ${i}.`));
  const def = api.workflow({
    id: `checkpoint-batching-${n}`,
    title: `checkpoint-batching-${n}`,
    limits: { maxAgents: n, maxConcurrentAgents: n },
    inputs: [{ name: "repo", type: "path", required: true }],
    phases: [api.parallel("Fan", tasks)]
  });
  return lifecycle.plan(
    { app: { schemaVersion: 1, id: def.id, title: def.title, version: "0.0.1", workflow: def }, source: { kind: "manifest", path: path.join(work, "app.json"), manifestPath: path.join(work, "app.json") } },
    { repo: work }
  );
}

function countSaveCheckpointsDuring(fn) {
  const original = stateModule.saveCheckpoint;
  let count = 0;
  stateModule.saveCheckpoint = (...args) => {
    count += 1;
    return original.apply(stateModule, args);
  };
  try {
    fn();
  } finally {
    stateModule.saveCheckpoint = original;
  }
  return count;
}

function driveNTasksAndCountCheckpoints(work, runner, stub, n) {
  const run = planParallelApp(work, n);
  let result;
  const checkpointCount = countSaveCheckpointsDuring(() => {
    result = drive(runner, run.id, {
      now: FIXED_NOW,
      concurrency: n,
      agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], source: "flag", timeoutMs: 10000 }
    });
  });
  assert.equal(result.status, "complete", `n=${n}: run completes`);
  assert.equal(result.completedWorkers, n, `n=${n}: every task fulfilled`);
  return checkpointCount;
}

function main() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-checkpoint-batch-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const stub = writeStub(path.join(work, "stub.js"));
  process.chdir(work);
  try {
    const runner = new CoolWorkflowRunner({ pluginRoot });

    const checkpointsAt5 = driveNTasksAndCountCheckpoints(work, runner, stub, 5);
    const checkpointsAt15 = driveNTasksAndCountCheckpoints(work, runner, stub, 15);

    console.log(`deferred-checkpoint-batching: saveCheckpoint calls at N=5: ${checkpointsAt5}, at N=15: ${checkpointsAt15}`);

    // O(1): the N=15 round must not cost meaningfully more saveCheckpoint calls
    // than the N=5 round. Before the fix, dispatch + accept each did their OWN
    // saveCheckpoint call PER TASK, so the count would scale by roughly
    // (15-5)*2=20 EXTRA calls; a small, N-independent constant delta proves the
    // round now flushes once regardless of task count.
    assert.ok(checkpointsAt15 - checkpointsAt5 <= 2, `saveCheckpoint count must stay flat across round sizes, not scale with N (5-task: ${checkpointsAt5}, 15-task: ${checkpointsAt15})`);
    console.log("deferred-checkpoint-batching: saveCheckpoint count is O(1) per round, not O(N) ok");
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log("deferred-checkpoint-batching-smoke: ok (a concurrent round flushes state.json once, not once per task)");
}

main();
