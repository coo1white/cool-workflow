"use strict";
// control-plane-scheduling-smoke (v0.1.37). Proves the scheduling policy over the
// run-registry queue — pure core + the CLI front door over a temp CW_HOME:
//   1. deterministic lease order (priority) and a hard concurrency ceiling that is
//      never exceeded.
//   2. retry increments attempts + sets a backoff nextEligibleAt; an expired lease
//      reclaim counts an attempt.
//   3. an entry at maxAttempts is PARKED and never re-leased; only reset recovers it.
//   4. `sched plan` is pure (no mutation) and the concurrency ceiling holds via CLI.
//   5. a pre-v0.1.37 queue.json (no scheduling fields) loads + plans unchanged.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const s = require(path.join(pluginRoot, "dist/scheduling.js"));

const NOW = "2020-01-01T00:00:00.000Z";
const P = s.normalizeSchedulingPolicy({ maxConcurrent: 2, maxAttempts: 3, leaseTtlMs: 1000, backoffBaseMs: 1000, backoffFactor: 2, backoffCapMs: 60000 });
const mk = (id, priority, extra = {}) => ({ schemaVersion: 1, id, repo: "/r", priority, enqueuedAt: "2020-01-01T00:00:00.000Z", status: "ready", ...extra });

// 1. deterministic order + hard ceiling
const queue = [mk("c", 50), mk("a", 10), mk("b", 10), mk("d", 100)];
const plan = s.planSchedule(queue, P, NOW);
assert.deepEqual(plan.leases.map((l) => l.id), ["a", "b"], "lease order is priority asc, deterministic");
assert.equal(plan.available, 2, "available = maxConcurrent - inFlight");
assert.deepEqual(s.planSchedule(queue, P, NOW), plan, "plan is byte-stable for a fixed now");
const leased = s.applyLease(queue, P, NOW).entries.filter((e) => e.status === "leased");
assert.equal(leased.length, 2, "concurrency ceiling (2) is never exceeded");

// 2. retry/backoff + expired reclaim counts an attempt
const expired = mk("x", 10, { status: "leased", leaseId: "L1", leaseExpiresAt: "2019-01-01T00:00:00.000Z" });
const reclaimed = s.reclaimExpired([expired], P, NOW).entries[0];
assert.equal(reclaimed.status, "ready", "expired lease returns to ready");
assert.equal(reclaimed.attempts, 1, "expired lease counts one attempt");
assert.ok(reclaimed.nextEligibleAt > NOW, "backoff sets a future nextEligibleAt");

// 3. PARK at maxAttempts, never re-leased; reset recovers
const lastAttempt = mk("y", 10, { status: "leased", leaseId: "L2", leaseExpiresAt: "2019-01-01T00:00:00.000Z", attempts: 2 });
const parked = s.reclaimExpired([lastAttempt], P, NOW).entries[0];
assert.equal(parked.status, "parked", "attempt 3/3 parks the entry");
assert.equal(s.planSchedule([parked], P, NOW).leases.length, 0, "a parked entry is never leased");
assert.equal(s.resetEntry([parked], "y").entries[0].status, "ready", "reset recovers a parked entry");

// 4 + 5. CLI front door over a temp CW_HOME, incl. pre-v0.1.37 queue.json
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-sched-home-")));
fs.mkdirSync(path.join(home, "registry"), { recursive: true });
// legacy entries: NO attempts/leaseId/status-beyond-ready fields (pre-v0.1.37 shape)
fs.writeFileSync(
  path.join(home, "registry", "queue.json"),
  JSON.stringify({ schemaVersion: 1, entries: [mk("r1", 10), mk("r2", 20), mk("r3", 30)] }, null, 2)
);
const env = { ...process.env, CW_HOME: home };
const j = (args) => JSON.parse(cp.execFileSync("node", [cli, ...args], { cwd: home, env, encoding: "utf8" }));

j(["sched", "policy", "set", "--maxConcurrent", "2"]);
const planA = j(["sched", "plan", "--json"]);
assert.equal(planA.leases.length, 2, "CLI sched plan honors the concurrency ceiling (legacy queue loads fine)");
assert.deepEqual(planA.leases.map((l) => l.id), ["r1", "r2"], "CLI plan is priority-ordered");
const planB = j(["sched", "plan", "--json"]);
// PURE = same selection + no mutation (leaseId/expiry are now-derived, so they
// differ across wall-clock invocations by design — the SELECTION is stable).
assert.deepEqual(planB.leases.map((l) => l.id), planA.leases.map((l) => l.id), "sched plan selection is stable across calls");
const queueAfterPlan = JSON.parse(fs.readFileSync(path.join(home, "registry", "queue.json"), "utf8"));
assert.ok(queueAfterPlan.entries.every((e) => e.status === "ready"), "plan did not mutate the queue");

const lease = j(["sched", "lease"]);
assert.equal(lease.granted, 2, "CLI sched lease grants up to the ceiling");
const planC = j(["sched", "plan", "--json"]);
assert.equal(planC.available, 0, "ceiling reached after leasing — no further slots");

fs.rmSync(home, { recursive: true, force: true });
process.stdout.write("control-plane-scheduling-smoke: ok (deterministic order, hard ceiling, retry/backoff, fail-closed park, pure plan, legacy queue compat, CLI front door)\n");
