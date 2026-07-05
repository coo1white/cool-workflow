"use strict";
// shell/scheduling-io.ts — Control-Plane Scheduling (`cw sched`): pure
// lease-plan mechanism over the run-registry-io.ts queue store, plus the
// policy file IO.
//
// MILESTONE 10 (docs/rebuild/PLAN.md build order, step 10). Byte-exact port of the
// old build's src/scheduling.ts + the sched-specific slice of
// src/capability-core.ts. `sched` is a DIFFERENT system from `schedule`
// (see scheduler-io.ts's file header) — this operates on
// `$CW_HOME/registry/queue.json` leases, not wall-clock tasks.
//
// Evidence: SPEC/scheduling-registry.md section D;
// plugins/cool-workflow/src/scheduling.ts (byte-exact source).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCHEDULING_POLICY = exports.SCHEDULING_SCHEMA_VERSION = void 0;
exports.normalizeSchedulingPolicy = normalizeSchedulingPolicy;
exports.backoffMs = backoffMs;
exports.planSchedule = planSchedule;
exports.applyLease = applyLease;
exports.retryOrPark = retryOrPark;
exports.reclaimExpired = reclaimExpired;
exports.leaseComplete = leaseComplete;
exports.leaseRelease = leaseRelease;
exports.resetEntry = resetEntry;
exports.schedPlanCli = schedPlanCli;
exports.schedLeaseCli = schedLeaseCli;
exports.schedReleaseCli = schedReleaseCli;
exports.schedCompleteCli = schedCompleteCli;
exports.schedReclaimCli = schedReclaimCli;
exports.schedResetCli = schedResetCli;
exports.schedPolicyShowCli = schedPolicyShowCli;
exports.schedPolicySetCli = schedPolicySetCli;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const run_registry_io_1 = require("./run-registry-io");
exports.SCHEDULING_SCHEMA_VERSION = 1;
/** Conservative fail-closed defaults: serial, bounded retries, exponential backoff. */
exports.DEFAULT_SCHEDULING_POLICY = {
    schemaVersion: 1,
    maxConcurrent: 1,
    maxAttempts: 3,
    leaseTtlMs: 300_000,
    backoffBaseMs: 1_000,
    backoffFactor: 2,
    backoffCapMs: 60_000,
};
function normalizeSchedulingPolicy(input) {
    const base = exports.DEFAULT_SCHEDULING_POLICY;
    const num = (value, fallback, min) => (typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback);
    return {
        schemaVersion: 1,
        maxConcurrent: num(input?.maxConcurrent, base.maxConcurrent, 1),
        maxAttempts: num(input?.maxAttempts, base.maxAttempts, 1),
        leaseTtlMs: num(input?.leaseTtlMs, base.leaseTtlMs, 1),
        backoffBaseMs: num(input?.backoffBaseMs, base.backoffBaseMs, 0),
        backoffFactor: num(input?.backoffFactor, base.backoffFactor, 1),
        backoffCapMs: num(input?.backoffCapMs, base.backoffCapMs, 0),
    };
}
/** Deterministic backoff: baseMs * factor^(attempts-1), capped. No jitter. */
function backoffMs(policy, attempts) {
    const raw = policy.backoffBaseMs * Math.pow(policy.backoffFactor, Math.max(0, attempts - 1));
    return Math.min(Math.round(raw), policy.backoffCapMs);
}
function addMs(now, ms) {
    return new Date(new Date(now).getTime() + ms).toISOString();
}
function leaseActive(entry, now) {
    return entry.status === "leased" && Boolean(entry.leaseExpiresAt) && entry.leaseExpiresAt > now;
}
function leaseExpired(entry, now) {
    return entry.status === "leased" && (!entry.leaseExpiresAt || entry.leaseExpiresAt <= now);
}
function eligible(entry, now) {
    if (entry.status !== "pending" && entry.status !== "ready")
        return false;
    if (entry.nextEligibleAt && entry.nextEligibleAt > now)
        return false;
    return true;
}
/** Read-only lease plan for the current queue + policy + now. Pure: no mutation. */
function planSchedule(entries, policy, now) {
    const sorted = [...entries].sort(run_registry_io_1.compareQueue);
    const inFlight = sorted.filter((entry) => leaseActive(entry, now)).length;
    const available = Math.max(0, policy.maxConcurrent - inFlight);
    const leases = [];
    const skipped = [];
    for (const entry of sorted) {
        if (leaseActive(entry, now))
            continue;
        if (entry.status === "parked") {
            skipped.push({ id: entry.id, reason: "parked" });
            continue;
        }
        if (entry.status === "drained" || entry.status === "cancelled") {
            skipped.push({ id: entry.id, reason: "terminal" });
            continue;
        }
        if (!eligible(entry, now)) {
            skipped.push({ id: entry.id, reason: leaseExpired(entry, now) ? "leased" : "backoff" });
            continue;
        }
        if (leases.length >= available) {
            skipped.push({ id: entry.id, reason: "concurrency-ceiling" });
            continue;
        }
        leases.push({
            id: entry.id,
            leaseId: `lease-${entry.id}-${(entry.attempts || 0) + 1}-${now.replace(/[^0-9]/g, "")}`,
            leaseExpiresAt: addMs(now, policy.leaseTtlMs),
            attempts: entry.attempts || 0,
            priority: entry.priority,
        });
    }
    return { schemaVersion: 1, now, maxConcurrent: policy.maxConcurrent, inFlight, available, leases, skipped };
}
function applyLease(entries, policy, now, limit) {
    const plan = planSchedule(entries, policy, now);
    const granted = typeof limit === "number" ? plan.leases.slice(0, Math.max(0, limit)) : plan.leases;
    const byId = new Map(granted.map((lease) => [lease.id, lease]));
    const next = entries.map((entry) => {
        const lease = byId.get(entry.id);
        if (!lease)
            return entry;
        return { ...entry, status: "leased", leaseId: lease.leaseId, leaseExpiresAt: lease.leaseExpiresAt };
    });
    return { entries: next, leases: granted };
}
/** A failed/expired attempt: increment attempts, then park (at budget) or
 *  set ready with backoff. Fail closed — parked is terminal until reset. */
