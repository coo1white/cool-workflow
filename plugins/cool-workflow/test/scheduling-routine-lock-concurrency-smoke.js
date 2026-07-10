#!/usr/bin/env node
"use strict";

// scheduling-routine-lock-concurrency-smoke — regression guard for four
// unlocked/racy read-modify-write bugs:
//
//   A. cw sched lease/release/complete/reclaim/reset mutated queue.json
//      without holding the lock queueAdd/queueDrain already use, so two
//      concurrent leasers could clobber each other's grant.
//   B. RoutineTriggerBridge.create/delete/fire mutated triggers.json (and
//      its monotonic nextTriggerSeq) without any lock at all.
//   C. queueAdd's auto-generated id (q-${stamp14}-${NNN}) used a counter
//      that resets to 0 in every fresh `cw` process, so two SEPARATE
//      processes calling `queue add` within the same second minted the
//      IDENTICAL id. sched lease then keys grants by id, so both entries
//      were treated as one, breaking through maxConcurrent; a single
//      complete drained both. Reproduced on the first try (bug-hunt P2).
//   D. schedPolicySetCli read the policy file, merged the flag patch, and
//      wrote the result back with no lock at all, so two concurrent
//      `sched policy set` calls patching DIFFERENT fields dropped one
//      another's write (last writer wins on the whole file).
//
// A and B are now serialized through the same withFileLock helper
// Scheduler already uses for tasks.json. C is fixed by checking the
// candidate id against the queue file's OWN current entries (loaded inside
// queueAdd's existing file lock) before accepting it, so any process that
// completes its add later always sees every earlier-completed add's id and
// bumps past a collision, regardless of which process's counter produced
// it. D holds withFileLock on the policy file itself for the whole
// load-merge-write cycle. Each part below spawns real child processes
// racing the SAME store concurrently and asserts no lost update / no
// collision — following the concurrentSchedulerWrites() pattern in
// robustness-failclosed-smoke.js.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { RunRegistry } = require(path.join(pluginRoot, "dist", "shell", "run-registry-io.js"));
const { schedPolicySetCli, schedLeaseCli } = require(path.join(pluginRoot, "dist", "shell", "scheduling-io.js"));
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

// ---- C. concurrent queueAdd (no explicit id) across SEPARATE processes
// never mints a duplicate id, and a subsequent lease grants one lease per
// entry rather than silently collapsing collided entries into one. ------
async function concurrentQueueAddNoIdCollision() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cw-qidrace-repo-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-qidrace-home-"));
  const env = { ...process.env, CW_HOME: home };
  const N = 8;

  const child = path.join(repo, "add-one.js");
  fs.writeFileSync(child, `
    const fs = require("node:fs");
    const { RunRegistry } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "run-registry-io.js"))});
    const [repo, readyFile, goFile] = process.argv.slice(2);
    function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
    fs.writeFileSync(readyFile, "ready", "utf8");
    while (!fs.existsSync(goFile)) { sleep(2); }
    process.stdout.write(new RunRegistry(repo).queueAdd({ appId: "demo" }).id + "\\n");
  `, "utf8");

  const goFile = path.join(repo, "go");
  const kids = Array.from({ length: N }, (_, i) => {
    const readyFile = path.join(repo, `ready-${i}`);
    let out = "";
    const proc = spawn(process.execPath, [child, repo, readyFile, goFile], { stdio: ["ignore", "pipe", "inherit"], env });
    proc.stdout.on("data", (d) => { out += d; });
    return { readyFile, proc, getId: () => out.trim() };
  });

  const deadline = Date.now() + 15_000;
  while (kids.some((k) => !fs.existsSync(k.readyFile))) {
    if (Date.now() > deadline) throw new Error("children never readied up");
    await new Promise((res) => setTimeout(res, 5));
  }
  fs.writeFileSync(goFile, "go", "utf8");
  await spawnAllAndWait(kids.map((k) => k.proc));

  const ids = kids.map((k) => k.getId());
  const uniqueIds = new Set(ids);
  assert.equal(
    uniqueIds.size,
    N,
    `all ${N} concurrent queueAdd calls (no explicit id) from SEPARATE processes produced distinct ids (got ${uniqueIds.size} unique of ${N}) — cross-process queueId collision`
  );

  const prevHome = process.env.CW_HOME;
  process.env.CW_HOME = home;
  try {
    schedPolicySetCli({ cwd: repo, maxConcurrent: N });
    const leaseResult = schedLeaseCli({ cwd: repo, limit: N });
    assert.equal(
      leaseResult.granted,
      N,
      `sched lease grants exactly ${N} (one per distinct queue entry), got ${leaseResult.granted} — a collided id would silently drop grants`
    );
    const leaseIds = new Set(leaseResult.leases.map((l) => l.leaseId));
    assert.equal(leaseIds.size, N, `each grant gets its own leaseId (got ${leaseIds.size} unique of ${N})`);
  } finally {
    if (prevHome === undefined) delete process.env.CW_HOME;
    else process.env.CW_HOME = prevHome;
  }
}

