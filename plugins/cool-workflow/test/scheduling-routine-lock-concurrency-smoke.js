#!/usr/bin/env node
"use strict";

// scheduling-routine-lock-concurrency-smoke — regression guard for two
// unlocked read-modify-write races found by an architecture review:
//
//   A. cw sched lease/release/complete/reclaim/reset mutated queue.json
//      without holding the lock queueAdd/queueDrain already use, so two
//      concurrent leasers could clobber each other's grant.
//   B. RoutineTriggerBridge.create/delete/fire mutated triggers.json (and
//      its monotonic nextTriggerSeq) without any lock at all.
//
// Both are now serialized through the same withFileLock helper Scheduler
// already uses for tasks.json. Each part below spawns real child processes
// racing the SAME store concurrently and asserts no lost update — following
// the concurrentSchedulerWrites() pattern in robustness-failclosed-smoke.js.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { RunRegistry } = require(path.join(pluginRoot, "dist", "shell", "run-registry-io.js"));
const { schedPolicySetCli } = require(path.join(pluginRoot, "dist", "shell", "scheduling-io.js"));
const { RoutineTriggerBridge } = require(path.join(pluginRoot, "dist", "shell", "scheduler-io.js"));

function spawnAllAndWait(procs) {
  return Promise.all(procs.map((p) => new Promise((res, rej) => {
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`child exited ${code}`))));
    p.on("error", rej);
  })));
}

// ---- A. concurrent sched lease grants do not lose queue entries ----------
async function concurrentSchedLease() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lockrace-repo-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lockrace-home-"));
  const env = { ...process.env, CW_HOME: home };
  const N = 16;

  const registry = new RunRegistry(repo, undefined, env);
  for (let i = 0; i < N; i++) registry.queueAdd({ id: `q${i}`, priority: i });
  // Default policy caps maxConcurrent at 1 — raise it so all N leases are
  // independently grantable and any shortfall below N is the lock race, not
  // policy throttling. schedPolicySetCli builds its own RunRegistry from
  // process.env, so CW_HOME must be set on this process too (each smoke test
  // file runs as its own spawned child process, so this is isolated).
  const prevHome = process.env.CW_HOME;
  process.env.CW_HOME = home;
  try {
    schedPolicySetCli({ cwd: repo, maxConcurrent: N });
  } finally {
    if (prevHome === undefined) delete process.env.CW_HOME;
    else process.env.CW_HOME = prevHome;
  }

  const child = path.join(repo, "lease-one.js");
  fs.writeFileSync(child, `
    const { schedLeaseCli } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "scheduling-io.js"))});
    schedLeaseCli({ cwd: ${JSON.stringify(repo)}, limit: 1 });
  `, "utf8");

  const procs = [];
  for (let i = 0; i < N; i++) procs.push(spawn(process.execPath, [child], { stdio: "ignore", env }));
  await spawnAllAndWait(procs);

  const leased = registry.loadQueueEntries().filter((e) => e.status === "leased");
  assert.equal(leased.length, N, `all ${N} queue entries leased (expected ${N}, got ${leased.length}) — lost update in schedLeaseCli`);
}

// ---- B. concurrent routine trigger creates do not lose triggers ----------
async function concurrentRoutineTriggerCreate() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lockrace-routine-"));
  const N = 16;
  const child = path.join(tmp, "create-trigger.js");
  fs.writeFileSync(child, `
    const { RoutineTriggerBridge } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "scheduler-io.js"))});
    new RoutineTriggerBridge(${JSON.stringify(tmp)}).create({ prompt: "p" + process.argv[2], kind: "api" });
  `, "utf8");

  const procs = [];
  for (let i = 0; i < N; i++) procs.push(spawn(process.execPath, [child, "t" + i], { stdio: "ignore" }));
  await spawnAllAndWait(procs);

  const all = new RoutineTriggerBridge(tmp).list();
  assert.equal(all.length, N, `all ${N} triggers created (expected ${N}, got ${all.length}) — lost update in RoutineTriggerBridge.create`);
  const ids = new Set(all.map((t) => t.id));
  assert.equal(ids.size, N, `all ${N} trigger ids are unique (got ${ids.size} unique of ${all.length}) — nextTriggerSeq race`);
}

(async () => {
  await concurrentSchedLease();
  await concurrentRoutineTriggerCreate();
  process.stdout.write("scheduling-routine-lock-concurrency-smoke: ok (concurrent sched lease + routine trigger create lose nothing)\n");
})().catch((error) => {
  process.stderr.write(`scheduling-routine-lock-concurrency-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