function retryOrPark(entry, policy, now, reason) {
    const attempts = (entry.attempts || 0) + 1;
    const cleared = { ...entry, attempts, leaseId: undefined, leaseExpiresAt: undefined };
    if (attempts >= policy.maxAttempts) {
        return { ...cleared, status: "parked", parkedReason: `${reason} (attempt ${attempts}/${policy.maxAttempts})` };
    }
    return { ...cleared, status: "ready", nextEligibleAt: addMs(now, backoffMs(policy, attempts)) };
}
function reclaimExpired(entries, policy, now) {
    const reclaimed = [];
    const next = entries.map((entry) => {
        if (!leaseExpired(entry, now))
            return entry;
        reclaimed.push(entry.id);
        return retryOrPark(entry, policy, now, "lease expired (host did not complete)");
    });
    return { entries: next, reclaimed };
}
function leaseComplete(entries, leaseId, now) {
    let matched = false;
    const next = entries.map((entry) => {
        if (entry.leaseId !== leaseId || entry.status !== "leased")
            return entry;
        matched = true;
        return { ...entry, status: "drained", drainedAt: now, leaseId: undefined, leaseExpiresAt: undefined };
    });
    return { entries: next, matched };
}
function leaseRelease(entries, leaseId, policy, now, options = {}) {
    let matched = false;
    const next = entries.map((entry) => {
        if (entry.leaseId !== leaseId || entry.status !== "leased")
            return entry;
        matched = true;
        if (options.failed)
            return retryOrPark(entry, policy, now, options.reason || "released as failed");
        return { ...entry, status: "ready", leaseId: undefined, leaseExpiresAt: undefined };
    });
    return { entries: next, matched };
}
function resetEntry(entries, id) {
    let matched = false;
    const next = entries.map((entry) => {
        if (entry.id !== id || entry.status !== "parked")
            return entry;
        matched = true;
        return { ...entry, status: "ready", attempts: 0, nextEligibleAt: undefined, parkedReason: undefined };
    });
    return { entries: next, matched };
}
// ---------------------------------------------------------------------------
// Impure CLI-facing ops: policy file IO + the queue read-modify-write.
// Byte-exact port of the `sched`-specific slice of src/capability-core.ts.
// ---------------------------------------------------------------------------
function resolveCwd(options) {
    return path.resolve(String(options.cwd || process.cwd()));
}
function nowIso(options) {
    return typeof options.now === "string" ? options.now : new Date().toISOString();
}
/** Loads the scheduling policy: absent = default; present-but-corrupt
 *  FAILS CLOSED (SPEC "Rebuild risks" #1 — this store is authoritative). */