// ---- D. concurrent sched policy set calls patching DIFFERENT fields all
// land: the load-merge-write cycle holds the policy file's lock, so no
// last-writer-wins can drop another process's field. --------------------
async function concurrentPolicySetNoLostField() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cw-policyrace-repo-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-policyrace-home-"));
  const env = { ...process.env, CW_HOME: home };
  const fields = {
    maxConcurrent: 11,
    maxAttempts: 12,
    leaseTtlMs: 13000,
    backoffBaseMs: 14000,
    backoffFactor: 15,
    backoffCapMs: 16000,
  };
  const keys = Object.keys(fields);

  const child = path.join(repo, "set-one-field.js");
  fs.writeFileSync(child, `
    const fs = require("node:fs");
    const { schedPolicySetCli } = require(${JSON.stringify(path.join(pluginRoot, "dist", "shell", "scheduling-io.js"))});
    const [repo, key, value, readyFile, goFile] = process.argv.slice(2);
    function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
    fs.writeFileSync(readyFile, "ready", "utf8");
    while (!fs.existsSync(goFile)) { sleep(2); }
    schedPolicySetCli({ cwd: repo, [key]: Number(value) });
  `, "utf8");

  const goFile = path.join(repo, "go");
  const kids = keys.map((key, i) => {
    const readyFile = path.join(repo, `ready-${i}`);
    return { readyFile, proc: spawn(process.execPath, [child, repo, key, String(fields[key]), readyFile, goFile], { stdio: "ignore", env }) };
  });

  const deadline = Date.now() + 15_000;
  while (kids.some((k) => !fs.existsSync(k.readyFile))) {
    if (Date.now() > deadline) throw new Error("children never readied up");
    await new Promise((res) => setTimeout(res, 5));
  }
  fs.writeFileSync(goFile, "go", "utf8");
  await spawnAllAndWait(kids.map((k) => k.proc));

  const prevHome = process.env.CW_HOME;
  process.env.CW_HOME = home;
  try {
    const { schedPolicyShowCli } = require(path.join(pluginRoot, "dist", "shell", "scheduling-io.js"));
    const { policy } = schedPolicyShowCli({ cwd: repo });
    for (const key of keys) {
      assert.equal(
        policy[key],
        fields[key],
        `policy.${key} holds the value its setter wrote (expected ${fields[key]}, got ${policy[key]}) — lost update in schedPolicySetCli`
      );
    }
  } finally {
    if (prevHome === undefined) delete process.env.CW_HOME;
    else process.env.CW_HOME = prevHome;
  }
}

(async () => {
  await concurrentSchedLease();
  await concurrentRoutineTriggerCreate();
  await concurrentQueueAddNoIdCollision();
  await concurrentPolicySetNoLostField();
  process.stdout.write("scheduling-routine-lock-concurrency-smoke: ok (concurrent sched lease + routine trigger create + queueAdd id generation + policy set lose/collide nothing)\n");
})().catch((error) => {
  process.stderr.write(`scheduling-routine-lock-concurrency-smoke: FAIL ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