function loadSchedulingPolicy(registry) {
    const file = registry.schedulingPolicyPath();
    if (!fs.existsSync(file))
        return { schemaVersion: 1, policy: exports.DEFAULT_SCHEDULING_POLICY, source: "default" };
    const parsed = (0, fs_atomic_1.readJson)(file);
    return { schemaVersion: 1, policy: normalizeSchedulingPolicy(parsed), source: "file" };
}
function numericFlag(options, key) {
    if (!(key in options))
        return undefined;
    const raw = options[key];
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        throw new Error(`Invalid --${key} "${raw}": expected a number (e.g. --${key} 4)`);
    }
    return n;
}
function schedPlanCli(options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    const { policy } = loadSchedulingPolicy(registry);
    return planSchedule(registry.loadQueueEntries(), policy, nowIso(options));
}
function schedLeaseCli(options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    const now = nowIso(options);
    const policy = loadSchedulingPolicy(registry).policy;
    const limit = options.limit === undefined ? undefined : Number(options.limit);
    return (0, fs_atomic_1.withFileLock)(registry.queueFilePath(), () => {
        const { entries, leases } = applyLease(registry.loadQueueEntries(), policy, now, limit);
        registry.saveQueueEntries(entries);
        return { schemaVersion: 1, now, granted: leases.length, leases };
    });
}
function schedReleaseCli(leaseId, options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    const now = nowIso(options);
    const failed = isTrue(options.failed);
    const reason = typeof options.reason === "string" ? options.reason : undefined;
    return (0, fs_atomic_1.withFileLock)(registry.queueFilePath(), () => {
        const { entries, matched } = leaseRelease(registry.loadQueueEntries(), leaseId, loadSchedulingPolicy(registry).policy, now, { failed, reason });
        if (!matched)
            throw new Error(`No active lease to release: ${leaseId}`);
        registry.saveQueueEntries(entries);
        return { schemaVersion: 1, released: leaseId, failed };
    });
}
function schedCompleteCli(leaseId, options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return (0, fs_atomic_1.withFileLock)(registry.queueFilePath(), () => {
        const { entries, matched } = leaseComplete(registry.loadQueueEntries(), leaseId, nowIso(options));
        if (!matched)
            throw new Error(`No active lease to complete: ${leaseId}`);
        registry.saveQueueEntries(entries);
        return { schemaVersion: 1, completed: leaseId };
    });
}
function schedReclaimCli(options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    const now = nowIso(options);
    return (0, fs_atomic_1.withFileLock)(registry.queueFilePath(), () => {
        const { entries, reclaimed } = reclaimExpired(registry.loadQueueEntries(), loadSchedulingPolicy(registry).policy, now);
        registry.saveQueueEntries(entries);
        return { schemaVersion: 1, now, reclaimed };
    });
}
function schedResetCli(id, options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return (0, fs_atomic_1.withFileLock)(registry.queueFilePath(), () => {
        const { entries, matched } = resetEntry(registry.loadQueueEntries(), id);
        if (!matched)
            throw new Error(`No parked entry to reset: ${id}`);
        registry.saveQueueEntries(entries);
        return { schemaVersion: 1, reset: id };
    });
}
function schedPolicyShowCli(options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return loadSchedulingPolicy(registry);
}
function schedPolicySetCli(options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    const current = loadSchedulingPolicy(registry).policy;
    const patch = {};
    for (const key of ["maxConcurrent", "maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"]) {
        const value = numericFlag(options, key);
        if (value !== undefined)
            patch[key] = value;
    }
    const policy = normalizeSchedulingPolicy({ ...current, ...patch });
    (0, fs_atomic_1.writeJson)(registry.schedulingPolicyPath(), policy);
    return { schemaVersion: 1, policy, source: "file" };
}
function isTrue(value) {
    return value === true || value === "true" || value === "1";
}
